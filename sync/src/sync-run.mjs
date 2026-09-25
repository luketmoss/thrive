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
import { createFitStep, FIT_ALLOWANCE, FIT_TOOL } from './fit.mjs';
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
  createFitStep,
};

/**
 * `THRIVE_FIT_BUDGET`, a whole number, caps what a run may spend below what
 * SyncLog says is left, to test the cap stop without spending the real
 * allowance (#154). It can only lower the budget. Anything else is ignored.
 */
export function fitBudgetOverride(env) {
  const v = env.THRIVE_FIT_BUDGET;
  return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined;
}

/** The FIT step's account, counts only, so it is safe in a summary-mode log. */
export function fitSummary(fit) {
  const c = fit.counts;
  const r = fit.remaining;
  const left = r === 'unread' ? 'budget not needed, so not read'
    : r === 'unknown' ? 'budget unknown'
      : `${r} of ${FIT_ALLOWANCE} left in the rolling 24 h`;
  return (
    `FIT: ${c.requested} requested, ${c.stored} stored, ${c.adopted} already in Drive, ${c.failed} failed` +
    `${c.gaveUp ? ` (${c.gaveUp} given up)` : ''}; ${c.waiting} waiting for budget; ${left}.`
  );
}

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
  let fit = null;
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
      // FITs need the API too: the budget is read from SyncLog (#154).
      if (tools.some((t) => t.name === FIT_TOOL)) {
        fit = d.createFitStep({
          client, archive, api, startedAt, log: out.detail, budgetOverride: fitBudgetOverride(env),
        });
      } else {
        failures.push(`COROS no longer offers ${FIT_TOOL}, so no FIT was requested. Check tools/list and update sync/src/fit.mjs.`);
      }
      const sheet = await d.writeSheet({
        archive, api, window: summary.window, activityIds: summary.activityIds, syncedAt: startedAt,
        fit, log: out.detail,
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

  // Counted whatever happened after them: every request may have spent
  // allowance, and the next run's budget is summed from this row.
  if (fit) {
    counts.fitFetched = fit.counts.requested;
    failures.push(...fit.failures);
    out.info(fitSummary(fit));
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
