// #240 AC1, AC3 — loadJournal: one signal, joined loads, refresh never overwrites.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchJournal = vi.fn();
vi.mock('../api/journal-api', () => ({ fetchJournal: (t: string) => fetchJournal(t) }));

import { loadJournal } from './actions';
import { journalEntries, applyJournalSave } from './store';
import { editNote, setNoteFocus, resetNoteDrafts } from '../panels/journal/drafts';

const row = (date: string, note: string) => ({ date, note, created: 'c', updated: 'u', sheetRow: 2 });
const entry = (date: string, note: string) => ({ date, note, created: 'c', updated: 'u' });

beforeEach(() => {
  fetchJournal.mockReset();
  resetNoteDrafts();
  journalEntries.value = { state: 'idle' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadJournal', () => {
  it('stores every row, in sheet order, without sheetRow', async () => {
    fetchJournal.mockResolvedValue([row('2026-09-20', 'a'), row('2026-09-21', 'b')]);
    await loadJournal('tok');
    expect(fetchJournal).toHaveBeenCalledWith('tok');
    expect(journalEntries.value).toEqual({ state: 'loaded', entries: [entry('2026-09-20', 'a'), entry('2026-09-21', 'b')] });
  });

  it('shows loading while the first read runs, and a call during it joins it', async () => {
    let resolve!: (v: unknown) => void;
    fetchJournal.mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = loadJournal('tok');
    const b = loadJournal('tok');
    expect(journalEntries.value.state).toBe('loading');
    expect(fetchJournal).toHaveBeenCalledTimes(1);
    resolve([]);
    await Promise.all([a, b]);
    expect(journalEntries.value).toEqual({ state: 'loaded', entries: [] });
  });

  it('is an error when the first read fails, and Try again can load it', async () => {
    fetchJournal.mockRejectedValueOnce(new Error('500'));
    await loadJournal('tok');
    expect(journalEntries.value).toEqual({ state: 'error' });
    fetchJournal.mockResolvedValue([]);
    await loadJournal('tok');
    expect(journalEntries.value.state).toBe('loaded');
  });

  it('keeps loaded entries when a refresh fails', async () => {
    fetchJournal.mockResolvedValueOnce([row('2026-09-20', 'a')]);
    await loadJournal('tok');
    fetchJournal.mockRejectedValueOnce(new Error('500'));
    await loadJournal('tok');
    expect(journalEntries.value.state).toBe('loaded');
  });

  it('leaves a date with an unsaved edit or a focused textarea alone', async () => {
    journalEntries.value = { state: 'loaded', entries: [entry('2026-09-20', 'mine'), entry('2026-09-21', 'mine2'), entry('2026-09-22', 'x')] };
    editNote('2026-09-20', 'typing');
    setNoteFocus('2026-09-21');
    fetchJournal.mockResolvedValue([row('2026-09-20', 'theirs'), row('2026-09-21', 'theirs2'), row('2026-09-22', 'y')]);
    await loadJournal('tok');
    const tab = journalEntries.value;
    const notes = tab.state === 'loaded' ? Object.fromEntries(tab.entries.map((e) => [e.date, e.note])) : {};
    expect(notes).toEqual({ '2026-09-20': 'mine', '2026-09-21': 'mine2', '2026-09-22': 'y' });
  });

  it('a refresh sent before a save landed never overwrites it', async () => {
    journalEntries.value = { state: 'loaded', entries: [entry('2026-09-20', 'old')] };
    let resolve!: (v: unknown) => void;
    fetchJournal.mockReturnValue(new Promise((r) => { resolve = r; }));
    const p = loadJournal('tok');
    applyJournalSave('2026-09-20', entry('2026-09-20', 'saved'));
    resolve([row('2026-09-20', 'old')]);
    await p;
    const tab = journalEntries.value;
    expect(tab.state === 'loaded' && tab.entries[0].note).toBe('saved');
  });
});
