// #233 — the Journal tab: read, upsert, clear, demo mode, and the field list
// that mirrors apps-script/src/types.js (change both together).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const sheetsGet = vi.fn();
const sheetsAppend = vi.fn();
const sheetsUpdate = vi.fn();
const sheetsDeleteRow = vi.fn();
const getSheetId = vi.fn();
let demo = false;

vi.mock('./sheets', () => ({
  sheetsGet: (...a: unknown[]) => sheetsGet(...a),
  sheetsAppend: (...a: unknown[]) => sheetsAppend(...a),
  sheetsUpdate: (...a: unknown[]) => sheetsUpdate(...a),
  sheetsDeleteRow: (...a: unknown[]) => sheetsDeleteRow(...a),
  getSheetId: (...a: unknown[]) => getSheetId(...a),
  withReauth: (token: string, fn: (t: string) => unknown) => fn(token),
}));
vi.mock('./demo-data', async () => {
  const actual = await vi.importActual<typeof import('./demo-data')>('./demo-data');
  return { ...actual, isDemo: () => demo };
});

import { JOURNAL_FIELDS, fetchJournal, upsertJournalEntry } from './journal-api';
import { DEMO_JOURNAL, shiftDemoJournal, demoDenverDate, DEMO_ANCHOR_DATE } from './demo-data';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesJs = readFileSync(resolve(__dirname, '../../../apps-script/src/types.js'), 'utf-8');

beforeEach(() => {
  demo = false;
  for (const f of [sheetsGet, sheetsAppend, sheetsUpdate, sheetsDeleteRow, getSheetId]) f.mockReset();
  getSheetId.mockResolvedValue(77);
});

describe('AC6: the field list mirrors types.js', () => {
  it('JOURNAL_FIELDS matches name for name and in order (A:D)', () => {
    const block = typesJs.match(/var JOURNAL_FIELDS = \[([\s\S]*?)\];/)?.[1];
    expect(block).toBeTruthy();
    const fields = Array.from(block!.matchAll(/'([a-z_]+)'/g), (m) => m[1]);
    expect([...JOURNAL_FIELDS]).toEqual(fields);
    expect(fields).toEqual(['date', 'note', 'created', 'updated']);
    expect(typesJs).toMatch(/var JOURNAL_COLUMN_COUNT = 4;/);
  });
});

describe('AC2: fetchJournal', () => {
  it('reads Journal!A2:D unfiltered, with sheetRow', async () => {
    sheetsGet.mockResolvedValue([
      ['2026-09-01', 'one', 'c1', 'u1'],
      ['2026-09-20', 'two', 'c2', 'u2'],
    ]);
    const out = await fetchJournal('tok');
    expect(sheetsGet).toHaveBeenCalledWith('Journal!A2:D', 'tok');
    expect(out).toEqual([
      { date: '2026-09-01', note: 'one', created: 'c1', updated: 'u1', sheetRow: 2 },
      { date: '2026-09-20', note: 'two', created: 'c2', updated: 'u2', sheetRow: 3 },
    ]);
  });

  it('answers an empty tab with an empty list and fills short rows', async () => {
    sheetsGet.mockResolvedValue([]);
    expect(await fetchJournal('t')).toEqual([]);
    sheetsGet.mockResolvedValue([['2026-09-01', 'x']]);
    expect((await fetchJournal('t'))[0]).toMatchObject({ created: '', updated: '' });
  });
});

