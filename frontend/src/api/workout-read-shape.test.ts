// Issue #128 AC3: a workout row written before the A:Z migration has no cells
// at R:Z at all — the Sheets API truncates a row at its last non-empty cell,
// so `fetchWorkouts` receives a 17-element array. Every one of the nine new
// fields must come back as '', never `undefined`, `null` or `0`.
//
// Blank is not "missing data" here: for `source` it positively means the
// workout was logged by hand, which is what every pre-migration row is.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sheetsGet = vi.fn();

vi.mock('./sheets', () => ({
  sheetsGet: (...args: unknown[]) => sheetsGet(...args),
  sheetsAppend: vi.fn(),
  sheetsUpdate: vi.fn(),
  sheetsDeleteRow: vi.fn(),
  getSheetId: vi.fn(),
  withReauth: (_token: string, fn: (t: string) => unknown) => fn('t'),
}));

vi.mock('./demo-data', () => ({
  isDemo: () => false,
  DEMO_WORKOUTS: [],
  DEMO_SETS: [],
}));

const { fetchWorkouts } = await import('./workouts-api');

const SYNC_FIELDS = [
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
  'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
] as const;

// Exactly what the API returns for a row written under the A:Q shape.
const PRE_MIGRATION_ROW = [
  'w_001', '2026-03-15', '07:00', 'weight', 'Upper Push A', 'tpl_001',
  'Felt strong', '3720', '2026-03-15T07:00:00.000Z', '', '',
  '', 'Hard', '', '', '', '',
];

describe('fetchWorkouts on a pre-migration row', () => {
  beforeEach(() => {
    sheetsGet.mockReset();
    sheetsGet.mockResolvedValue([PRE_MIGRATION_ROW]);
  });

  it('reads the tab as A:AA (#145)', async () => {
    await fetchWorkouts('token');
    expect(sheetsGet).toHaveBeenCalledWith('Workouts!A2:AA', 't');
  });

  // #145 AC1: every row written before AA existed has no cell there.
  it('reads a missing estimate as blank, never 0', async () => {
    const [w] = await fetchWorkouts('token');
    expect(w.estimated_seconds).toBe('');
  });

  it('reads all nine sync fields as empty strings', async () => {
    const [w] = await fetchWorkouts('token');
    for (const f of SYNC_FIELDS) {
      expect(w[f], `${f} should be ''`).toBe('');
    }
  });

  it('never reads a missing cell as 0, undefined or null', async () => {
    const [w] = await fetchWorkouts('token');
    for (const f of SYNC_FIELDS) {
      expect(w[f]).not.toBe(0);
      expect(w[f]).not.toBeUndefined();
      expect(w[f]).not.toBeNull();
    }
  });

  it('leaves the A:Q columns exactly where they were', async () => {
    const [w] = await fetchWorkouts('token');
    expect(w.id).toBe('w_001');
    expect(w.elapsed_seconds).toBe('3720');
    expect(w.created).toBe('2026-03-15T07:00:00.000Z');
    expect(w.effort).toBe('Hard');
    expect(w.sheetRow).toBe(2);
  });

  it('reads a migrated row through to calories', async () => {
    sheetsGet.mockResolvedValue([[
      ...PRE_MIGRATION_ROW,
      'gravel', 'coros', '4821', 'raw_1', 'fit_1',
      '2026-03-15T09:00:00.000Z', '2026-03-15T09:01:00.000Z',
      '2026-03-15T07:00:00-06:00', '612',
    ]]);
    const [w] = await fetchWorkouts('token');
    expect(w.sub_type).toBe('gravel');
    expect(w.source).toBe('coros');
    expect(w.started_at_utc).toBe('2026-03-15T07:00:00-06:00');
    expect(w.calories).toBe('612');
    expect(w.estimated_seconds).toBe('');
  });

  it('reads AA as estimated_seconds (#145)', async () => {
    sheetsGet.mockResolvedValue([[
      ...PRE_MIGRATION_ROW,
      '', '', '', '', '', '', '', '', '',
      '2820',
    ]]);
    const [w] = await fetchWorkouts('token');
    expect(w.estimated_seconds).toBe('2820');
    expect(w.elapsed_seconds).toBe('3720');
  });
});
