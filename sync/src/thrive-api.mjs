// The Thrive Apps Script API client for the sync (#165, shared with #166 and
// the Withings run, #198).
//
// The sync holds no row mapping: it sends domain objects keyed by field name,
// and apps-script/src/types.js owns the sheet's shape. This follows
// mcp-server/api.js: everything goes by GET with a URL-encoded `payload`,
// because Apps Script answers POST with a redirect that breaks anonymous
// callers, and that caps a request's size, so bulk writes are chunked here.

import { redact, registerSecret } from './redact.mjs';

/**
 * Largest URL-encoded payload sent, in characters. The API refuses a decoded
 * payload over 6000 (MAX_PAYLOAD_CHARS in apps-script/src/types.js); measuring
 * the encoded length is stricter, since percent-encoding only grows a string.
 */
export const MAX_ENCODED_PAYLOAD = 5000;

/** The API refused the call, or never reached the script. */
export class ThriveApiError extends Error {
  constructor(action, message) {
    super(`${action}: ${message}`);
    this.name = 'ThriveApiError';
    this.action = action;
  }
}

/** A response that was a Google page, not the script's JSON. */
class NotReachedError extends ThriveApiError {
  /** `status` is the HTTP status of the page; absent when `fetch` itself rejected. */
  constructor(action, message, status) {
    super(action, message);
    this.status = status;
  }
}

/** Base delays before each retry of a write that got a 404 page (#327), in ms. */
export const WRITE_RETRY_DELAYS_MS = [2000, 6000, 15000];
/** Most time, in ms, one client spends waiting to retry writes in all. */
export const WRITE_RETRY_BUDGET_MS = 90000;

/**
 * `THRIVE_API_URL` and `THRIVE_API_KEY`: the deployed web app's `/exec` URL
 * and its `API_KEY` script property. Actions secrets in CI; environment
 * variables for a local run. Missing either is an error naming both.
 */
export function loadThriveApiConfig(env = process.env) {
  const url = env.THRIVE_API_URL;
  const key = env.THRIVE_API_KEY;
  const missing = [['THRIVE_API_URL', url], ['THRIVE_API_KEY', key]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new ThriveApiError(
      'config',
      `${missing.join(' and ')} not set, so nothing was written to the sheet. Set the Actions ` +
      'secrets (or environment variables for a local run) to the Apps Script /exec URL and ' +
      'its API_KEY script property. See apps-script/README.md.',
    );
  }
  registerSecret(key);
  return { url, key };
}

/**
 * Split `items` into runs whose payload, built by `wrap(run)`, fits `limit`
 * once URL-encoded. Greedy and order-preserving; a single item too large to
 * send alone is an error, never truncated.
 */
