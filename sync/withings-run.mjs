#!/usr/bin/env node
// One Withings run (#197): get an access token (#196), fetch every measure
// group in the window, and land each one, unmodified, in the bot's Drive.
// Then (#198) normalize every group whose archive write succeeded and upsert
// the rows into BodyMeasurements through the Thrive API. Last (#200), whatever
// happened, append the run's one WithingsSyncLog row.
//
//   WITHINGS_CLIENT_ID=… WITHINGS_CLIENT_SECRET=… THRIVE_API_URL=… THRIVE_API_KEY=… \
//     node withings-run.mjs
//
// Needs the Google credential from google-authorize.mjs and a Withings token
// file from withings-authorize.mjs. .github/workflows/withings-sync.yml runs
// it every 6 hours.
//
// `withingsRun` is the fetch, archive and sheet write; `withingsSyncRun` wraps
// it in the run-and-log shape of src/sync-run.mjs, reusing src/run-log.mjs.
//
// Never prints a measurement. `SYNC_LOG=summary` (set by the workflow) also
// keeps grpids, device models and Withings text out of the public Actions log:
// it prints counts, dates, status, run_id and error class names, and the
// detail goes to the WithingsSyncLog row. Unset, a local run logs everything.
//
// Exits non-zero unless the run was clean and its row was written: a page
// Withings would not serve, a group that could not be written to Drive or
// normalized, the sheet write, or the log row. Groups fetched before a
// failure are still archived, and a missing THRIVE_API_URL/THRIVE_API_KEY
// costs the sheet write and the row, never the archive. A group skipped as
// unattributed is noted, and is not a failure.

import { pathToFileURL } from 'node:url';
import { withingsWindow } from './src/dates.mjs';
import { createDrive } from './src/drive.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './src/google.mjs';
import { normalizeWithingsGroups, skippedNotes } from './src/normalize-withings.mjs';
import { redact } from './src/redact.mjs';
import { buildSyncLogRow, createRunOutput, logModeFor, runIdFor } from './src/run-log.mjs';
import { createThriveApi, loadThriveApiConfig } from './src/thrive-api.mjs';
import { createWithingsTokenStore } from './src/token-store.mjs';
import { createWithingsArchive } from './src/withings-archive.mjs';
import { fetchMeasureGroups } from './src/withings-measures.mjs';
import { getWithingsAccessToken } from './src/withings-tokens.mjs';

const describe = (err) => `${err?.name ?? 'Error'}: ${redact(err?.message || String(err))}`;

export const defaultDeps = {
  createDrive: (env) => createDrive({ getToken: googleTokenProvider(loadGoogleCredentials(env)) }),
  createTokenStore: createWithingsTokenStore,
  getAccessToken: getWithingsAccessToken,
  fetchMeasureGroups,
  createArchive: createWithingsArchive,
  createApi: (env) => createThriveApi(loadThriveApiConfig(env)),
};

/**
 * @param {{ env?: object, now?: () => number, deps?: object, print?: Function,
 *   printError?: Function, window?: { startdate: number, enddate: number },
 *   fetchImpl?: typeof fetch, retry?: object }} [opts]
 *   `window` overrides the rolling window; the backfill (#199) passes
 *   `startdate: 0`.
 * @returns {Promise<{ exitCode: number, counts: object, failed: string[], archiveFailures: string[],
 *   error: Error|null,
 *   sheet: { rows: number, appended: number, updated: number,
 *     skipped: { grpid: string, attrib: string }[],
 *     failed: { grpid: string, type: number|undefined, reason: string }[],
 *     notes: string, error: Error|null } }>}
 *   `counts` and `failed` are the archive's; `sheet` is the BodyMeasurements write.
 */
