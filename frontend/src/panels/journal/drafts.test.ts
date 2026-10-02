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
    await flush();
    expect(upsert).toHaveBeenCalledTimes(2);
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

describe('across dates', () => {
  it('never has two saves in flight at once, so a delete cannot shift a row under another save', async () => {
    const first = deferred<null>();
    upsert.mockReturnValueOnce(first.promise);
    editNote(D, ''); // clearing D deletes its row
    editNote(E, 'second');
    flushAllNotes();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenLastCalledWith(D, '', 'tok');
    first.resolve(null);
    await flush();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(E, 'second', 'tok');
    await flush();
    expect(noteDrafts.value[D].status).toBe('saved');
    expect(noteDrafts.value[E].status).toBe('saved');
  });

  it('a failure of one does not stop the next', async () => {
    upsert.mockRejectedValueOnce(new Error('500'));
    editNote(D, 'a');
    editNote(E, 'b');
    flushAllNotes();
    await flush();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(noteDrafts.value[D].status).toBe('failed');
    expect(noteDrafts.value[E].status).toBe('saved');
  });
});

const guardCalls = (spy: ReturnType<typeof vi.spyOn>, name: string) =>
  spy.mock.calls.filter((c: unknown[]) => c[0] === name).length;

describe('blank text for a day with no note', () => {
  it('is not sent, and while the box has focus the draft is held idle with no unload prompt (#278 AC1, AC2)', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    setNoteFocus(E);
    editNote(E, '  ');
    expect(noteDrafts.value[E]).toEqual({ text: '  ', status: 'idle' });
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS);
    expect(upsert).not.toHaveBeenCalled();
    expect(noteDrafts.value[E]).toEqual({ text: '  ', status: 'idle' });
    expect(guardCalls(add, 'beforeunload')).toBe(0);
    setNoteFocus(null);
    flushNote(E);
    expect(upsert).not.toHaveBeenCalled();
    expect(noteDrafts.value[E]).toBeUndefined(); // AC7
  });

  it('typing a real character resumes autosave and arms then clears the guard (AC2, AC4)', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    setNoteFocus(E);
    editNote(E, '  ');
    editNote(E, '  x');
    expect(noteDrafts.value[E].status).toBe('waiting');
    expect(guardCalls(add, 'beforeunload')).toBe(1);
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS);
    expect(upsert).toHaveBeenCalledWith(E, '  x', 'tok');
    await flush();
    expect(guardCalls(remove, 'beforeunload')).toBe(1);
  });

  it('page hidden still sends nothing (AC5)', () => {
    setNoteFocus(E);
    editNote(E, ' \n');
    flushAllNotes();
    expect(upsert).not.toHaveBeenCalled();
    expect(noteDrafts.value[E].status).toBe('idle');
  });

  it('an idle draft is held against a refresh (AC6)', () => {
    setNoteFocus(E);
    editNote(E, ' ');
    setNoteFocus(null);
    expect(isNoteLocked(E)).toBe(true);
  });
});

