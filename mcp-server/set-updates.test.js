// #132 — set corrections through the API: local checks keep their wording,
// server errors come back in the caller's numbering, and a batch too large
// for one request is chunked without giving up all-or-nothing validation.
//
// The API is faked, but the fake resolves the way the real one does (see
// apps-script/src/sets.js): by exercise, section, order and set number, with
// per-entry errors joined by "; ".

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.THRIVE_API_URL ??= 'https://example.test/exec';
process.env.THRIVE_API_KEY ??= 'test-key';

const { ApiError } = await import('./api.js');
const {
  planAndApplySetUpdates, EntryErrors, remapEntryErrors, stripEntryPrefix, precheckSetUpdate,
} = await import('./set-updates.js');

const LIBRARY = [
  { id: 'ex_bench', name: 'Bench Press' },
  { id: 'ex_row', name: 'Row' },
];

function resolveExercise(ref) {
  const q = String(ref).trim().toLowerCase();
  const hit = LIBRARY.find((e) => e.id === q || e.name.toLowerCase() === q);
  if (!hit) throw new Error(`No exercise matching "${ref}". Use thrive_list_exercises to see what exists.`);
  return hit;
}

// Bench appears twice (warmup + primary), so an unnarrowed Bench is ambiguous.
const SETS = [
  { workout_id: 'w1', exercise_id: 'ex_bench', section: 'warmup', exercise_order: 1, set_number: 1, weight: '95', reps: '10', planned_reps: '', effort: '' },
  ...[1, 2, 3, 4].map((n) => ({ workout_id: 'w1', exercise_id: 'ex_bench', section: 'primary', exercise_order: 2, set_number: n, weight: '185', reps: '6', planned_reps: '6', effort: '' })),
  ...[1, 2, 3].map((n) => ({ workout_id: 'w1', exercise_id: 'ex_row', section: 'SS1', exercise_order: 3, set_number: n, weight: '135', reps: '8', planned_reps: '8', effort: '' })),
];

/** Resolve one batch like the API's planSetUpdates; throw joined entry errors. */
function serverPlan(updates) {
  const changes = [];
  const errors = [];
  const claimed = new Map();
  updates.forEach((u, i) => {
    const fail = (msg) => errors.push(`updates[${i}] "${u.exercise}" set ${u.set_number}: ${msg}`);
    const ex = resolveExercise(u.exercise);
    const slots = [...new Set(SETS
      .filter((s) => s.exercise_id === ex.id && (!u.section || s.section === u.section))
      .map((s) => s.exercise_order))];
    if (slots.length > 1) {
      return fail(`${ex.name} appears 2 times in workout w1 — [warmup] exercise_order 1, 1 sets; [primary] exercise_order 2, 4 sets. Pass section or exercise_order to say which set ${u.set_number} you mean.`);
    }
    const target = SETS.find((s) => s.exercise_id === ex.id && s.exercise_order === slots[0] && s.set_number === Number(u.set_number));
    if (!target) return fail(`No set ${u.set_number} of ${ex.name}.`);
    const key = `${target.exercise_order}|${target.set_number}|${target.exercise_id}`;
    if (claimed.has(key)) return fail(`targets the same set as updates[${claimed.get(key)}] — combine them into one entry`);
    claimed.set(key, i);
    const after = { ...target };
    for (const f of ['weight', 'reps', 'planned_reps', 'effort']) if (u[f] !== undefined) after[f] = u[f];
    changes.push({ index: i, exercise: { id: ex.id, name: ex.name }, slot: { section: target.section, exercise_order: target.exercise_order }, before: target, after });
  });
  if (errors.length) throw new ApiError('updateSets', errors.join('; '));
  return { changes };
}

