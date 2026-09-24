// The Thrive Apps Script API client for the sync (#165, shared with #166).
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
class NotReachedError extends ThriveApiError {}

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
 * @param {{ url: string, key: string, fetchImpl?: typeof fetch,
 *   readRetryDelaysMs?: number[], wait?: (ms: number) => Promise<void> }} opts
 */
export function createThriveApi({
  url, key, fetchImpl = fetch, readRetryDelaysMs = [1000, 3000],
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
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
   * A write, sent once. A page instead of JSON does not prove it did not
   * land; the nightly window re-sends everything, so the next run heals it.
   */
  const write = (action, payload) => call(action, {}, payload);

  return {
    get,
    write,

    /**
     * DailyHealth rows by date (#165 AC4), batched under the payload limit.
     * If a later batch fails, the error says how many rows already landed.
     *
     * @returns {Promise<{ appended: number, updated: number, batches: number }>}
     */
    async upsertDailyHealth(rows, syncedAt) {
      const totals = { appended: 0, updated: 0, batches: 0 };
      if (!rows.length) return totals;
      const chunks = chunkByPayload(rows, (run) => ({ rows: run, synced_at: syncedAt }));
      let written = 0;
      for (const [i, chunk] of chunks.entries()) {
        try {
          const data = await write('upsertDailyHealth', { rows: chunk, synced_at: syncedAt });
          totals.appended += data?.appended ?? 0;
          totals.updated += data?.updated ?? 0;
        } catch (err) {
          throw new ThriveApiError(
            'upsertDailyHealth',
            `${err.message} (${written} of ${rows.length} rows were already written; ` +
            `batch ${i + 1} of ${chunks.length} failed)`,
          );
        }
        written += chunk.length;
        totals.batches += 1;
      }
      return totals;
    },

    /**
     * One synced activity, merged into Workouts by vendor ID (#166). The
     * three-way merge runs in the API, so an edit made in Thrive between a
     * read and a write cannot be lost. Sent once, like every write.
     *
     * @param {{ source: string, source_activity_id: string, incoming: object,
     *   last_written: object | null, raw_ref: string, synced_at: string }} payload
     * @returns {Promise<{ status: 'created' | 'updated' | 'deleted', id?: string,
     *   written?: object, kept?: string[] }>}
     */
    upsertSyncedWorkout(payload) {
      return write('upsertSyncedWorkout', payload);
    },

    /** Recompute DailySummary for `from`..`to`, inclusive, stamped `computedAt`. */
    rebuildDailySummary(from, to, computedAt) {
      return write('rebuildDailySummary', { from, to, computed_at: computedAt });
    },
  };
}
