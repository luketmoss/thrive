// #234 — upsertJournal: one day's note created, replaced in place, or (blank)
// deleted, through the key only, with every value stored as literal text.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, type CellValue } from './apps-script-sandbox';

const NOW = new Date('2026-09-24T19:05:10.000Z');
const NOW_ISO = NOW.toISOString();
const OLD = '2026-09-20T10:00:00.000Z';

const row = (date: string, note: string, created = OLD, updated = created): CellValue[] =>
  [date, note, created, updated];

function upsert(journal: CellValue[][] | undefined, payload: unknown, key?: string) {
  const api = loadApi(journal ? { journal } : {}, { now: NOW });
  const res = callDoGet<any>(api.sandbox, {
    action: 'upsertJournal',
    payload: JSON.stringify(payload),
    ...(key !== undefined ? { key } : {}),
  });
  return { ...api, res, journal: api.journalRows! };
}

describe('AC2: create or replace', () => {
  it('appends a date with no row, created and updated both now', () => {
    const { res, journal, lock } = upsert([row('2026-09-20', 'older')], { date: '2026-09-23', note: 'Slept badly.' });
    expect(res.success, res.error).toBe(true);
    expect(res.data).toEqual({
      result: 'created',
      entry: { date: '2026-09-23', note: 'Slept badly.', created: NOW_ISO, updated: NOW_ISO },
    });
    expect(journal).toHaveLength(2);
    expect(journal[1]).toEqual(['2026-09-23', 'Slept badly.', NOW_ISO, NOW_ISO]);
    expect(lock.acquired).toBe(1);
    expect(lock.held).toBe(false);
  });

  it('rewrites an existing row in place, keeping created and setting updated', () => {
    const { res, journal } = upsert(
      [row('2026-09-22', 'before'), row('2026-09-23', 'old note', OLD, OLD), row('2026-09-24', 'after')],
      { date: '2026-09-23', note: 'new note' },
    );
    expect(res.data).toEqual({
      result: 'updated',
      entry: { date: '2026-09-23', note: 'new note', created: OLD, updated: NOW_ISO },
    });
    expect(journal).toHaveLength(3);
    expect(journal[1]).toEqual(['2026-09-23', 'new note', OLD, NOW_ISO]);
    expect(journal[0][1]).toBe('before');
    expect(journal[2][1]).toBe('after');
  });

  it('fills created when the existing row has none', () => {
    const { journal } = upsert([['2026-09-23', 'old', '', '']], { date: '2026-09-23', note: 'x' });
    expect(journal[0][2]).toBe(NOW_ISO);
  });

  it('stores every value as literal text, a note starting = is not a formula', () => {
    const { res, journal } = upsert([], { date: '2026-09-23', note: '=SUM(A1:A9)' });
    expect(res.data.entry.note).toBe('=SUM(A1:A9)');
    // Strings, not a parsed Date or a SheetFormula: asText() escaped every one.
    expect(journal[0]).toEqual(['2026-09-23', '=SUM(A1:A9)', NOW_ISO, NOW_ISO]);
    expect(typeof journal[0][0]).toBe('string');
  });

  it('round-trips a multi-line note unchanged, untrimmed', () => {
    const note = '  Line one\n\nLine three  ';
    const { journal } = upsert([], { date: '2026-09-23', note });
    expect(journal[0][1]).toBe(note);
  });

  it('round-trips a number-shaped note as text', () => {
    const { journal } = upsert([], { date: '2026-09-23', note: '2026-09-24' });
    expect(journal[0][1]).toBe('2026-09-24');
  });
});

describe('AC3: a blank note deletes the row', () => {
  it('deletes the row for an empty note, leaving neighbours', () => {
    const { res, journal } = upsert(
      [row('2026-09-22', 'a'), row('2026-09-23', 'b'), row('2026-09-24', 'c')],
      { date: '2026-09-23', note: '' },
    );
    expect(res.success, res.error).toBe(true);
    expect(res.data).toEqual({ result: 'deleted', entry: null });
    expect(journal.map((r) => r[0])).toEqual(['2026-09-22', '2026-09-24']);
  });

  it('treats a whitespace-only note as blank', () => {
    const { res, journal } = upsert([row('2026-09-23', 'b')], { date: '2026-09-23', note: ' \n\t ' });
    expect(res.data.result).toBe('deleted');
    expect(journal).toEqual([]);
  });

  it('is a no-op, not an error, for a date with no row', () => {
    const { res, journal } = upsert([row('2026-09-22', 'a')], { date: '2026-09-23', note: '' });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ result: 'unchanged', entry: null });
    expect(journal).toHaveLength(1);
  });
});

describe('AC4: validation', () => {
  const unchanged = (payload: unknown, pattern: RegExp) => {
    const seed = [row('2026-09-22', 'a')];
    const { res, journal, lock } = upsert(seed, payload);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(pattern);
    expect(journal).toEqual([row('2026-09-22', 'a')]);
    expect(lock.held).toBe(false);
  };

  it('requires a date', () => unchanged({ note: 'x' }, /date/));
  it('rejects a malformed date', () => unchanged({ date: '23/09/2026', note: 'x' }, /Invalid date/));
  it('requires a note, as a string', () => {
    unchanged({ date: '2026-09-23' }, /note/);
    unchanged({ date: '2026-09-23', note: 5 }, /note/);
    unchanged({ date: '2026-09-23', note: null }, /note/);
  });
  it('rejects any field other than date and note', () => {
    unchanged({ date: '2026-09-23', note: 'x', created: '2020-01-01' }, /unknown field "created"/);
    unchanged({ date: '2026-09-23', note: 'x', mood: 'ok' }, /unknown field "mood"/);
  });
  it('rejects a payload that is not an object', () => unchanged([], /object/));

  it('is bounded by the global payload ceiling', () => {
    const big = 'x'.repeat(20000);
    const { res } = upsert([], { date: '2026-09-23', note: big });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/limit/);
  });
});

describe('AC5: key-only', () => {
  it('refuses a missing or wrong key and writes nothing', () => {
    const { res, journal } = upsert([], { date: '2026-09-23', note: 'x' }, 'wrong');
    expect(res.success).toBe(false);
    expect(journal).toEqual([]);
  });
});