function fakeApi({ failApplyOnCall } = {}) {
  const calls = { preview: [], apply: [] };
  return {
    calls,
    resolveExercise,
    previewSetUpdates: async (wid, updates) => { calls.preview.push(updates); return { ...serverPlan(updates), applied: false }; },
    updateSets: async (wid, updates) => {
      calls.apply.push(updates);
      if (failApplyOnCall === calls.apply.length) {
        throw new ApiError('updateSets', '1 set row moved since it was read (sheet rows 9) — the sheet changed underneath this call. Nothing was written; re-read the workout and retry.');
      }
      return { ...serverPlan(updates), applied: true };
    },
  };
}

const primary = (n, fields) => ({ exercise: 'Bench Press', section: 'primary', set_number: n, ...fields });

// --- the common case: one request ------------------------------------

test('a batch that fits is one atomic request', async () => {
  const api = fakeApi();
  const changes = await planAndApplySetUpdates('w1', [primary(1, { reps: '7' }), primary(2, { reps: '6' })], api);
  assert.equal(api.calls.apply.length, 1);
  assert.equal(api.calls.preview.length, 0);
  assert.deepEqual(changes.map((c) => c.after.reps), ['7', '6']);
});

test('server errors come back as a list, in the caller\'s numbering', async () => {
  const api = fakeApi();
  await assert.rejects(
    planAndApplySetUpdates('w1', [primary(1, { reps: '7' }), primary(9, { reps: '6' })], api),
    (err) => {
      assert.ok(err instanceof EntryErrors);
      assert.deepEqual(err.errors, ['updates[1] "Bench Press" set 9: No set 9 of Bench Press.']);
      return true;
    },
  );
});

// The server joins entries with "; " — and its slot descriptions contain "; "
// too. Splitting on every "; " would shred the ambiguity message.
test('an ambiguity message stays whole even though it contains "; "', async () => {
  const api = fakeApi();
  await assert.rejects(
    planAndApplySetUpdates('w1', [{ exercise: 'Bench Press', set_number: 1, reps: '7' }, primary(9, { reps: '1' })], api),
    (err) => {
      assert.equal(err.errors.length, 2);
      assert.match(err.errors[0], /^updates\[0\].*\[warmup\] exercise_order 1, 1 sets; \[primary\] exercise_order 2, 4 sets\. Pass section/);
      assert.match(err.errors[1], /^updates\[1\]/);
      return true;
    },
  );
});

test('a non-entry error — a moved row — passes through unchanged', async () => {
  const api = fakeApi({ failApplyOnCall: 1 });
  await assert.rejects(
    planAndApplySetUpdates('w1', [primary(1, { reps: '7' })], api),
    (err) => !(err instanceof EntryErrors) && /moved since it was read/.test(err.message),
  );
});

// --- local checks: wording and order agents already know --------------

test('local checks run first and keep their exact wording', () => {
  assert.match(precheckSetUpdate({ exercise: 'Bench Press', set_number: 1, rpe: '8' }, resolveExercise), /^unknown field "rpe" — accepted: exercise, set_number/);
  assert.match(precheckSetUpdate({ exercise: 'Bench Press', set_number: 1 }, resolveExercise), /^nothing to change — pass at least one of weight, reps, planned_reps, effort$/);
  assert.match(precheckSetUpdate({ exercise: 'Zercher', set_number: 1, reps: '5' }, resolveExercise), /Use thrive_list_exercises/);
  assert.equal(precheckSetUpdate(primary(1, { reps: '7' }), resolveExercise), null);
});

// Mixed failures: one entry fails locally, another fails on the server. The
// old code listed both, so this must too — and must write nothing.
test('local and server problems are reported together, sorted, and nothing is written', async () => {
  const api = fakeApi();
  await assert.rejects(
    planAndApplySetUpdates('w1', [
      primary(9, { reps: '6' }),                              // server: no such set
      { exercise: 'Zercher', set_number: 1, reps: '5' },      // local: unknown exercise
      primary(2, { reps: '6' }),                              // fine
    ], api),
    (err) => {
      assert.deepEqual(err.errors.map((e) => e.match(/^updates\[(\d+)\]/)[1]), ['0', '1']);
      assert.match(err.errors[0], /No set 9/);
      assert.match(err.errors[1], /No exercise matching "Zercher"/);
      return true;
    },
  );
  assert.equal(api.calls.apply.length, 0);
});

