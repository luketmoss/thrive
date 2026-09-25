// #130 AC3 — writes preserve the nullable discipline server-side: omitted
// means empty, unmentioned means unchanged, and an invalid enum is refused
// rather than written.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type ApiWorkout, type CellValue } from './apps-script-sandbox';

const NOW = new Date('2026-09-20T15:30:00Z');

function create(data: Record<string, unknown>, rows: CellValue[][] = []) {
  const api = loadApi(rows, { now: NOW, uuids: ['abcdef1234567890'] });
  const res = callDoGet<ApiWorkout>(api.sandbox, {
    action: 'createWorkout',
    payload: JSON.stringify({ data }),
  });
  return { ...api, res };
}

describe('AC3: an omitted field is written empty, never defaulted', () => {
  it('leaves the cardio columns empty when they are not mentioned', () => {
    const { res, rows } = create({ type: 'bike', name: 'Evening Ride' });
    expect(res.success).toBe(true);
    expect(res.data.distance_m).toBe('');
    expect(res.data.ascent_m).toBe('');
    expect(res.data.effort).toBe('');
    // And in the sheet itself, not just the response.
    expect(rows[0][13]).toBe('');  // N distance_m
    expect(rows[0][14]).toBe('');  // O ascent_m
    expect(rows[0][12]).toBe('');  // M effort
  });

  it('writes a full 27-cell row so no stale cell is left behind', () => {
    const { rows } = create({ type: 'bike', name: 'Evening Ride' });
    expect(rows[0]).toHaveLength(27);
    for (const c of rows[0]) expect(c).not.toBeUndefined();
  });

  it('leaves source blank, which positively means logged by hand', () => {
    const { res } = create({ type: 'run', name: 'Morning Run' });
    expect(res.data.source).toBe('');
    expect(res.data.source_activity_id).toBe('');
  });

  it('keeps a deliberate zero rather than treating it as unset', () => {
    const { res } = create({ type: 'bike', name: 'Trainer', ascent_m: '0' });
    expect(res.data.ascent_m).toBe('0');
  });

  it('requires type and name', () => {
    expect(create({ name: 'No type' }).res.error).toMatch(/type is required/);
    expect(create({ type: 'bike' }).res.error).toMatch(/name is required/);
  });

  it('defaults only id, date and created — the three it must', () => {
    const { res } = create({ type: 'walk', name: 'Walk' });
    expect(res.data.id).toMatch(/^w_/);
    expect(res.data.date).toBe('2026-09-20');
    expect(res.data.created).toBe(NOW.toISOString());
  });

  it('resolves the default date in America/Denver, not UTC', () => {
    // 01:30Z on the 21st is still 19:30 on the 20th in Denver. Slicing the
    // ISO string would file the workout under tomorrow.
    const api = loadApi([], { now: new Date('2026-09-21T01:30:00Z') });
    const res = callDoGet<ApiWorkout>(api.sandbox, {
      action: 'createWorkout',
      payload: JSON.stringify({ data: { type: 'walk', name: 'Evening Walk' } }),
    });
    expect(res.data.date).toBe('2026-09-20');
  });
});

describe('AC3: an update leaves unmentioned fields alone', () => {
  const existing = () => [workoutRow({
    id: 'w_1', type: 'bike', name: 'Evening Ride', notes: 'Felt good',
    elapsed_seconds: '1800', effort: 'Medium', distance_m: '19956', avg_hr: '136',
  })];

  function update(changes: Record<string, unknown>, id = 'w_1') {
    const api = loadApi(existing(), { now: NOW });
    const res = callDoGet<ApiWorkout>(api.sandbox, {
      action: 'updateWorkout',
      payload: JSON.stringify({ id, changes }),
    });
    return { ...api, res };
  }

  // This is #122 in the MCP server, and it is worth not shipping twice.
  it('does not blank the fields the caller did not mention', () => {
    const { res, rows } = update({ effort: 'Hard' });
    expect(res.success).toBe(true);
    expect(res.data.effort).toBe('Hard');
    expect(res.data.notes).toBe('Felt good');
    expect(res.data.distance_m).toBe('19956');
    expect(res.data.avg_hr).toBe('136');
    expect(rows[0][6]).toBe('Felt good');
    expect(rows[0][13]).toBe('19956');
  });

  it('can still clear a field deliberately, by naming it', () => {
    const { res, rows } = update({ effort: '' });
    expect(res.data.effort).toBe('');
    expect(rows[0][12]).toBe('');
    // ...and nothing else moved.
    expect(res.data.distance_m).toBe('19956');
  });

  it('writes the whole row back at full width', () => {
    const { rows } = update({ effort: 'Hard' });
    expect(rows[0]).toHaveLength(27);
  });

  it('refuses an id that is not there', () => {
    const { res } = update({ effort: 'Hard' }, 'w_nope');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it('refuses to change an id', () => {
    const { res } = update({ id: 'w_other' });
    expect(res.error).toMatch(/id cannot be changed/);
  });

  it('requires id and changes', () => {
    const api = loadApi(existing());
    expect(
      callDoGet(api.sandbox, { action: 'updateWorkout', payload: JSON.stringify({ changes: {} }) }).error
    ).toMatch(/payload.id field required/);
    expect(
      callDoGet(api.sandbox, { action: 'updateWorkout', payload: JSON.stringify({ id: 'w_1' }) }).error
    ).toMatch(/payload.changes field required/);
  });
});

describe('AC3: validation refuses rather than writes', () => {
  it('rejects an unknown type', () => {
    const { res, rows } = create({ type: 'swimming', name: 'Swim' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid type: "swimming"/);
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown sub_type', () => {
    const { res, rows } = create({ type: 'bike', name: 'Ride', sub_type: 'submarine' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid sub_type: "submarine"/);
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown effort and an unknown status', () => {
    expect(create({ type: 'bike', name: 'R', effort: 'Brutal' }).res.error)
      .toMatch(/Invalid effort: "Brutal"/);
    expect(create({ type: 'bike', name: 'R', status: 'maybe' }).res.error)
      .toMatch(/Invalid status: "maybe"/);
  });

  it('rejects a malformed date', () => {
    expect(create({ type: 'bike', name: 'R', date: '15 March' }).res.error)
      .toMatch(/Expected YYYY-MM-DD/);
  });

  it('names the valid values so the caller can fix it', () => {
    const { res } = create({ type: 'swimming', name: 'Swim' });
    expect(res.error).toMatch(/weight, stretch, bike, hike, run, walk/);
  });

  // '' is not a validation failure — unset is a legitimate permanent state.
  it('accepts an empty enum as unset', () => {
    const { res } = create({ type: 'bike', name: 'Ride', effort: '', sub_type: '' });
    expect(res.success).toBe(true);
    expect(res.data.effort).toBe('');
    expect(res.data.sub_type).toBe('');
  });

  it('accepts every declared sub_type', () => {
    for (const sub of ['mountain', 'gravel', 'indoor', 'outdoor']) {
      const { res } = create({ type: 'bike', name: 'Ride', sub_type: sub });
      expect(res.success, sub).toBe(true);
    }
  });

  it('rejects a field that is not a column at all', () => {
    const { res, rows } = create({ type: 'bike', name: 'Ride', vertical_meters: '100' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unknown field: "vertical_meters"/);
    expect(rows).toHaveLength(0);
  });
});
