// Set corrections through the API (#132).
//
// Resolution — which row "Bench Press set 2 [primary]" means — happens in the
// Apps Script API now (#134). What stays here is everything that needs no
// sheet: the per-entry checks agents already know the wording of, and
// splitting a batch too large for one request.
//
// The API functions and the exercise resolver are passed in rather than
// imported, so this can be tested against fakes without a network.

import { ApiError, chunkByPayload } from './api.js';
import { SET_UPDATE_FIELDS, SET_UPDATE_KEYS, findUnknownFields } from './domain.js';

/** `updates[i] "ref" set n: msg` — the per-entry error format agents know. */
export const entryError = (i, u, msg) => `updates[${i}] "${u.exercise}" set ${u.set_number}: ${msg}`;

/** An API message made of per-entry errors, which the server joins with "; ". */
export const isEntryErrors = (message) => /^updates\[\d+\]/.test(message);

/**
 * Split the API's joined per-entry errors and put every index back into the
 * caller's numbering. `entries[k].i` is where the k-th entry sent sat in the
 * original batch — a chunk, or only the entries that passed the local checks.
 *
 * Splits only where a new entry starts: one message can itself contain "; "
 * (the server's slot descriptions are joined with it).
 */
export function remapEntryErrors(message, entries) {
  return message
    .split(/; (?=updates\[\d+\])/)
    .map((m) => m.replace(/updates\[(\d+)\]/g, (_, k) => `updates[${entries[Number(k)].i}]`));
}

const entryIndex = (m) => Number(m.match(/^updates\[(\d+)\]/)[1]);
const byEntryIndex = (a, b) => entryIndex(a) - entryIndex(b);

/** For a single-entry call: the bare reason, without the batch prefix. */
export const stripEntryPrefix = (message) => message.replace(/^updates\[0\] "[^"]*" set [^:]*: /, '');

/** Carries every per-entry problem, so a tool can list them all at once. */
export class EntryErrors extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'EntryErrors';
    this.errors = errors;
  }
}

/**
 * The first failing check for one entry, in the order and words the old
 * planSetUpdates used — unknown field, then nothing to change, then the
 * exercise reference. None of them needs the sheet, so they stay client-side,
 * and the exercise error keeps its "Use thrive_list_exercises" pointer.
 */
export function precheckSetUpdate(u, resolveExercise) {
  const unknown = findUnknownFields(u, SET_UPDATE_KEYS);
  if (unknown.length) {
    return `unknown field ${unknown.map((k) => `"${k}"`).join(', ')} — accepted: ${SET_UPDATE_KEYS.join(', ')}`;
  }
  if (!SET_UPDATE_FIELDS.some((f) => u[f] !== undefined)) {
    return `nothing to change — pass at least one of ${SET_UPDATE_FIELDS.join(', ')}`;
  }
  try {
    resolveExercise(u.exercise);
  } catch (err) {
    return err.message;
  }
  return null;
}

/** Which set a resolved change targets, in domain terms — never a row. */
const setIdentity = (s) => `${s.workout_id}|${s.exercise_id}|${s.exercise_order}|${s.set_number}`;

const wrapFor = (workoutId) => (run) => ({ workout_id: workoutId, updates: run.map((e) => e.u) });

/**
 * Resolve `entries` ([{ i, u }]) through the API without writing, chunked to
 * fit. Returns changes and errors in the caller's numbering.
 *
 * Within one request the API catches two entries aiming at the same set.
 * Across chunks it cannot see that, so it is checked here, on the resolved
 * set identities.
 */
async function previewEntries(workoutId, entries, { previewSetUpdates, limit }) {
  const chunks = chunkByPayload(entries, wrapFor(workoutId), limit);
  const changes = [];
  const errors = [];

  for (const chunk of chunks) {
    try {
      const res = await previewSetUpdates(workoutId, chunk.map((e) => e.u));
      changes.push(...res.changes.map((c) => ({ ...c, index: chunk[c.index].i })));
    } catch (err) {
      if (!(err instanceof ApiError) || !isEntryErrors(err.message)) throw err;
      errors.push(...remapEntryErrors(err.message, chunk));
    }
  }

  if (chunks.length > 1) {
    const seen = new Map();
    for (const c of [...changes].sort((a, b) => a.index - b.index)) {
      const key = setIdentity(c.before);
      if (seen.has(key)) {
        const { u } = entries.find((e) => e.i === c.index);
        errors.push(entryError(c.index, u, `targets the same set as updates[${seen.get(key)}] — combine them into one entry`));
      } else {
        seen.set(key, c.index);
      }
    }
  }
  return { changes, errors };
}

/**
 * Validate a whole batch, then apply it (#132 AC2, AC5).
 *
 * Common case: one request, in which the API resolves and writes atomically.
 * A batch too large for one request is previewed in full first — so an
 * invalid entry anywhere still means nothing is written — then applied chunk
 * by chunk, each chunk atomic server-side (#134 AC2). If a later chunk fails,
 * the error names the entries earlier chunks already wrote rather than
 * implying nothing happened.
 *
 * `deps`: { resolveExercise, previewSetUpdates, updateSets, limit? }
 */
export async function planAndApplySetUpdates(workoutId, updates, deps) {
  const { resolveExercise, updateSets, limit } = deps;
  const errors = [];
  const passing = [];
  updates.forEach((u, i) => {
    const problem = precheckSetUpdate(u, resolveExercise);
    if (problem) errors.push(entryError(i, u, problem));
    else passing.push({ i, u });
  });

  const chunks = chunkByPayload(passing, wrapFor(workoutId), limit);

  if (!errors.length && chunks.length === 1) {
    try {
      return (await updateSets(workoutId, updates)).changes;
    } catch (err) {
      if (err instanceof ApiError && isEntryErrors(err.message)) {
        throw new EntryErrors(remapEntryErrors(err.message, passing).sort(byEntryIndex));
      }
      throw err;
    }
  }

  // Resolve everything that passed the local checks too, so the caller sees
  // every problem at once rather than one round trip per mistake (#119).
  if (passing.length) errors.push(...(await previewEntries(workoutId, passing, deps)).errors);
  if (errors.length) throw new EntryErrors(errors.sort(byEntryIndex));

  const applied = [];
  for (const [n, chunk] of chunks.entries()) {
    try {
      const res = await updateSets(workoutId, chunk.map((e) => e.u));
      applied.push(...res.changes.map((c) => ({ ...c, index: chunk[c.index].i })));
    } catch (err) {
      throw new Error(
        `${err.message}\n\nChunk ${n + 1} of ${chunks.length} failed and wrote nothing, but ` +
        `${applied.length} of ${updates.length} entries were already written by earlier chunks` +
        (applied.length ? `: ${applied.map((c) => `updates[${c.index}]`).join(', ')}` : '') +
        '. Set updates only set values, so re-running the whole batch once the cause is fixed is safe.',
      );
    }
  }
  return applied;
}