export function chunkByPayload(items, wrap, limit = MAX_ENCODED_PAYLOAD) {
  const size = (run) => encodeURIComponent(JSON.stringify(wrap(run))).length;
  const chunks = [];
  let current = [];
  for (const item of items) {
    if (size([item]) > limit) {
      throw new Error(`A single entry is too large to send (${size([item])} encoded characters, limit ${limit}).`);
    }
    if (current.length && size([...current, item]) > limit) {
      chunks.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * `row` with `error_detail` shortened, if need be, so `{ row }` fits `limit`
 * once URL-encoded, marked so a reader knows text is missing. Percent-encoding
 * grows unevenly, so the cut is found by bisection on the encoded size.
 */
export function fitErrorDetail(row, limit = MAX_ENCODED_PAYLOAD) {
  const size = (r) => encodeURIComponent(JSON.stringify({ row: r })).length;
  const detail = String(row.error_detail ?? '');
  if (size(row) <= limit) return row;
  const withCut = (n) => ({
    ...row,
    error_detail: `${detail.slice(0, n)} … [truncated: ${n} of ${detail.length} characters]`,
  });
  let lo = 0;
  let hi = detail.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(withCut(mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  const out = withCut(lo);
  if (size(out) > limit) throw new Error('A SyncLog row is too large to send even without its error_detail.');
  return out;
}

/**
 * @param {{ url: string, key: string, fetchImpl?: typeof fetch,
 *   readRetryDelaysMs?: number[], wait?: (ms: number) => Promise<void> }} opts
 */
export function createThriveApi({
  url, key, fetchImpl = fetch, readRetryDelaysMs = [1000, 3000],
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  writeRetryDelaysMs = WRITE_RETRY_DELAYS_MS, writeRetryBudgetMs = WRITE_RETRY_BUDGET_MS,
  random = Math.random,
}) {
  // One client serves one process, so these are per-process (#327 AC4/AC5).
  let budgetLeftMs = writeRetryBudgetMs;
  const tally = { retried: 0, landed: 0, gaveUp: 0, byAction: new Map() };

  /** One request. Every API response is `{ success, data?, error? }`. */
  async function call(action, params = {}, payload) {
    const target = new URL(url);
    target.searchParams.set('action', action);
    target.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') target.searchParams.set(k, String(v));
    }
    if (payload !== undefined) target.searchParams.set('payload', JSON.stringify(payload));

    let res;
    try {
      res = await fetchImpl(target, { redirect: 'follow' });
    } catch (err) {
      throw new NotReachedError(action, `request failed: ${redact(err.message || String(err))}`);
    }
    const body = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new NotReachedError(
        action,
        `the API returned ${res.status} with a web page instead of JSON, so the request never ` +
        'reached the script. Check that THRIVE_API_URL is the /exec URL of the web-app ' +
        'deployment. Apps Script also serves these briefly under load.',
        res.status,
      );
    }
    if (!parsed.success) throw new ThriveApiError(action, redact(parsed.error || 'failed'));
    return parsed.data;
  }

  /** A read, retried when Google answers with a page. A refusal is never retried. */
  async function get(action, params) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call(action, params);
      } catch (err) {
        if (!(err instanceof NotReachedError) || attempt >= readRetryDelaysMs.length) throw err;
        await wait(readRetryDelaysMs[attempt]);
      }
    }
  }

  /**
   * A write, sent once, whatever comes back. A page instead of JSON does not
   * prove it did not land; the nightly window re-sends everything, so the next
   * run heals it. Retry is opted into per call, by `writeRetrying`.
   */
  const write = (action, payload) => call(action, {}, payload);

  /**
   * A write that is re-sent, byte for byte, when Google answers HTTP 404 with
   * a page instead of JSON (#327). Apps Script serves these briefly under
   * load; two runs lost an activity or their SyncLog row to one.
   *
   * Only that class. Nothing proves a 404 page means the script never ran, so
   * the gate is narrower than NotReachedError: a `fetch` rejection or any
   * other page (a 200 sign-in, a 5xx or timeout) is exactly where a write may
   * have applied, and a JSON answer, `Lock timeout` included, proves the
   * script ran. None of those is retried. And only calls whose replay of a
   * request that did land converges, which is what makes the gate safe to
   * lean on:
   *  - upsertSyncedWorkout is keyed on (source, source_activity_id); a replay
   *    finds the row with every field already equal, keeps nothing, flags no
   *    edit, and answers `updated`.
   *  - upsertDailyHealth (by date) and upsertBodyMeasurements (by grpid)
   *    carry the same synced_at and rewrite the same row.
   *  - rebuildDailySummary is a pure function of its sources and computed_at.
   *  - appendSyncLog answers `exists` for a run_id already in the tab.
   *  - enrichWorkout is not strictly idempotent: if the first call landed,
   *    the replay answers `unchanged` with `filled` missing what the first
   *    call filled, so a field cleared in Thrive in between is refilled once.
   *    That needs a 404 page that nonetheless ran the script; accepted.
   *  - reconcileBodyMeasurements is excluded: a replay finds nothing left to
   *    delete and answers `deleted: []`, so the client's archive marking
   *    would be skipped.
   *
   * Up to three retries after 2, 6 and 15 s, each scaled by 0.75-1.25, and at
   * most 90 s of waiting per process: once spent, a 404 page fails at once
   * with the message it always had.
   */
  async function writeRetrying(action, payload) {
    let retries = 0;
    const finish = (ok) => {
      if (!retries) return;
      tally.retried += 1;
      tally[ok ? 'landed' : 'gaveUp'] += 1;
      tally.byAction.set(action, (tally.byAction.get(action) ?? 0) + 1);
    };
    for (;;) {
      let data;
      try {
        data = await call(action, {}, payload);
      } catch (err) {
        const retryable = err instanceof NotReachedError && err.status === 404;
        const base = writeRetryDelaysMs[retries];
        const delay = retryable && base !== undefined ? Math.round(base * (0.75 + random() * 0.5)) : null;
        if (delay === null || delay > budgetLeftMs) {
          finish(false);
          throw err;
        }
        budgetLeftMs -= delay;
        retries += 1;
        await wait(delay);
        continue;
      }
      finish(true);
      return data;
    }
  }

  /**
   * `{ rows, synced_at }` upserts, chunked so each call fits the payload
   * limit, every batch carrying the run's one timestamp. If a later batch
   * fails, the error says how many rows already landed.
   */
  async function upsertRows(action, rows, syncedAt) {
    const totals = { appended: 0, updated: 0, batches: 0 };
    if (!rows.length) return totals;
    const chunks = chunkByPayload(rows, (run) => ({ rows: run, synced_at: syncedAt }));
    let written = 0;
    for (const [i, chunk] of chunks.entries()) {
      try {
        const data = await writeRetrying(action, { rows: chunk, synced_at: syncedAt });
        totals.appended += data?.appended ?? 0;
        totals.updated += data?.updated ?? 0;
      } catch (err) {
        throw new ThriveApiError(
          action,
          `${err.message} (${written} of ${rows.length} rows were already written; ` +
          `batch ${i + 1} of ${chunks.length} failed)`,
        );
      }
      written += chunk.length;
      totals.batches += 1;
    }
    return totals;
  }

  return {
    get,
    write,

    /**
     * What the write retries did, for the run's notes (#327): `null` when
     * none happened.
     * @returns {{ retried: number, landed: number, gaveUp: number } | null}
     */
    retryCounts() {
      return tally.retried ? { retried: tally.retried, landed: tally.landed, gaveUp: tally.gaveUp } : null;
    },

    /** The SyncLog `notes` line for those retries, or `''` when there were none. */
    retryNote() {
      if (!tally.retried) return '';
      const by = [...tally.byAction].map(([a, n]) => `${a} x${n}`).join(', ');
      return `Apps Script served a 404 page on write requests: ${tally.retried} retried, ` +
        `${tally.landed} landed, ${tally.gaveUp} gave up (${by})`;
    },

    /**
     * DailyHealth rows by date (#165 AC4), batched under the payload limit.
     * If a later batch fails, the error says how many rows already landed.
     *
     * @returns {Promise<{ appended: number, updated: number, batches: number }>}
     */
    upsertDailyHealth(rows, syncedAt) {
      return upsertRows('upsertDailyHealth', rows, syncedAt);
    },

    /**
     * BodyMeasurements rows by Withings grpid (#198 AC4), each rewritten
     * whole, batched under the payload limit exactly as upsertDailyHealth.
     *
     * @returns {Promise<{ appended: number, updated: number, batches: number }>}
     */
    upsertBodyMeasurements(rows, syncedAt) {
      return upsertRows('upsertBodyMeasurements', rows, syncedAt);
    },

    /**
     * One synced activity, merged into Workouts by vendor ID (#166). The
     * three-way merge runs in the API, so an edit made in Thrive between a
     * read and a write cannot be lost. A 404 page is retried (see
     * `writeRetrying`).
     *
     * @param {{ source: string, source_activity_id: string, incoming: object,
     *   last_written: object | null, raw_ref: string, synced_at: string }} payload
     * @returns {Promise<{ status: 'created' | 'updated' | 'deleted', id?: string,
     *   written?: object, kept?: string[] }>}
     */
    upsertSyncedWorkout(payload) {
      return writeRetrying('upsertSyncedWorkout', payload);
    },

    /**
     * One COROS strength session, offered to its hand-logged weight row
     * (#155). The match, the fill and the write run in the API, in one
     * execution. A 404 page is retried (see `writeRetrying`).
     *
     * @param {{ source_activity_id: string, activity: object,
     *   last_written: { workout_id: string, filled: string[] } | null,
     *   raw_ref: string, synced_at: string }} payload
     * @returns {Promise<{ status: 'enriched' | 'unchanged' | 'unmatched', id?: string,
     *   linked?: boolean, filled?: string[], reason?: string,
     *   candidates?: { id: string, time: string }[],
     *   written?: { workout_id: string, filled: string[] } }>}
     */
    enrichWorkout(payload) {
      return writeRetrying('enrichWorkout', payload);
    },

    /**
     * Delete the BodyMeasurements rows in `from`..`to` whose grpid is not in
     * `present_grpids` (#215): readings deleted in Withings. The compare and
     * the delete run in the API, under its lock, capped at `max_deletions`.
     * Sent once, never retried (see `writeRetrying`); the run sizes `present_grpids` to fit.
     *
     * @param {{ from: string, to: string, present_grpids: string[],
     *   max_deletions: number, allow_empty?: boolean }} payload
     * @returns {Promise<{ deleted: string[], refused: boolean, would_delete?: number }>}
     */
    reconcileBodyMeasurements(payload) {
      return write('reconcileBodyMeasurements', payload);
    },

    /** Recompute DailySummary for `from`..`to`, inclusive, stamped `computedAt`. */
    rebuildDailySummary(from, to, computedAt) {
      return writeRetrying('rebuildDailySummary', { from, to, computed_at: computedAt });
    },

    /**
     * One run's SyncLog row (#156), keyed by field name. `error_detail` is cut
     * to fit the payload limit first, so a run with many failures still logs.
     *
     * `log: 'withings'` sends it to WithingsSyncLog instead (#200). Absent, the
     * request is exactly what it was before: COROS's SyncLog.
     *
     * @param {object} row
     * @param {{ log?: 'withings' }} [opts]
     * @returns {Promise<{ status: 'appended' | 'exists', run_id: string }>}
     */
    appendSyncLog(row, { log } = {}) {
      if (!log) return writeRetrying('appendSyncLog', { row: fitErrorDetail(row) });
      // The `log` field is sent too, so the cut leaves room for it.
      const room = encodeURIComponent(`,"log":${JSON.stringify(log)}`).length;
      return writeRetrying('appendSyncLog', { row: fitErrorDetail(row, MAX_ENCODED_PAYLOAD - room), log });
    },

    /**
     * The newest `limit` SyncLog rows, newest first by `started_at`. A read, so
     * retried. `log: 'withings'` reads WithingsSyncLog instead (#200).
     */
    getSyncLog(limit = 1, { log } = {}) {
      return get('getSyncLog', log ? { limit, log } : { limit });
    },
  };
}