describe('whitespace over an existing note (#278 AC3, AC5)', () => {
  it('is deferred while focused, then sent once on blur', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    setNoteFocus(D);
    editNote(D, ' ');
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS * 2);
    expect(upsert).not.toHaveBeenCalled();
    expect(noteDrafts.value[D]).toEqual({ text: ' ', status: 'idle' });
    expect(guardCalls(add, 'beforeunload')).toBe(0);
    const tab = journalEntries.value;
    expect(tab.state === 'loaded' && tab.entries[0].note).toBe('old');
    setNoteFocus(null);
    flushNote(D);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(D, ' ', 'tok');
    expect(noteDrafts.value[D].status).toBe('saving');
    await flush();
    expect(noteDrafts.value[D]).toEqual({ text: null, status: 'saved' });
  });

  it('a fully empty box still saves after the debounce', async () => {
    setNoteFocus(D);
    editNote(D, '');
    await vi.advanceTimersByTimeAsync(NOTE_DEBOUNCE_MS);
    expect(upsert).toHaveBeenCalledWith(D, '', 'tok');
  });

  it('page hidden sends the pending delete even while focused', async () => {
    setNoteFocus(D);
    editNote(D, ' ');
    flushAllNotes();
    expect(upsert).toHaveBeenCalledWith(D, ' ', 'tok');
  });

  it('an edit during a save stays saving, then goes idle when it lands blank and focused', async () => {
    const d = deferred<ReturnType<typeof entry>>();
    upsert.mockReturnValueOnce(d.promise);
    setNoteFocus(D);
    editNote(D, 'new');
    flushNote(D);
    editNote(D, ' ');
    expect(noteDrafts.value[D].status).toBe('saving');
    d.resolve(entry(D, 'new'));
    await flush();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(noteDrafts.value[D]).toEqual({ text: ' ', status: 'idle' });
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

describe('#299 whitespace edge cases', () => {
  async function failedWhitespace() {
    upsert.mockRejectedValueOnce(new Error('500'));
    setNoteFocus(D);
    editNote(D, ' ');
    flushAllNotes(); // page hidden: the delete of a stored note is forced out
    await flush();
    expect(noteDrafts.value[D]).toEqual({ text: ' ', status: 'failed' });
  }

  it('AC1: online leaves a focused whitespace failed draft failed, then blur sends it once', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    await failedWhitespace();
    upsert.mockClear();
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(upsert).not.toHaveBeenCalled();
    expect(noteDrafts.value[D]).toEqual({ text: ' ', status: 'failed' });
    expect(guardCalls(add, 'beforeunload')).toBeGreaterThanOrEqual(1);
    setNoteFocus(null);
    flushNote(D);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(D, ' ', 'tok');
    await flush();
  });

  it('AC1: a failed whitespace draft whose box is not focused is resent by online', async () => {
    await failedWhitespace();
    setNoteFocus(null);
    upsert.mockClear();
    window.dispatchEvent(new Event('online'));
    expect(upsert).toHaveBeenCalledTimes(1);
    await flush();
  });

  it('AC2: a blur flush of whitespace over no note drops the draft, or reads Saved after a save that day', async () => {
    setNoteFocus(E);
    editNote(E, '  ');
    setNoteFocus(null);
    flushNote(E);
    expect(noteDrafts.value[E]).toBeUndefined();
    editNote(E, 'real');
    flushNote(E);
    await flush();
    journalEntries.value = { state: 'loaded', entries: [entry(D, 'old')] };
    editNote(E, '  ');
    flushNote(E);
    expect(noteDrafts.value[E]).toEqual({ text: null, status: 'saved' });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('AC3: whitespace typed during an in-flight save goes idle on landing; the delete waits', async () => {
    const first = deferred<ReturnType<typeof entry>>();
    upsert.mockReturnValueOnce(first.promise);
    setNoteFocus(D);
    editNote(D, 'new');
    flushNote(D);
    editNote(D, ' ');
    first.resolve(entry(D, 'new'));
    await flush();
    expect(noteDrafts.value[D]).toEqual({ text: ' ', status: 'idle' });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('AC4: no token, whitespace over no note: dropped on blur, nothing sent, no failed', () => {
    setNoteToken(null);
    setNoteFocus(E);
    editNote(E, ' ');
    setNoteFocus(null);
    flushNote(E);
    expect(noteDrafts.value[E]).toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('AC4: no token still fails real text, and whitespace over a stored note', () => {
    setNoteToken(null);
    editNote(E, 'text');
    flushNote(E);
    expect(noteDrafts.value[E]).toEqual({ text: 'text', status: 'failed' });
    setNoteFocus(D);
    editNote(D, ' ');
    setNoteFocus(null);
    flushNote(D);
    expect(noteDrafts.value[D]).toEqual({ text: ' ', status: 'failed' });
    expect(upsert).not.toHaveBeenCalled();
  });
});
