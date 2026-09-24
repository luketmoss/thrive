// One ingest pass (#152): fetch the window's COROS data and land it, unmodified,
// in the Drive archive. Nothing here writes to the sheet or calls the Thrive
// API; #153 normalizes from the archive.
//
// COROS answers every tool in prose (#133). The only prose read here is the
// activity list, and only for what the detail call needs (labelId, sportType)
// and where the file goes (the start timestamp). Everything else is stored as
// served.

import { SPORT_RECORDS_LIMIT } from './config.mjs';
import { chunkRange, corosDate, localDate, syncWindow } from './dates.mjs';
import { CorosUnavailableError, DriveAuthError } from './errors.mjs';
import { redact } from './redact.mjs';
import { withRetry } from './retry.mjs';

export const LIST_TOOL = 'querySportRecords';
export const DETAIL_TOOL = 'getActivityDetail';

/**
 * Text COROS returns *as a successful result* when it is really failing.
 * The first is the May 2026 outage (sync plan §2); the second is what an
 * unknown labelId gets, with `isError: false` (seen in #152).
 */
const ERROR_TEXT = [/temporarily unavailable/i, /Tool call anomalies detected/i];

/** The unauthenticated FIT URL (sync plan §2) must never be archived. */
const FIT_URL = /s3\.coros\.com\/fit\//i;

/** A tool call that failed, however COROS chose to say so. */
export class CorosToolError extends Error {
  constructor(tool, detail) {
    super(`${tool}: ${detail}`);
    this.name = 'CorosToolError';
    this.tool = tool;
  }
}

/**
 * A result's text, exactly as served. Every COROS tool answers with a single
 * text item (#133); were there several, they are joined in order.
 */
