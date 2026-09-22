// #132 — writes store literal text, as the SPA's RAW writes do, and reads
// see what the SPA sees.
//
// appendRow / setValues behave like typing into a cell: "2099-01-01" became a
// date, "07:00" a time, "3720" a number, "=x" a formula. Read back with
// getValues() and String()'d, the date became "Thu Jan 01 2099 00:00:00
// GMT-0700" — and the next update wrote that back. The parity test in #132's
// QA found it; the 94 DailySummary rows #131 backfilled carry it.
//
// These run against a fake that interprets writes the way Sheets does
// (storeAsTyped in the sandbox), which is what the suite lacked before.

import { describe, it, expect } from 'vitest';
import {
  loadApi, callDoGet, workoutRow, setRow, exerciseRow, storeAsTyped, SheetFormula,
  type ApiWorkout, type CellValue,
} from './apps-script-sandbox';

describe('writes are stored as literal text', () => {
  function create(data: Record<string, unknown>) {
    const api = loadApi([], { now: new Date('2026-09-21T15:00:00Z') });
    const res = callDoGet<ApiWorkout>(api.sandbox, {
      action: 'createWorkout', payload: JSON.stringify({ data }),
    });
    return { ...api, res };
  }

  it('keeps a date as the text it was, not a date value', () => {
    const { rows } = create({ type: 'weight', name: 'Push', date: '2099-01-01', time: '07:00' });
    expect(rows[0][1]).toBe('2099-01-01');
    expect(rows[0][2]).toBe('07:00');
    expect(rows[0][1]).not.toBeInstanceOf(Date);
  });

  it('keeps number-shaped values as text, as the SPA stores them', () => {
    const { rows } = create({ type: 'bike', name: 'Ride', elapsed_seconds: '3720', distance_m: '19956', ascent_m: '0' });
    expect(rows[0][7]).toBe('3720');
    expect(rows[0][13]).toBe('19956');
    // A deliberate zero is still distinct from unset.
    expect(rows[0][14]).toBe('0');
  });

  // Formula injection: the REST API's RAW mode never evaluated these, so the
  // script API must not either.
  it('stores a note beginning with = as text, never a live formula', () => {
    const { rows, res } = create({ type: 'weight', name: 'Push', notes: '=IMPORTXML("https://evil.test","//a")' });
    expect(rows[0][6]).not.toBeInstanceOf(SheetFormula);
    expect(rows[0][6]).toBe('=IMPORTXML("https://evil.test","//a")');
    expect(res.data.notes).toBe('=IMPORTXML("https://evil.test","//a")');
  });

  it('keeps a value that itself begins with an apostrophe intact', () => {
    const { rows } = create({ type: 'weight', name: "'til failure" });
    expect(rows[0][4]).toBe("'til failure");
  });

  it('writes empty cells as empty, not as an escaped empty string', () => {
    const { rows } = create({ type: 'weight', name: 'Push' });
    expect(rows[0][13]).toBe('');
  });
});