describe('AC3: upserting a note', () => {
  it('appends a new day with created === updated', async () => {
    sheetsGet.mockResolvedValue([['2026-09-01', 'old', 'c', 'u']]);
    const e = await upsertJournalEntry('2026-09-02', 'hello', 't');
    expect(sheetsUpdate).not.toHaveBeenCalled();
    expect(sheetsAppend).toHaveBeenCalledTimes(1);
    const [range, values] = sheetsAppend.mock.calls[0];
    expect(range).toBe('Journal!A:D');
    expect(values[0][0]).toBe('2026-09-02');
    expect(values[0][1]).toBe('hello');
    expect(values[0][2]).toBe(values[0][3]);
    expect(new Date(values[0][2]).toISOString()).toBe(values[0][2]);
    expect(e).toMatchObject({ date: '2026-09-02', note: 'hello' });
  });

  it('rewrites an existing day in place, keeping created', async () => {
    sheetsGet.mockResolvedValue([
      ['2026-09-01', 'a', 'c1', 'u1'],
      ['2026-09-02', 'b', 'c2', 'u2'],
    ]);
    const e = await upsertJournalEntry('2026-09-02', 'b edited', 't');
    expect(sheetsAppend).not.toHaveBeenCalled();
    const [range, values] = sheetsUpdate.mock.calls[0];
    expect(range).toBe('Journal!A3:D3');
    expect(values[0].slice(0, 3)).toEqual(['2026-09-02', 'b edited', 'c2']);
    expect(values[0][3]).not.toBe('u2');
    expect(e!.created).toBe('c2');
  });
});

describe('AC4: clearing a note', () => {
  it.each(['', '   ', '\n\t '])('deletes the row for %j', async (blank) => {
    sheetsGet.mockResolvedValue([
      ['2026-09-01', 'a', 'c1', 'u1'],
      ['2026-09-02', 'b', 'c2', 'u2'],
    ]);
    expect(await upsertJournalEntry('2026-09-02', blank, 't')).toBeNull();
    expect(getSheetId).toHaveBeenCalledWith('Journal', 't');
    expect(sheetsDeleteRow).toHaveBeenCalledWith(77, 3, 't');
    expect(sheetsAppend).not.toHaveBeenCalled();
    expect(sheetsUpdate).not.toHaveBeenCalled();
  });

  it('writes nothing when a blank note has no row to delete', async () => {
    sheetsGet.mockResolvedValue([['2026-09-01', 'a', 'c1', 'u1']]);
    expect(await upsertJournalEntry('2026-09-05', '  ', 't')).toBeNull();
    expect(sheetsDeleteRow).not.toHaveBeenCalled();
    expect(sheetsAppend).not.toHaveBeenCalled();
  });
});

describe('AC5: demo mode', () => {
  it('serves DEMO_JOURNAL without touching the network, dated relative to today', async () => {
    demo = true;
    const out = await fetchJournal('t');
    expect(sheetsGet).not.toHaveBeenCalled();
    expect(out).toHaveLength(DEMO_JOURNAL.length);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.map((e) => e.date)).toContain(demoDenverDate(new Date()));
  });

  it('upsert and clear persist nothing', async () => {
    demo = true;
    expect(await upsertJournalEntry('2026-09-02', 'hi', 't')).toMatchObject({ note: 'hi' });
    expect(await upsertJournalEntry('2026-09-02', '', 't')).toBeNull();
    expect(sheetsGet).not.toHaveBeenCalled();
    expect(sheetsAppend).not.toHaveBeenCalled();
    expect(sheetsUpdate).not.toHaveBeenCalled();
    expect(sheetsDeleteRow).not.toHaveBeenCalled();
  });

  it('fixture has one non-blank note per day, a mix of recent and older', () => {
    const dates = DEMO_JOURNAL.map((e) => e.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(DEMO_JOURNAL.every((e) => e.note.trim() !== '')).toBe(true);
    expect(dates).toContain(DEMO_ANCHOR_DATE);
    expect(dates.some((d) => d < '2025-01-01')).toBe(true);
  });

  it('shifts whole days with the workouts and is the identity on the anchor day', () => {
    const shifted = shiftDemoJournal(new Date('2026-09-30T19:00:00.000Z'));
    expect(shifted[shifted.length - 1].date).toBe('2026-09-30');
    expect(shiftDemoJournal(new Date(`${DEMO_ANCHOR_DATE}T19:00:00.000Z`))).toEqual(DEMO_JOURNAL);
  });
});
