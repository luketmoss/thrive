// Thrive Apps Script API client (#132).
//
// The MCP server holds no row mapping. Every read and write goes through the
// API deployed from apps-script/, which owns the sheet's shape. This file is
// the whole of that boundary: nothing else in mcp-server/ knows the sheet
// exists.
//
// Writes go by GET with a URL-encoded `payload`, because Apps Script answers
// POST with a redirect that breaks anonymous callers — the same constraint
// Hive's client documents. That caps a request's size, so bulk writes are
// chunked here (chunkByPayload) rather than hoping they fit.

export const API_URL = process.env.THRIVE_API_URL;
export const API_KEY = process.env.THRIVE_API_KEY;

/**
 * Largest URL-encoded payload this client will send, in characters.
 *
 * The API refuses a decoded payload over 6000 characters (MAX_PAYLOAD_CHARS in
 * apps-script/src/types.js). Measuring the *encoded* length here is stricter —
 * percent-encoding only ever grows a string — so anything this lets through
 * is guaranteed under the server's limit, and the whole URL stays well inside
 * what Google's front end accepts.
 */
export const MAX_ENCODED_PAYLOAD = 5000;

export class ApiError extends Error {
  constructor(action, message) {
    super(message);
    this.name = 'ApiError';
    this.action = action;
  }
}

/**
 * A response that never reached doGet — Google served a page instead of the
 * script's JSON. Usually misconfiguration, but Apps Script also serves these
 * transiently under bursts: #132's QA saw a run of 404 pages that cleared on
 * their own.
 */
class NotReachedError extends ApiError {}

/**
 * Backoff before each read retry. Writes are never retried — see apiWrite.
 * Overridable only so the tests need not sleep for real.
 */
const READ_RETRY_DELAYS_MS = (process.env.THRIVE_READ_RETRY_DELAYS_MS ?? '1000,3000')
  .split(',').filter(Boolean).map(Number);

/** One request. Every API response is `{ success, data?, error? }`. */
async function call(action, params = {}, payload) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (payload !== undefined) url.searchParams.set('payload', JSON.stringify(payload));

  const res = await fetch(url, { redirect: 'follow' });
  const body = await res.text();

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON means the request never reached doGet: a Google sign-in page,
    // an "Access denied" page, or a 404 for a deployment that is not a web
    // app. Each looks nothing like its cause, so name the likely ones.
    throw new NotReachedError(
      action,
      `The Thrive API returned ${res.status} with a web page instead of JSON, so the request ` +
      'never reached the script. If this keeps happening, check that THRIVE_API_URL is the ' +
      '/exec URL of a web-app deployment with anonymous access, and that its owner has ' +
      'authorized it by opening that URL once in a browser (apps-script/README.md). Apps ' +
      'Script also serves these pages briefly under load, so a one-off is usually transient.',
    );
  }

  if (!parsed.success) throw new ApiError(action, parsed.error || `${action} failed`);
  return parsed.data;
}

/**
 * A read, retried when Google answers with a page instead of the script.
 *
 * Safe because a read changes nothing. An API refusal (`success: false`) is
 * the script's real answer and is never retried.
 */
export async function apiGet(action, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call(action, params);
    } catch (err) {
      if (!(err instanceof NotReachedError) || attempt >= READ_RETRY_DELAYS_MS.length) throw err;
      await new Promise((r) => setTimeout(r, READ_RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * A write, sent exactly once. Never retried automatically: a page instead of
 * JSON does not prove the write did not land, and retrying a create would
 * then duplicate it. The error goes back to the agent, which can read before
 * deciding to try again.
 */
export const apiWrite = (action, payload) => call(action, {}, payload);

/**
 * Split `items` into runs whose payload, built by `wrap(run)`, fits the limit.
 *
 * Greedy and order-preserving, so chunk boundaries fall between items and
 * never inside one. A single item too large to send alone is an error rather
 * than something to truncate.
 */
export function chunkByPayload(items, wrap, limit = MAX_ENCODED_PAYLOAD) {
  const size = (run) => encodeURIComponent(JSON.stringify(wrap(run))).length;
  const chunks = [];
  let current = [];

  for (const item of items) {
    const candidate = [...current, item];
    if (size(candidate) <= limit) {
      current = candidate;
      continue;
    }
    if (!current.length) {
      throw new Error(
        `A single entry is too large to send (${size([item])} encoded characters, limit ${limit}).`,
      );
    }
    chunks.push(current);
    current = [item];
    if (size(current) > limit) {
      throw new Error(
        `A single entry is too large to send (${size(current)} encoded characters, limit ${limit}).`,
      );
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// --- reads ----------------------------------------------------------

export const fetchWorkouts = () => apiGet('getWorkouts');
export const fetchWorkout = (id) => apiGet('getWorkout', { id });
export const fetchSets = (workoutId) => apiGet('getSets', { workout_id: workoutId });
export const fetchExercises = () => apiGet('getExercises');
/** Templates arrive grouped, exercises ordered, templates sorted by name. */
export const fetchTemplates = () => apiGet('getTemplates');

// --- writes ---------------------------------------------------------

export const createWorkout = (workout) => apiWrite('createWorkout', { data: workout });
export const updateWorkout = (id, changes) => apiWrite('updateWorkout', { id, changes });
export const deleteWorkout = (id) => apiWrite('deleteWorkout', { id });

export const createExercise = (data) => apiWrite('createExercise', { data });
export const updateExercise = (id, changes) => apiWrite('updateExercise', { id, changes });
export const deleteExercise = (id) => apiWrite('deleteExercise', { id });

export const createTemplate = (data) => apiWrite('createTemplate', { data });
export const replaceTemplate = (templateId, data) =>
  apiWrite('replaceTemplate', { template_id: templateId, data });

export const previewSetUpdates = (workoutId, updates) =>
  apiWrite('previewSetUpdates', { workout_id: workoutId, updates });
export const updateSets = (workoutId, updates) =>
  apiWrite('updateSets', { workout_id: workoutId, updates });

/**
 * Append set rows, chunked to fit (#132 AC5).
 *
 * If a later chunk fails, the error says how many rows already landed — a
 * failure that implied nothing happened would send the caller back to write
 * the early rows a second time.
 */
export async function appendSets(sets) {
  if (!sets.length) return 0;
  const chunks = chunkByPayload(sets, (run) => ({ sets: run }));
  let written = 0;
  for (const [i, chunk] of chunks.entries()) {
    try {
      await apiWrite('appendSets', { sets: chunk });
    } catch (err) {
      throw new Error(
        `${err.message} — ${written} of ${sets.length} set rows were already written ` +
        `(chunk ${i + 1} of ${chunks.length} failed).`,
      );
    }
    written += chunk.length;
  }
  return written;
}