describe('an update does not corrupt what it did not touch', () => {
  // The exact failure the parity test caught: create, then edit one field.
  it('leaves the date and time alone when only effort changes', () => {
    const api = loadApi([], { now: new Date('2026-09-21T15:00:00Z') });
    const created = callDoGet<ApiWorkout>(api.sandbox, {
      action: 'createWorkout',
      payload: JSON.stringify({ data: { type: 'weight', name: 'Push', date: '2099-01-01', time: '07:00', elapsed_seconds: '2700' } }),
    });
    const updated = callDoGet<ApiWorkout>(api.sandbox, {
      action: 'updateWorkout',
      payload: JSON.stringify({ id: created.data.id, changes: { effort: 'Hard' } }),
    });
    expect(updated.data.date).toBe('2099-01-01');
    expect(updated.data.time).toBe('07:00');
    expect(updated.data.elapsed_seconds).toBe('2700');
    expect(api.rows[0][1]).toBe('2099-01-01');
    expect(api.rows[0][2]).toBe('07:00');

    const read = callDoGet<ApiWorkout>(api.sandbox, { action: 'getWorkout', id: created.data.id });
    expect(read.data.date).toBe('2099-01-01');
  });

  it('keeps set numbers readable after a bulk set update', () => {
    const api = loadApi({
      exercises: [exerciseRow({ id: 'ex_1', name: 'Bench Press' })],
      sets: [setRow({ workout_id: 'w_1', exercise_id: 'ex_1', exercise_name: 'Bench Press', set_number: 1, weight: '185', reps: '6' })],
      workouts: [workoutRow({ id: 'w_1' })],
    });
    const res = callDoGet<any>(api.sandbox, {
      action: 'updateSets',
      payload: JSON.stringify({ workout_id: 'w_1', updates: [{ exercise: 'Bench Press', set_number: 1, reps: '7' }] }),
    });
    expect(res.success).toBe(true);
    expect(api.setRows[0][8]).toBe('7');
    expect(api.setRows[0][7]).toBe('185');
    // And a second update still finds the set by its number.
    const again = callDoGet<any>(api.sandbox, {
      action: 'updateSets',
      payload: JSON.stringify({ workout_id: 'w_1', updates: [{ exercise: 'Bench Press', set_number: 1, reps: '8' }] }),
    });
    expect(again.success).toBe(true);
  });
});

describe('reads see what the SPA sees', () => {
  // The state production DailySummary rows are in after #131's backfill:
  // column A holds a real date, the counts real numbers.
  const parsedRow = (date: string, count: string): CellValue[] => {
    const row: CellValue[] = [date, count, 'weight', '0', '2100', '', '', '', '', '', '', '', '', '', '', '', '', '2026-09-21T15:29:31.647Z'];
    return row.map((v) => storeAsTyped(v));
  };

  it('reads a date-typed cell as the date the SPA displays', () => {
    const api = loadApi({ dailySummary: [parsedRow('2026-03-04', '1')] });
    expect(api.summaryRows[0][0]).toBeInstanceOf(Date);
    const res = callDoGet<any[]>(api.sandbox, { action: 'getDailySummary' });
    expect(res.data[0].date).toBe('2026-03-04');
    expect(res.data[0].activity_count).toBe('1');
  });

  // Before the fix a rebuild keyed existing rows by "Wed Mar 04 2026 ..." and
  // appended a duplicate for every day. Now it matches and heals them.
  it('rebuilds over date-typed rows in place, and leaves them as text', () => {
    const api = loadApi({
      workouts: [workoutRow({ id: 'w_1', date: '2026-03-04', type: 'weight', elapsed_seconds: '2100' })],
      dailySummary: [parsedRow('2026-03-04', '1')],
    });
    const res = callDoGet<any>(api.sandbox, {
      action: 'rebuildDailySummary',
      payload: JSON.stringify({ from: '2026-03-04', to: '2026-03-04', computed_at: '2026-09-21T16:00:00.000Z' }),
    });
    expect(res.data.updated).toBe(1);
    expect(res.data.written).toBe(0);
    expect(api.summaryRows).toHaveLength(1);
    expect(api.summaryRows[0][0]).toBe('2026-03-04');
    expect(api.summaryRows[0][1]).toBe('1');
  });

  it('finds a workout by id whatever else in its row was parsed', () => {
    const typed = workoutRow({ id: 'w_1', date: '2026-03-04', time: '07:00' }).map((v) => storeAsTyped(v));
    const api = loadApi([typed]);
    const res = callDoGet<ApiWorkout>(api.sandbox, { action: 'getWorkout', id: 'w_1' });
    expect(res.success).toBe(true);
    expect(res.data.date).toBe('2026-03-04');
    expect(res.data.time).toBe('07:00');
  });
});
