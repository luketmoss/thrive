// #134 AC2 — bulk set updates are all-or-nothing, and an oversized batch
// fails loudly rather than truncating.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, exerciseRow, setRow, workoutRow } from './apps-script-sandbox';

const EXERCISES = () => [
  exerciseRow({ id: 'ex_bench', name: 'Bench Press' }),
  exerciseRow({ id: 'ex_incline', name: 'Incline Press' }),
];

const SETS = () => [
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 1, weight: '185', reps: '6' }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 2, weight: '185', reps: '5' }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_bench', exercise_name: 'Bench Press', section: 'primary', exercise_order: 1, set_number: 3, weight: '185', reps: '4' }),
  setRow({ workout_id: 'w_1', exercise_id: 'ex_incline', exercise_name: 'Incline Press', section: 'SS1', exercise_order: 2, set_number: 1, weight: '55', reps: '12' }),
];

function apply(updates: unknown[], workoutId = 'w_1') {
  const a = loadApi({ exercises: EXERCISES(), sets: SETS(), workouts: [workoutRow({ id: 'w_1' })] });
  const res = callDoGet<{ changes: any[]; applied: boolean }>(a.sandbox, {
    action: 'updateSets',
    payload: JSON.stringify({ workout_id: workoutId, updates }),
  });
  return { ...a, res };
}

describe('AC2: a good batch applies in full', () => {
  it('writes every entry', () => {
    const { res, setRows } = apply([
      { exercise: 'Bench Press', set_number: 1, reps: '7' },
      { exercise: 'Bench Press', set_number: 2, reps: '6' },
      { exercise: 'Incline Press', set_number: 1, weight: '60' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data.applied).toBe(true);
    expect(setRows[0][8]).toBe('7');
    expect(setRows[1][8]).toBe('6');
    expect(setRows[3][7]).toBe('60');
  });

  it('leaves the fields an entry did not mention alone', () => {
    const { setRows } = apply([{ exercise: 'Bench Press', set_number: 1, reps: '7' }]);
    expect(setRows[0][7]).toBe('185');        // weight untouched
    expect(setRows[0][6]).toBe('6');          // planned_reps untouched
    expect(setRows[0][2]).toBe('Bench Press');
  });

  it('writes exactly ten cells, so column K stays gone', () => {
    const { setRows } = apply([{ exercise: 'Bench Press', set_number: 1, reps: '7' }]);
    expect(setRows[0]).toHaveLength(10);
  });

  it('can clear a field deliberately', () => {
    const { setRows } = apply([{ exercise: 'Bench Press', set_number: 1, reps: '' }]);
    expect(setRows[0][8]).toBe('');
    expect(setRows[0][7]).toBe('185');
  });
});

describe('AC2: one bad entry rejects the whole batch', () => {
  it('writes nothing when a later entry fails to resolve', () => {
    const { res, setRows } = apply([
      { exercise: 'Bench Press', set_number: 1, reps: '7' },        // fine
      { exercise: 'Bench Press', set_number: 9, reps: '6' },        // no such set
    ]);
    expect(res.success).toBe(false);
    // The first entry must NOT have landed.
    expect(setRows[0][8]).toBe('6');
    expect(setRows[1][8]).toBe('5');
  });

  it('collects every problem rather than stopping at the first', () => {
    const { res } = apply([
      { exercise: 'Bench Press', set_number: 9, reps: '6' },
      { exercise: 'Kettlebell Swing', set_number: 1, reps: '10' },
    ]);
    expect(res.error).toMatch(/updates\[0\]/);
    expect(res.error).toMatch(/updates\[1\]/);
  });

  // The guard domain.test.js already holds, carried over.
  it('rejects a batch where two entries target the same set', () => {
    const { res, setRows } = apply([
      { exercise: 'Bench Press', set_number: 1, reps: '7' },
      { exercise: 'Bench Press', set_number: 1, weight: '190' },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/targets the same set as updates\[0\]/);
    expect(res.error).toMatch(/combine them into one entry/);
    expect(setRows[0][8]).toBe('6');
  });

  it('rejects an entry that changes nothing', () => {
    const { res } = apply([{ exercise: 'Bench Press', set_number: 1 }]);
    expect(res.error).toMatch(/nothing to change/);
    expect(res.error).toMatch(/weight, reps, planned_reps, effort/);
  });

  it('rejects an unknown field rather than ignoring it', () => {
    const { res } = apply([{ exercise: 'Bench Press', set_number: 1, rpe: '8' }]);
    expect(res.error).toMatch(/unknown field "rpe"/);
  });

  it('rejects an invalid effort', () => {
    const { res, setRows } = apply([{ exercise: 'Bench Press', set_number: 1, effort: 'Brutal' }]);
    expect(res.error).toMatch(/invalid effort "Brutal"/);
    expect(setRows[0][9]).toBe('');
  });

  it('names the affected rows when a target has moved', () => {
    const a = loadApi({ exercises: EXERCISES(), sets: SETS(), workouts: [workoutRow({ id: 'w_1' })] });
    // Resolution reads the sheet; make the row stop holding that set between
    // resolution and the write, which is what a delete above it would do.
    const sheet = a.sandbox.getSheet('Sets');
    const realGetRange = sheet.getRange.bind(sheet);
    let resolved = false;
    sheet.getRange = (r: number, c: number, nr: number, nc: number) => {
      const range = realGetRange(r, c, nr, nc);
      const values = range.getValues;
      range.getValues = () => {
        const out = values();
        // Once the full read has happened, corrupt the identity re-read.
        if (resolved && nc === a.sandbox.SET_IDENTITY_COLUMN_COUNT) {
          return [['w_other', 'ex_other', '', '', '', 99]];
        }
        resolved = true;
        return out;
      };
      return range;
    };

    const res = callDoGet(a.sandbox, {
      action: 'updateSets',
      payload: JSON.stringify({
        workout_id: 'w_1',
        updates: [{ exercise: 'Bench Press', set_number: 1, reps: '7' }],
      }),
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/moved since it was read/);
    expect(res.error).toMatch(/sheet rows 2/);
    expect(res.error).toMatch(/Nothing was written/);
    expect(a.setRows[0][8]).toBe('6');
  });
});

describe('AC2: an oversized batch fails loudly', () => {
  it('refuses a payload over the limit rather than truncating', () => {
    const a = loadApi({ exercises: EXERCISES(), sets: SETS(), workouts: [workoutRow({ id: 'w_1' })] });
    const updates = [];
    for (let i = 0; i < 400; i++) {
      updates.push({ exercise: 'Bench Press', set_number: 1, reps: String(i), section: 'primary' });
    }
    const payload = JSON.stringify({ workout_id: 'w_1', updates });
    expect(payload.length).toBeGreaterThan(a.sandbox.MAX_PAYLOAD_CHARS);

    const res = callDoGet(a.sandbox, { action: 'updateSets', payload });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/over the/);
    expect(res.error).toMatch(/batch/i);
    expect(a.setRows[0][8]).toBe('6');
  });

  it('applies a batch that fits', () => {
    const { res } = apply([
      { exercise: 'Bench Press', set_number: 1, reps: '7' },
      { exercise: 'Bench Press', set_number: 2, reps: '6' },
      { exercise: 'Bench Press', set_number: 3, reps: '5' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data.changes).toHaveLength(3);
  });
});
