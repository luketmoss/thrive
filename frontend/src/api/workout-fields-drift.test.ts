// #260 AC4 — the SPA's Workouts row mirrors WORKOUT_FIELDS in
// apps-script/src/types.js (CLAUDE.md: change both together). This test is
// what notices when only one side changed, as sync-log-api.test.ts does for
// SyncLog. It also pins AB `sport_type` on every SPA path: the read, the
// append (always ''), and the fresh-read-then-write edit (preserved).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const sheetsGet = vi.fn();
const sheetsAppend = vi.fn();
const sheetsUpdate = vi.fn();

vi.mock('./sheets', () => ({
  sheetsGet: (...args: unknown[]) => sheetsGet(...args),
  sheetsAppend: (...args: unknown[]) => sheetsAppend(...args),
  sheetsUpdate: (...args: unknown[]) => sheetsUpdate(...args),
  sheetsDeleteRow: vi.fn(),
  getSheetId: vi.fn(),
  withReauth: (_token: string, fn: (t: string) => unknown) => fn('t'),
}));
vi.mock('./demo-data', () => ({ isDemo: () => false, DEMO_WORKOUTS: [], DEMO_SETS: [] }));

const { workoutToRow, rowToWorkout, createWorkout, updateWorkout } = await import('./workouts-api');
import type { Workout } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function workoutFields(): string[] {
  const src = readFileSync(resolve(__dirname, '../../../apps-script/src/types.js'), 'utf-8');
  const block = src.match(/var WORKOUT_FIELDS = \[([\s\S]*?)\];/)?.[1];
  expect(block, 'WORKOUT_FIELDS not found in types.js').toBeTruthy();
  return Array.from(block!.matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

describe('Workouts row mapping', () => {
  it('workoutToRow emits WORKOUT_FIELDS from apps-script/src/types.js, in order', () => {
    const fields = workoutFields();
    // Each field holds its own name, so the row reads back as the field order.
    const named = Object.fromEntries(fields.map((f) => [f, f])) as unknown as Workout;
    expect(workoutToRow(named)).toEqual(fields);
    expect(fields).toHaveLength(28); // A:AB
    expect(fields[27]).toBe('sport_type');
  });

  it('rowToWorkout reads every WORKOUT_FIELDS column back into its field', () => {
    const fields = workoutFields();
    const w = rowToWorkout(fields, 2) as unknown as Record<string, unknown>;
    for (const f of fields) {
      // `type` and `effort` are typed unions; the value is still the cell.
      expect(w[f], f).toBe(f);
    }
  });

  it('reads row[27] as sport_type, and a short row as ""', () => {
    const row = Array.from({ length: 28 }, () => '');
    row[0] = 'w_1';
    row[27] = '204';
    expect(rowToWorkout(row, 2).sport_type).toBe('204');
    expect(rowToWorkout(row.slice(0, 27), 2).sport_type).toBe('');
  });
});

describe('#260 AC4: the SPA never sets sport_type, and an edit keeps the sheet\'s', () => {
  beforeEach(() => {
    sheetsGet.mockReset();
    sheetsAppend.mockReset();
    sheetsUpdate.mockReset();
  });

  it('createWorkout appends A:AB with a blank AB', async () => {
    await createWorkout({ type: 'hike', name: 'Hike' }, 'token');
    expect(sheetsAppend).toHaveBeenCalledTimes(1);
    const [range, rows] = sheetsAppend.mock.calls[0];
    expect(range).toBe('Workouts!A:AB');
    expect(rows[0]).toHaveLength(28);
    expect(rows[0][27]).toBe('');
  });

  it('updateWorkout reads A:AB fresh and writes back the sport_type the sheet holds', async () => {
    const fresh = Array.from({ length: 28 }, () => '');
    fresh[0] = 'w_1';
    fresh[18] = 'coros';
    fresh[19] = '480640601618940011';
    fresh[27] = '204';
    sheetsGet.mockResolvedValue([fresh]);
    // The cached copy predates the backfill: its sport_type is still blank.
    const cached = { ...rowToWorkout(fresh, 5), sport_type: '' };
    const written = await updateWorkout(cached, { notes: 'muddy' }, 'token');
    expect(sheetsGet).toHaveBeenCalledWith('Workouts!A5:AB5', 't');
    const [range, rows] = sheetsUpdate.mock.calls[0];
    expect(range).toBe('Workouts!A5:AB5');
    expect(rows[0]).toHaveLength(28);
    expect(rows[0][27]).toBe('204');
    expect(rows[0][6]).toBe('muddy');
    expect(written.sport_type).toBe('204');
  });
});