export function resultText(result) {
  return (result?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
}

/**
 * The payload of one tool call, or a CorosToolError. Errors, error results and
 * error text are retried with backoff, three attempts in all, and never
 * returned as a payload: an archived error would change the hash and be
 * normalized as data.
 */
export async function callTool(client, tool, args, { retry = {} } = {}) {
  try {
    return await withRetry(async () => {
      const result = await client.callTool({ name: tool, arguments: args });
      const text = resultText(result);
      if (result?.isError) throw new CorosToolError(tool, `error result: ${text.slice(0, 200)}`);
      if (ERROR_TEXT.some((re) => re.test(text))) throw new CorosToolError(tool, `error text: ${text.slice(0, 200)}`);
      if (!text) throw new CorosToolError(tool, 'empty result');
      return text;
    }, { isRetryable: () => true, ...retry });
  } catch (err) {
    if (err instanceof CorosToolError) throw err;
    throw new CorosToolError(tool, redact(err.message || String(err)));
  }
}

/** COROS wraps its prose in a JSON string; unwrap it for reading, never for storing. */
export function prose(text) {
  if (!text.startsWith('"')) return text;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * The activities in a `querySportRecords` result. A record that cannot be read
 * fails the whole list rather than being skipped: a silently dropped activity
 * is invisible forever, which is the failure sync plan §6 exists to prevent.
 *
 * @returns {{ activityId: string, sportType: number, name: string, date: string,
 *   startTimestamp: number | null, endTimestamp: number | null, text: string }[]}
 */
export function parseSportRecords(text) {
  const body = prose(text);
  const declared = body.match(/\((\d+) records?\)/);
  const blocks = body.split(/\n(?=\d+\. )/).slice(1);
  const entries = blocks.map((block) => {
    const head = block.match(/^\d+\. (.*?) — (\d{4}-\d{2}-\d{2})/);
    const ids = block.match(/LabelId:\s*(\d+)\s*\|\s*SportType:\s*(\d+)/);
    if (!head || !ids) throw new Error(`unreadable sport record: ${block.slice(0, 120)}`);
    const start = block.match(/startTimestamp=(\d+)/);
    const end = block.match(/endTimestamp=(\d+)/);
    return {
      activityId: ids[1],
      sportType: Number(ids[2]),
      name: head[1],
      date: head[2],
      startTimestamp: start ? Number(start[1]) : null,
      endTimestamp: end ? Number(end[1]) : null,
      text: block.trimEnd(),
    };
  });
  if (declared && Number(declared[1]) !== entries.length) {
    throw new Error(`the list declares ${declared[1]} records but ${entries.length} were read`);
  }
  if (!declared && entries.length === 0 && !/^No sport records found/i.test(body)) {
    throw new Error(`unrecognized sport records result: ${body.slice(0, 120)}`);
  }
  return entries;
}

/** The activity's local start date: its timestamp in Denver, else COROS's own date. */
const activityLocalDate = (entry) =>
  entry.startTimestamp ? localDate(entry.startTimestamp * 1000) : entry.date;

/**
 * The daily-health calls for a window (AC3). Range tools get the whole window;
 * "last N days" tools get D − 10 through D; sleep HRV is split into ranges of
 * at most 7 days. Recovery and fitness take no date: they are the state as of
 * `fetched_at` (sync plan §2).
 */
export function healthCalls({ start, end, recentDays }) {
  return [
    ['queryDailyHealthData', { days: recentDays }],
    ['querySleepOverview', { startDate: corosDate(start), endDate: corosDate(end) }],
    ['queryRestingHeartRate', { days: recentDays }],
    ['queryTrainingLoadAssessment', { days: recentDays }],
    ...chunkRange(start, end).map(([from, to]) =>
      ['querySleepHrv', { startDate: corosDate(from), endDate: corosDate(to) }]),
    ['queryRecoveryStatus', {}],
    ['queryFitnessAssessmentOverview', {}],
  ];
}

/**
 * Every tool this module calls, checked against `tools/list` before a run so a
 * renamed tool fails loudly up front. (#152's spec named `querySleepData`;
 * the live server calls it `querySleepOverview`.)
 */
export const REQUIRED_TOOLS = [
  LIST_TOOL, DETAIL_TOOL, 'queryDailyHealthData', 'querySleepOverview', 'queryRestingHeartRate',
  'queryTrainingLoadAssessment', 'querySleepHrv', 'queryRecoveryStatus', 'queryFitnessAssessmentOverview',
];

function guardPayload(tool, payload) {
  if (FIT_URL.test(payload)) throw new CorosToolError(tool, 'payload contains a FIT download URL; not archived');
}

/**
 * @returns {Promise<{ window: object, activities: { created: number, updated: number,
 *   unchanged: number }, failures: string[], health: string | null }>}
 *   `failures` is empty on a clean run. The caller exits non-zero otherwise.
 * @throws CorosUnavailableError when the activity list cannot be fetched.
 */
export async function ingest({ client, archive, now = Date.now(), log = console.log, retry = {} }) {
  const window = syncWindow(now);
  const summary = { window, activities: { created: 0, updated: 0, unchanged: 0 }, failures: [], health: null };
  log(`Window ${window.start} to ${window.end} (run date ${window.runDate}, America/Denver).`);

  // --- activities ---------------------------------------------------------
  const listArgs = { startDate: corosDate(window.start), endDate: corosDate(window.end), limit: SPORT_RECORDS_LIMIT };
  let listText;
  try {
    listText = await callTool(client, LIST_TOOL, listArgs, { retry });
  } catch (err) {
    throw new CorosUnavailableError(`${LIST_TOOL} failed, so no activity was fetched: ${err.message}`);
  }
  // A list that cannot be read ends the run too, but it is a format change to
  // fix in parseSportRecords, not an outage to wait out.
  const entries = parseSportRecords(listText);
  if (entries.length >= SPORT_RECORDS_LIMIT) {
    summary.failures.push(`${LIST_TOOL} returned ${entries.length} records, its limit; the list may be truncated`);
  }
  log(`${entries.length} ${entries.length === 1 ? 'activity' : 'activities'} in the window.`);

  for (const entry of entries) {
    const args = { labelId: entry.activityId, sportType: entry.sportType };
    try {
      const payload = await callTool(client, DETAIL_TOOL, args, { retry });
      guardPayload(DETAIL_TOOL, payload);
      const { status, fileId } = await archive.upsertActivity({
        activityId: entry.activityId,
        localDate: activityLocalDate(entry),
        tool: DETAIL_TOOL,
        args,
        listEntry: entry,
        payload,
      });
      summary.activities[status] += 1;
      log(`  activity ${entry.activityId} (${entry.name}, ${entry.date}): ${status} ${fileId}`);
    } catch (err) {
      if (err instanceof DriveAuthError) throw err;
      const message = `activity ${entry.activityId}: ${redact(err.message || String(err))}`;
      summary.failures.push(message);
      log(`  FAILED ${message}`);
    }
  }

  // --- daily health -------------------------------------------------------
  // All or nothing: a bundle missing one tool's payload would hash differently
  // and read as "no data". The next run fetches the whole bundle again.
  try {
    const calls = [];
    for (const [tool, args] of healthCalls(window)) {
      const payload = await callTool(client, tool, args, { retry });
      guardPayload(tool, payload);
      calls.push({ tool, args, payload });
    }
    const { status, fileId } = await archive.upsertHealth({
      runDate: window.runDate, window: { start: window.start, end: window.end }, calls,
    });
    summary.health = status;
    log(`  health ${window.runDate} (${calls.length} calls): ${status} ${fileId}`);
  } catch (err) {
    if (err instanceof DriveAuthError) throw err;
    const message = `health ${window.runDate}: ${redact(err.message || String(err))}; bundle not written`;
    summary.failures.push(message);
    log(`  FAILED ${message}`);
  }

  return summary;
}
