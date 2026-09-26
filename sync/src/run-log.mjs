// A run's record (#156): the one SyncLog row every run writes, and what the
// run prints while it goes.
//
// SyncLog is the private record: the sheet is the user's. The Actions log is
// public (the repo is), so with SYNC_LOG=summary a run prints only counts,
// dates, its status, its run_id and error class names. It prints no activity
// name, no ID, no health value and no quoted COROS line. The detail goes in
// SyncLog.error_detail, and the log says which run_id to look up.

import { redact } from './redact.mjs';

export const STATUSES = ['ok', 'partial', 'failed'];

/**
 * `<event>-<run id>-<attempt>` in Actions (`schedule-…`, `workflow_dispatch-…`),
 * else `local-<startedAt>`. The prefix is how SyncLog tells an unattended run
 * from one a person started (AC6's seven days are counted in `schedule-` rows).
 */
export function runIdFor(env, startedAt) {
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_RUN_ID) {
    return `${env.GITHUB_EVENT_NAME || 'actions'}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}`;
  }
  return `local-${startedAt}`;
}

/** `summary` when SYNC_LOG says so; anything else logs in full, as before #156. */
export const logModeFor = (env) => (env.SYNC_LOG === 'summary' ? 'summary' : 'full');

/**
 * The run's SyncLog row.
 *
 * `fatal` is the error that aborted the run, if one did. It leads
 * `error_detail` as `<ErrorName>: <message>`, so a dead grant is on record in
 * the sheet as `CorosGrantDeadError: …`. Everything is redacted.
 *
 * @param {{ runId: string, startedAt: string, finishedAt: string,
 *   window: { start: string, end: string },
 *   counts?: { seen?: number, created?: number, updated?: number, enriched?: number, fitFetched?: number },
 *   failures?: string[], fatal?: Error | null, notes?: string[] }} run
 *   `notes` are what the run noted that are not failures, such as a strength
 *   session with no workout to enrich (#155). They do not touch `status`.
 */
export function buildSyncLogRow({
  runId, startedAt, finishedAt, window, counts = {}, failures = [], fatal = null, notes = [],
}) {
  const lines = [];
  if (fatal) lines.push(`${fatal.name || 'Error'}: ${redact(fatal.message || String(fatal))}`);
  for (const f of failures) lines.push(redact(f));
  const status = fatal ? 'failed' : failures.length ? 'partial' : 'ok';
  return {
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    window_start: window.start,
    window_end: window.end,
    n_seen: counts.seen ?? 0,
    n_new: counts.created ?? 0,
    n_updated: counts.updated ?? 0,
    // n_enriched is hand-logged strength rows written to (#155). n_fit_fetched
    // is FIT requests made (#154), failed ones included, because each may have
    // spent COROS's allowance; the next run's budget is summed from it.
    n_enriched: counts.enriched ?? 0,
    n_fit_fetched: counts.fitFetched ?? 0,
    n_errors: failures.length + (fatal ? 1 : 0),
    status,
    error_detail: lines.join('\n'),
    notes: notes.map((n) => redact(n)).join('\n'),
  };
}

/**
 * What a run prints. `detail` is the step-by-step log the modules below
 * run.mjs already write (names, IDs, quoted lines): printed in full mode,
 * dropped in summary mode. `info` is safe in both: fixed text and counts.
 * `detailError` is `detail` for error text: stderr in full mode, dropped in
 * summary mode.
 *
 * `logName` and `command` name the tab the row goes to and the command to
 * re-run locally; the Withings sync (#200) passes `WithingsSyncLog` and
 * `node withings-run.mjs`. The defaults are COROS's.
 */
export function createRunOutput(mode, {
  out = console.log, err = console.error, logName = 'SyncLog', command = 'node run.mjs',
} = {}) {
  const full = mode !== 'summary';
  return {
    mode,
    detail: full ? out : () => {},
    detailError: full ? err : () => {},
    info: out,
    /** The failures, in full mode only. Summary mode names where to find them. */
    failures(runId, failures) {
      if (!failures.length) return;
      if (full) {
        err(`${failures.length} failure(s):`);
        for (const f of failures) err(`  ${f}`);
      } else {
        err(`${failures.length} failure(s). They are in ${logName} row ${runId}, not in this public log.`);
      }
    },
    /** The error that aborted the run: in summary mode, its class alone. */
    fatal(runId, e) {
      if (full) {
        err(`${e.name ?? 'Error'}: ${redact(e.message || String(e))}`);
      } else {
        const where = e.action ? ` (${e.action})` : '';
        err(`Aborted by ${e.name ?? 'Error'}${where}. See "When a run fails" in sync/README.md; the message is in ${logName} row ${runId}.`);
      }
    },
    /** The log append itself failed: nothing in the sheet holds this run. */
    logWriteFailed(runId, e) {
      const where = e.action ? ` (${e.action})` : '';
      if (full) err(`${logName} row ${runId} was not written: ${redact(e.message || String(e))}`);
      else err(`${logName} row ${runId} was not written: ${e.name ?? 'Error'}${where}. Run \`${command}\` locally for the full log.`);
    },
  };
}

/** The one-line account of a run, safe for a public log. */
export function summaryLine(row) {
  return (
    `Run ${row.run_id}: ${row.status}. Window ${row.window_start} to ${row.window_end}. ` +
    `${row.n_seen} activities listed; Workouts ${row.n_new} created, ${row.n_updated} updated, ` +
    `${row.n_enriched} enriched from strength; ` +
    `${row.n_fit_fetched} FIT requested; ` +
    `${row.n_errors} failure(s).`
  );
}