export async function withingsRun({
  env = process.env,
  now = () => Date.now(),
  deps = {},
  print = console.log,
  printError = console.error,
  window,
  fetchImpl = fetch,
  retry,
} = {}) {
  const d = { ...defaultDeps, ...deps };
  const counts = { seen: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const failed = [];
  // The same groups as `failed`, with why: private, for the log row (#200).
  const archiveFailures = [];
  const sheet = { rows: 0, appended: 0, updated: 0, skipped: [], failed: [], notes: '', error: null };

  let drive;
  let accessToken;
  try {
    drive = d.createDrive(env);
    ({ accessToken } = await d.getAccessToken({
      store: d.createTokenStore(drive),
      clientId: env.WITHINGS_CLIENT_ID,
      clientSecret: env.WITHINGS_CLIENT_SECRET,
      fetchImpl,
      now,
      ...(retry ? { retry } : {}),
    }));
  } catch (err) {
    printError(`Withings run failed before fetching: ${describe(err)}`);
    return { exitCode: 1, counts, failed, archiveFailures, error: err, sheet };
  }

  const w = window ?? withingsWindow(now());
  const range = w.start ? `${w.start} to ${w.end}` : `startdate ${w.startdate} to enddate ${w.enddate}`;
  const { groups, pages, error } = await d.fetchMeasureGroups({
    fetchImpl, accessToken, startdate: w.startdate, enddate: w.enddate, ...(retry ? { retry } : {}),
  });
  counts.seen = groups.length;
  print(`Withings: ${groups.length} measure groups in ${pages} page(s), ${range}.`);

  const archive = d.createArchive(drive, { now });
  const archived = [];
  for (const group of groups) {
    try {
      const { status, fileId } = await archive.upsertGroup(group);
      counts[status] += 1;
      // Only a group with an archive file has a raw_ref, so only it is sent.
      if (fileId) archived.push({ group, raw_ref: fileId });
    } catch (err) {
      counts.failed += 1;
      failed.push(String(group?.grpid));
      archiveFailures.push(`Could not archive Withings group ${group?.grpid}: ${describe(err)}`);
      printError(`Could not archive Withings group ${group?.grpid}: ${describe(err)}`);
    }
  }
  print(`Archive: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ` +
    `${counts.failed} failed.`);

  if (error) {
    printError(`Withings fetch ended early with ${describe(error)} ` +
      `The ${groups.length} groups fetched before it were archived; nothing from the error was.`);
  }

  await writeSheet({ d, env, now, archived, sheet, print, printError });

  const exitCode = error || counts.failed || sheet.failed.length || sheet.error ? 1 : 0;
  return { exitCode, counts, failed, archiveFailures, error, sheet };
}

/**
 * Normalize the archived groups and upsert the rows (#198 AC5). Mutates
 * `sheet`. Runs after the archive, so a missing THRIVE_API_URL/KEY costs
 * this write alone.
 */
async function writeSheet({ d, env, now, archived, sheet, print, printError }) {
  const { rows, skipped, failed } = normalizeWithingsGroups(archived);
  sheet.rows = rows.length;
  sheet.skipped = skipped;
  sheet.failed = failed;
  sheet.notes = skippedNotes(skipped);
  for (const f of failed) printError(`Could not normalize Withings ${f.reason}`);
  if (sheet.notes) print(sheet.notes);

  try {
    const api = d.createApi(env);
    const totals = await api.upsertBodyMeasurements(rows, new Date(now()).toISOString());
    sheet.appended = totals.appended;
    sheet.updated = totals.updated;
  } catch (err) {
    sheet.error = err;
    printError(`BodyMeasurements not written: ${describe(err)}`);
  }
  print(`Sheet: ${archived.length} archived groups seen, ${sheet.appended} rows appended, ` +
    `${sheet.updated} updated, ${skipped.length} skipped as unattributed, ${failed.length} failed.`);
}

/** The deployed API ignores `log`, so a Withings row would land in SyncLog. */
export class ApiIgnoresLogError extends Error {
  constructor() {
    super(
      'The deployed Thrive API answered log "withings" with SyncLog\'s own rows, so it predates #200 ' +
      'and would file this run in SyncLog, where it would make a stopped COROS sync look alive. ' +
      'No row was written. Deploy apps-script/, then re-run.',
    );
    this.name = 'ApiIgnoresLogError';
    this.action = 'getSyncLog';
  }
}

/**
 * Refuse to append while the API ignores `log` (#200). An API older than #200
 * answers `getSyncLog` with SyncLog whatever `log` says, so the two reads
 * return the same newest row; two real tabs never share a run_id, since their
 * runs come from different workflows. A read that fails proves nothing
 * either way, so the append goes ahead and meets the same problem itself.
 */
async function assertLogsSeparate(api) {
  let coros;
  let withings;
  try {
    [coros] = await api.getSyncLog(1);
    [withings] = await api.getSyncLog(1, { log: 'withings' });
  } catch {
    return;
  }
  if (coros?.run_id && withings?.run_id === coros.run_id) throw new ApiIgnoresLogError();
}

/** The one-line account of a Withings run: counts only, safe for a public log. */
export function withingsSummaryLine(row) {
  return (
    `Run ${row.run_id}: ${row.status}. Window ${row.window_start} to ${row.window_end}. ` +
    `${row.n_seen} measure groups fetched; BodyMeasurements ${row.n_new} appended, ${row.n_updated} updated; ` +
    `${row.n_errors} failure(s).`
  );
}

/**
 * One scheduled Withings run, start to WithingsSyncLog row (#200): the
 * run-and-log shape of src/sync-run.mjs around `withingsRun`.
 *
 * The row uses SyncLog's A:N fields. `n_seen` is groups fetched,
 * `n_new`/`n_updated` are BodyMeasurements rows appended and changed, and
 * `n_enriched`/`n_fit_fetched` are always 0. An error that ended the fetch,
 * or the run before it, is the run's fatal error: `status` is `failed` and it
 * leads `error_detail` by class. Groups skipped as unattributed go in `notes`.
 *
 * The exit code agrees with the row: 0 only for `ok` with the row written.
 *
 * @param {{ env?: object, now?: () => number, deps?: object, fetchImpl?: typeof fetch,
 *   retry?: object, output?: ReturnType<typeof createRunOutput> }} [opts]
 * @returns {Promise<{ exitCode: number, row: object, logged: boolean, result: object | null }>}
 */
export async function withingsSyncRun({
  env = process.env, now = () => Date.now(), deps = {}, fetchImpl = fetch, retry, output,
} = {}) {
  const d = { ...defaultDeps, ...deps };
  // The run's single timestamp: started_at and every row's synced_at.
  const startedMs = now();
  const startedAt = new Date(startedMs).toISOString();
  const runId = runIdFor(env, startedAt);
  const window = withingsWindow(startedMs);
  const out = output ?? createRunOutput(logModeFor(env), {
    logName: 'WithingsSyncLog', command: 'node withings-run.mjs',
  });

  // One client for the sheet and the row. Missing secrets cost both, never
  // the archive: withingsRun meets the same error at its sheet write.
  let api = null;
  let apiError = null;
  try {
    api = d.createApi(env);
  } catch (err) {
    apiError = err;
  }

  let result = null;
  let fatal = null;
  try {
    result = await withingsRun({
      env,
      now: () => startedMs,
      deps: { ...d, createApi: () => { if (apiError) throw apiError; return api; } },
      // Grpids and Withings text: full mode only.
      print: out.detail,
      printError: out.detailError,
      window,
      fetchImpl,
      ...(retry ? { retry } : {}),
    });
    fatal = result.error;
  } catch (err) {
    // withingsRun reports its own failures; reaching here is a bug in it.
    fatal = err;
  }

  const failures = [];
  const counts = { seen: 0, created: 0, updated: 0 };
  const notes = [];
  if (result) {
    const { sheet } = result;
    counts.seen = result.counts.seen;
    counts.created = sheet.appended;
    counts.updated = sheet.updated;
    failures.push(...result.archiveFailures);
    for (const f of sheet.failed) failures.push(`Could not normalize Withings ${f.reason}`);
    if (sheet.error) failures.push(`BodyMeasurements not written: ${describe(sheet.error)}`);
    if (sheet.notes) notes.push(sheet.notes);
    const a = result.counts;
    out.info(
      `Withings: ${a.seen} measure groups fetched. Archive: ${a.created} created, ${a.updated} updated, ` +
      `${a.unchanged} unchanged, ${a.failed} failed. Sheet: ${sheet.appended} appended, ${sheet.updated} updated, ` +
      `${sheet.skipped.length} skipped as unattributed, ${sheet.failed.length} failed.`,
    );
  }

  const row = buildSyncLogRow({
    runId, startedAt, finishedAt: new Date(now()).toISOString(), window, counts, failures, fatal, notes,
  });

  if (fatal) out.fatal(runId, fatal);
  out.failures(runId, failures);

  let logged = false;
  if (api) {
    try {
      await assertLogsSeparate(api);
      const res = await api.appendSyncLog(row, { log: 'withings' });
      logged = true;
      out.info(`WithingsSyncLog row ${runId} ${res?.status === 'exists' ? 'already present' : 'appended'}.`);
    } catch (err) {
      out.logWriteFailed(runId, err);
    }
  } else {
    out.logWriteFailed(runId, apiError);
  }
  out.info(withingsSummaryLine(row));

  return { exitCode: row.status === 'ok' && logged ? 0 : 1, row, logged, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  withingsSyncRun()
    .then(({ exitCode }) => { process.exitCode = exitCode; })
    .catch((err) => {
      // withingsSyncRun records its own failures; reaching here is a bug in it.
      const full = process.env.SYNC_LOG !== 'summary';
      console.error(full ? `withings-run failed: ${describe(err)}` : `Unexpected ${err?.name ?? 'Error'}.`);
      process.exit(1);
    });
}
