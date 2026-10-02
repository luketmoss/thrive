// #234 — getJournal: Journal rows for a date range, oldest first, read through
// the key only.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, callEntry, type CellValue } from './apps-script-sandbox';

const row = (date: string, note: string, created = '2026-09-20T10:00:00.000Z', updated = created): CellValue[] =>
  [date, note, created, updated];

function read(journal: CellValue[][] | undefined, params: Record<string, string> = {}, key?: string) {
  const api = loadApi(journal ? { journal } : {});
  return callDoGet<any>(api.sandbox, {
    action: 'getJournal', ...params, ...(key !== undefined ? { key } : {}),
  });
}

describe('AC1: getJournal returns a date range', () => {
  const rows = () => [
    row('2026-09-22', 'Legs were heavy.'),
    row('2026-09-20', 'Easy ride.\nSecond line.'),
    row('2026-09-23', 'Slept badly.', '2026-09-23T07:00:00.000Z', '2026-09-23T21:30:00.000Z'),
  ];

  it('returns date, note, created and updated, oldest first, with no sheetRow', () => {
    const res = read(rows());
    expect(res.success).toBe(true);
    expect(res.data.map((e: any) => e.date)).toEqual(['2026-09-20', '2026-09-22', '2026-09-23']);
    for (const e of res.data) {
      expect(Object.keys(e)).toEqual(['date', 'note', 'created', 'updated']);
    }
    expect(res.data[0].note).toBe('Easy ride.\nSecond line.');
    expect(res.data[2]).toEqual({
      date: '2026-09-23', note: 'Slept badly.',
      created: '2026-09-23T07:00:00.000Z', updated: '2026-09-23T21:30:00.000Z',
    });
  });

  it('filters inclusively on from and to, each optional', () => {
    expect(read(rows(), { from: '2026-09-22' }).data.map((e: any) => e.date))
      .toEqual(['2026-09-22', '2026-09-23']);
    expect(read(rows(), { to: '2026-09-22' }).data.map((e: any) => e.date))
      .toEqual(['2026-09-20', '2026-09-22']);
    expect(read(rows(), { from: '2026-09-22', to: '2026-09-22' }).data.map((e: any) => e.date))
      .toEqual(['2026-09-22']);
  });

  it('returns [] for a range with no notes', () => {
    expect(read(rows(), { from: '2027-01-01' }).data).toEqual([]);
  });

  it('returns [] when the Journal tab does not exist, not an error', () => {
    const res = read(undefined);
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('returns [] for an empty tab', () => {
    expect(read([]).data).toEqual([]);
  });

  it('skips a row with no date', () => {
    expect(read([row('', 'orphan'), row('2026-09-22', 'kept')]).data.map((e: any) => e.date))
      .toEqual(['2026-09-22']);
  });
});

describe('AC4: validation', () => {
  it('rejects a malformed from or to', () => {
    const a = read([], { from: '09/20/2026' });
    expect(a.success).toBe(false);
    expect(a.error).toMatch(/Invalid from/);
    const b = read([], { to: 'tomorrow' });
    expect(b.success).toBe(false);
    expect(b.error).toMatch(/Invalid to/);
  });
});

describe('AC5: getJournal is key-only', () => {
  it('is not on the token read allow-list', () => {
    const { sandbox } = loadApi({ journal: [] });
    expect([...sandbox.TOKEN_READ_ACTIONS]).not.toContain('getJournal');
    expect([...sandbox.TOKEN_READ_ACTIONS]).not.toContain('upsertJournal');
  });

  it('refuses a missing key', () => {
    const api = loadApi({ journal: [row('2026-09-22', 'private')] });
    const { res } = callEntry<any>(api.sandbox, 'doGet', { action: 'getJournal' });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('private');
  });

  it('refuses a token caller as read_only', () => {
    const api = loadApi({ journal: [row('2026-09-22', 'private')] });
    const { res, text } = callEntry<any>(api.sandbox, 'doGet', { action: 'getJournal', access_token: 'x' });
    expect(res.success).toBe(false);
    expect(text).not.toContain('private');
  });
});
