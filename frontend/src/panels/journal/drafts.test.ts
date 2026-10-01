// #240 AC2, AC3, AC4, AC5 — the note drafts and autosave.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const upsert = vi.fn();
vi.mock('../../api/journal-api', () => ({ upsertJournalEntry: (...a: unknown[]) => upsert(...a) }));
let demo = false;
vi.mock('../../api/demo-data', () => ({ isDemo: () => demo }));

import { editNote, flushNote, flushAllNotes, noteDrafts, setNoteToken, setNoteFocus, isNoteLocked, resetNoteDrafts, NOTE_DEBOUNCE_MS } from './drafts';
import { journalEntries } from '../../state/store';

const D = '2026-09-26';
const E = '2026-09-27';
const entry = (date: string, note: string) => ({ date, note, created: 'c', updated: 'u' });
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => { resolve = a; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  upsert.mockReset();
  upsert.mockImplementation(async (date: string, note: string) => (note.trim() ? entry(date, note) : null));
  demo = false;
  resetNoteDrafts();
  setNoteToken('tok');
  journalEntries.value = { state: 'loaded', entries: [entry(D, 'old')] };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('triggers', () => {
  it('sends 1000 ms after the last keystroke, only that date, whole field', async () => {
    editNote(D, 'a');
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS - 1);
    editNote(D, 'ab');
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS - 1);
    expect(upsert).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(D, 'ab', 'tok');
  });

  it('sends at once on flush (blur or unmount)', async () => {
    editNote(D, 'new');
    flushNote(D);
    expect(upsert).toHaveBeenCalledWith(D, 'new', 'tok');
    await flush();
    expect(noteDrafts.value[D]).toEqual({ text: null, status: 'saved' });
  });

  it('sends every held edit when the page is hidden or goes away', async () => {
    editNote(D, 'one');
    editNote(E, 'two');
    flushAllNotes();
    expect(upsert).toHaveBeenCalledTimes(2);
    await flush();
  });

  it('sends nothing for text the panel already shows', () => {
    editNote(D, 'old');
    flushNote(D);
    expect(upsert).not.toHaveBeenCalled();
    expect(noteDrafts.value[D]).toBeUndefined();
  });

  it('flushing with nothing held does nothing', () => {
    flushNote(D);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('one save at a time', () => {
  it('holds a later edit until the save in flight lands, then sends it', async () => {
    const first = deferred<ReturnType<typeof entry>>();
    upsert.mockReturnValueOnce(first.promise);
    editNote(D, 'a');
    flushNote(D);
    expect(noteDrafts.value[D].status).toBe('saving');
    editNote(D, 'ab');
    flushNote(D);
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS * 2);
    expect(upsert).toHaveBeenCalledTimes(1);
    first.resolve(entry(D, 'a'));
    await flush();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(D, 'ab', 'tok');
    await flush();
    expect(noteDrafts.value[D]).toEqual({ text: null, status: 'saved' });
  });
});

describe('after a save', () => {
  it('updates journalEntries in place and clears the draft', async () => {
    editNote(E, 'fresh');
    flushNote(E);
    await flush();
    const tab = journalEntries.value;
    expect(tab.state === 'loaded' && tab.entries.map((e) => e.date)).toEqual([D, E]);
    expect(noteDrafts.value[E].text).toBeNull();
  });

  it('clearing a note removes the entry, no confirmation, and reads Saved (AC5)', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    editNote(D, '   ');
    flushNote(D);
    expect(upsert).toHaveBeenCalledWith(D, '   ', 'tok');
    await flush();
    expect(journalEntries.value).toEqual({ state: 'loaded', entries: [] });
    expect(noteDrafts.value[D]).toEqual({ text: null, status: 'saved' });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('failure', () => {
  it('keeps the text, reads failed, and retries on the next edit', async () => {
    upsert.mockRejectedValueOnce(new Error('500'));
    editNote(D, 'x');
    flushNote(D);
    await flush();
    expect(noteDrafts.value[D]).toEqual({ text: 'x', status: 'failed' });
    editNote(D, 'xy');
    expect(noteDrafts.value[D].status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS);
    expect(upsert).toHaveBeenLastCalledWith(D, 'xy', 'tok');
  });

  it('retries a failed save when the browser comes back online, and not otherwise', async () => {
    upsert.mockRejectedValueOnce(new Error('offline'));
    editNote(D, 'x');
    flushNote(D);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upsert).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(upsert).toHaveBeenCalledTimes(2);
    await flush();
    expect(noteDrafts.value[D].status).toBe('saved');
  });

  it('Try again (a flush) resends the held text at once', async () => {
    upsert.mockRejectedValueOnce(new Error('500'));
    editNote(D, 'x');
    flushNote(D);
    await flush();
    flushNote(D);
    expect(upsert).toHaveBeenCalledTimes(2);
    await flush();
  });
});

describe('lock and unload guard', () => {
  it('locks a date with a held edit or the focused date, against refresh', () => {
    expect(isNoteLocked(D)).toBe(false);
    editNote(D, 'x');
    expect(isNoteLocked(D)).toBe(true);
    setNoteFocus(E);
    expect(isNoteLocked(E)).toBe(true);
    setNoteFocus(null);
    expect(isNoteLocked(E)).toBe(false);
  });

  it('asks before unload only while something is unsaved, outside demo mode', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    editNote(D, 'x');
    expect(add.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(1);
    flushNote(D);
    await flush();
    expect(remove.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(1);
  });

  it('never asks in demo mode', () => {
    demo = true;
    const add = vi.spyOn(window, 'addEventListener');
    editNote(D, 'x');
    expect(add.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(0);
  });
});
