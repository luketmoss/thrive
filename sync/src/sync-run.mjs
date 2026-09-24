// One sync run, start to SyncLog row (#156). `run.mjs` is its command line.
//
// Get a COROS access token, refreshing and persisting it if it is near expiry
// (#151); land the window's raw COROS payloads in the bot's Drive (#152); then
// normalize from that archive into the sheet through the Thrive API:
// DailyHealth (#165), Workouts (#166), the DailySummary rollup. Last, whatever
// happened, append the run's one SyncLog row.
//
// The exit code agrees with the row: 0 only for `ok` with the row written.

import { createArchive } from './archive.mjs';
import { syncWindow } from './dates.mjs';
import { createDrive } from './drive.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './google.mjs';
import { ingest, REQUIRED_TOOLS } from './ingest.mjs';
import { connectCoros } from './mcp.mjs';
import { redact } from './redact.mjs';
import { buildSyncLogRow, createRunOutput, logModeFor, runIdFor, summaryLine } from './run-log.mjs';
import { writeSheet } from './sheet.mjs';
import { createThriveApi, loadThriveApiConfig } from './thrive-api.mjs';
import { createTokenStore } from './token-store.mjs';
import { getAccessToken } from './tokens.mjs';

export const defaultDeps = {
  createDrive: (env) => createDrive({ getToken: googleTokenProvider(loadGoogleCredentials(env)) }),
  createTokenStore,
  getAccessToken,
  connectCoros,
  createArchive,
  ingest,
  writeSheet,
  createApi: (env) => createThriveApi(loadThriveApiConfig(env)),
};

/**
 * @param {{ env?: object, force?: boolean, now?: () => Date, deps?: object,
 *   output?: ReturnType<typeof createRunOutput> }} [opts]
 * @returns {Promise<{ exitCode: number, row: object, logged: boolean }>}
 */
export async function syncRun({ env = process.env, force = false, now = () => new Date(), deps = defaultDeps, output } = {}) {
  const d = { ...defaultDeps, ...deps };
  // The run's single timestamp: every row it writes carries this synced_at,
  // and the SyncLog row's started_at is the same instant.
  const startedAt = now().toISOString();
  const runId = runIdFor(env, startedAt);
  const window = syncWindow(Date.parse(startedAt));
  const out = output ?? createRunOutput(logModeFor(env));

  // The API is needed for the sheet and for the SyncLog row. Missing secrets
  // cost both, never the archive: the run archives first, then fails.
  let api = null;
  let apiError = null;
  try {
    api = d.createApi(env);
  } catch (err) {
    apiError = err;
  }

  const counts = {};
  const failures = [];
  let fatal = null;
  let client = null;
  try {
    const drive = d.createDrive(env);
    const store = d.createTokenStore(drive);
    const { accessToken, refreshed } = await d.getAccessToken({ store, force });
    out.info(refreshed ? 'COROS token refreshed and saved to Drive.' : 'COROS token still fresh; not refreshed.');

    client = await d.connectCoros(accessToken);
    const { tools } = await client.listTools();
    const missing = REQUIRED_TOOLS.filter((name) => !tools.some((t) => t.name === name));
    if (missing.length) {
      throw new Error(`COROS no longer offers ${missing.join(', ')}. Check tools/list and update sync/src/ingest.mjs.`);
    }
    out.info(`Authenticated: ${tools.length} COROS tools listed.`);

    const archive = d.createArchive(drive);
    const summary = await d.ingest({ client, archive, now: Date.parse(startedAt), log: out.detail });
    counts.seen = summary.activityIds.length;
    failures.push(...summary.failures);
    const { created, updated, unchanged } = summary.activities;
    out.info(
      `Archive: ${created} created, ${updated} updated, ${unchanged} unchanged. ` +
      `Health bundle: ${summary.health ?? 'not written'}.`,
    );

    if (api) {
      const sheet = await d.writeSheet({
        archive, api, window: summary.window, activityIds: summary.activityIds, syncedAt: startedAt,
        log: out.detail,
      });
      failures.push(...sheet.failures);
      counts.created = sheet.activities?.created ?? 0;
      counts.updated = sheet.activities?.updated ?? 0;
    } else {
      failures.push(redact(apiError.message || String(apiError)));
    }
  } catch (err) {
    fatal = err;
  } finally {
    if (client) {
      try { await client.close(); } catch { /* closing a dead connection is not news */ }
    }
  }

  const row = buildSyncLogRow({
    runId, startedAt, finishedAt: now().toISOString(), window, counts, failures, fatal,
  });

  if (fatal) out.fatal(runId, fatal);
  out.failures(runId, failures);

  let logged = false;
  if (api) {
    try {
      const res = await api.appendSyncLog(row);
      logged = true;
      out.info(`SyncLog row ${runId} ${res?.status === 'exists' ? 'already present' : 'appended'}.`);
    } catch (err) {
      out.logWriteFailed(runId, err);
    }
  } else {
    out.logWriteFailed(runId, apiError);
  }
  out.info(summaryLine(row));

  return { exitCode: row.status === 'ok' && logged ? 0 : 1, row, logged };
}
