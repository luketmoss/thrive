// Readings deleted in the Withings app (#215).
//
// `getmeas` silently omits a deleted group once the deletion has propagated:
// no flag, no tombstone. So absence from a **complete** fetch is the only
// signal, and the run asks the API to delete the window's rows whose grpid it
// did not return. The compare and the delete are one API action
// (`reconcileBodyMeasurements`), under the script lock and a cap; this module
// decides whether to ask at all, sizes the request, and records the answer.
//
// It deletes user data rows, so it is conservative at every step:
// - never called after an incomplete fetch or a failed archive write
//   (`withingsRun` owns that gate);
// - at most `WITHINGS_MAX_DELETIONS` (default 5) rows per run, across every
//   request the run makes; over it the API deletes nothing and the run is
//   `partial`;
// - an empty answer against a window holding rows is refused by the API,
//   unless the owner set the cap by hand (`allow_empty`), having checked.

import { localDate } from './dates.mjs';
import { MAX_ENCODED_PAYLOAD } from './thrive-api.mjs';

export const DEFAULT_MAX_DELETIONS = 5;

/**
 * The run's cap: `WITHINGS_MAX_DELETIONS` when set (a `max_deletions`
 * workflow_dispatch input), else the default. The schedule never sets it.
 * Anything but a positive integer is an error, never a silent default.
 *
 * @returns {{ max: number, explicit: boolean }}
 */
export function maxDeletionsFrom(env = {}) {
  const raw = env.WITHINGS_MAX_DELETIONS;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { max: DEFAULT_MAX_DELETIONS, explicit: false };
  }
  const text = String(raw).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`WITHINGS_MAX_DELETIONS must be a positive integer, got "${text}"`);
  }
  return { max: Number(text), explicit: true };
}

/**
 * `from`..`to` split into consecutive, gapless date ranges whose request
 * fits the API's payload limit, each carrying the grpids fetched for its
 * dates. A normal run's 30 days fit one request; only a backfill's history
 * needs more. Every range but an empty fetch's one holds at least one grpid,
 * so no range is mistaken for an empty answer.
 *
 * @param {{ from: string, to: string, present: { grpid: string, date: string }[],
 *   extra?: object, limit?: number }} args
 *   `extra` is the rest of the payload, so its size is counted too.
 * @returns {{ from: string, to: string, present_grpids: string[] }[]}
 */
export function planReconcile({ from, to, present, extra = {}, limit = MAX_ENCODED_PAYLOAD }) {
  const byDate = new Map();
  for (const { grpid, date } of present) {
    if (date < from || date > to) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(grpid);
  }
  const dates = [...byDate.keys()].sort();
  const size = (p) => encodeURIComponent(JSON.stringify({ ...p, ...extra })).length;
  if (!dates.length) return [{ from, to, present_grpids: [] }];

  const chunks = [];
  let current = { from, to, present_grpids: [] };
  for (const date of dates) {
    const ids = byDate.get(date);
    const grown = { ...current, present_grpids: [...current.present_grpids, ...ids] };
    if (current.present_grpids.length && size(grown) > limit) {
      current.to = previousDay(date);
      chunks.push(current);
      current = { from: date, to, present_grpids: [...ids] };
    } else {
      current = grown;
    }
    if (size(current) > limit) {
      throw new Error(`Withings returned too many groups dated ${date} to check for deletions in one request.`);
    }
  }
  chunks.push(current);
  return chunks;
}

const previousDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** The run's refusal line (#215 AC3): no grpid, so safe anywhere. */
export const refusalDetail = (n, cap) =>
  `refused to delete ${n} BodyMeasurements rows (cap ${cap}): check Withings, ` +
  `then re-run with WITHINGS_MAX_DELETIONS=${n}`;

/** The `notes` line for deleted rows (#215 AC5). Private: it names grpids. */
export const deletedNote = (deleted) => `deleted in Withings: ${deleted.length} (${deleted.join(', ')})`;

/**
 * Ask the API to delete the window's rows Withings no longer returns, then
 * mark each deleted group's archive file. Call only after a complete fetch
 * and a successful upsert.
 *
 * @param {{ api: object, archive: object, from: string, to: string, groups: object[],
 *   env: object, at: string }} args  `at` is the run's timestamp.
 * @returns {Promise<{ deleted: string[], refused: string|null, error: Error|null,
 *   markFailures: string[] }>}  `refused` is the refusal line, when the cap refused.
 */
export async function reconcileDeletions({ api, archive, from, to, groups, env, at }) {
  const out = { deleted: [], refused: null, error: null, markFailures: [] };
  let cap;
  let present = [];
  try {
    cap = maxDeletionsFrom(env);
    present = groups.map((g) => ({ grpid: String(g.grpid), date: localDate(Number(g.date) * 1000) }));
    const extra = { max_deletions: cap.max, ...(cap.explicit ? { allow_empty: true } : {}) };
    const chunks = planReconcile({ from, to, present, extra });
    for (const [i, chunk] of chunks.entries()) {
      const remaining = cap.max - out.deleted.length;
      if (remaining < 1) {
        // A later range could still hold deletions; count none as checked.
        out.refused = `deletion cap ${cap.max} reached with ${chunks.length - i} date range(s) unchecked: ` +
          'check Withings, then re-run with a larger WITHINGS_MAX_DELETIONS';
        break;
      }
      const res = await api.reconcileBodyMeasurements({
        ...chunk, max_deletions: remaining, ...(cap.explicit ? { allow_empty: true } : {}),
      });
      if (res?.refused) {
        out.refused = refusalDetail(out.deleted.length + (res.would_delete ?? 0), cap.max) +
          (present.length ? '' : ' (Withings returned no groups for a window that holds rows)');
        break;
      }
      out.deleted.push(...(res?.deleted ?? []).map(String));
    }
  } catch (err) {
    out.error = err;
  }

  for (const grpid of out.deleted) {
    try {
      await archive.markDeleted(grpid, at);
    } catch (err) {
      out.markFailures.push(`Could not mark Withings group ${grpid} deleted in the archive: ` +
        `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
    }
  }
  return out;
}