// --- chunking (#132 AC5) ----------------------------------------------

const WEEK = [
  ...[1, 2, 3, 4].map((n) => primary(n, { reps: String(n + 4), weight: '190' })),
  ...[1, 2, 3].map((n) => ({ exercise: 'Row', set_number: n, reps: '9', weight: '140' })),
];

test('an oversized batch is previewed in full, then applied chunk by chunk', async () => {
  const api = fakeApi();
  const changes = await planAndApplySetUpdates('w1', WEEK, { ...api, limit: 700 });
  assert.ok(api.calls.apply.length > 1, `expected several chunks, got ${api.calls.apply.length}`);
  assert.equal(api.calls.preview.flat().length, WEEK.length);
  assert.equal(api.calls.apply.flat().length, WEEK.length);
  // Indices are the caller's, not each chunk's.
  assert.deepEqual(changes.map((c) => c.index), WEEK.map((_, i) => i));
});

test('each chunk stays within the limit', async () => {
  const api = fakeApi();
  await planAndApplySetUpdates('w1', WEEK, { ...api, limit: 700 });
  for (const chunk of api.calls.apply) {
    const size = encodeURIComponent(JSON.stringify({ workout_id: 'w1', updates: chunk })).length;
    assert.ok(size <= 700, `chunk of ${size} chars`);
  }
});

test('an invalid entry in a later chunk means nothing is written at all', async () => {
  const api = fakeApi();
  const bad = [...WEEK, primary(9, { reps: '1' })];
  await assert.rejects(planAndApplySetUpdates('w1', bad, { ...api, limit: 700 }), EntryErrors);
  assert.equal(api.calls.apply.length, 0);
});

// The API only sees one chunk at a time, so it cannot catch two entries for
// the same set in different chunks. The client has to.
test('two entries for the same set in different chunks are caught', async () => {
  const api = fakeApi();
  const dup = [...WEEK, primary(1, { effort: 'Hard' })];
  await assert.rejects(
    planAndApplySetUpdates('w1', dup, { ...api, limit: 700 }),
    (err) => {
      assert.ok(err.errors.some((e) => /^updates\[7\].*targets the same set as updates\[0\]/.test(e)), err.errors.join('\n'));
      return true;
    },
  );
  assert.equal(api.calls.apply.length, 0);
});

test('a later chunk failing names the entries earlier chunks already wrote', async () => {
  const api = fakeApi({ failApplyOnCall: 2 });
  await assert.rejects(
    planAndApplySetUpdates('w1', WEEK, { ...api, limit: 700 }),
    (err) => {
      const firstChunk = api.calls.apply[0].length;
      assert.match(err.message, /moved since it was read/);
      assert.match(err.message, new RegExp(`Chunk 2 of \\d+ failed and wrote nothing, but ${firstChunk} of ${WEEK.length} entries were already written`));
      assert.match(err.message, /updates\[0\]/);
      return true;
    },
  );
});

// --- helpers ------------------------------------------------------------

test('remapEntryErrors rewrites every index, including cross-references', () => {
  const entries = [{ i: 4 }, { i: 9 }];
  assert.deepEqual(
    remapEntryErrors('updates[0] "A" set 1: no; updates[1] "A" set 1: targets the same set as updates[0] — combine them', entries),
    ['updates[4] "A" set 1: no', 'updates[9] "A" set 1: targets the same set as updates[4] — combine them'],
  );
});

test('stripEntryPrefix leaves the bare reason for a single-set call', () => {
  assert.equal(stripEntryPrefix('updates[0] "ex_bench" set 9: No set 9 of Bench Press [primary] in workout w1.'), 'No set 9 of Bench Press [primary] in workout w1.');
});
