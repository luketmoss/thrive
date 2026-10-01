// #240 — the Day Note panel's drafts and autosave, kept outside the panel
// component because the Day screen remounts every slot on each date change
// (#237): a swipe must not lose an edit, nor the "Saved" it earned.
//
// `noteDrafts` is one record per date touched this session:
//   status 'waiting'  an edit is held, the 1000 ms debounce is running
//          'saving'   a save for that date is in flight
//          'saved'    the last edit landed (text is null; the panel shows the entry)
//          'failed'   the last save failed; the text is kept
//          'idle'     (#278) held but nothing to send: only whitespace typed
//                     while the box has focus. No sub line, no unload prompt;
//                     blur, leaving the day or (for a stored note) the page
//                     being hidden resolves it.
// `text` is the held edit, or null once it has landed. At most one save per
// date is ever in flight; a later edit waits for it and goes straight after.
// Across dates, saves run one at a time too (`sequential`): `upsertJournalEntry`
// finds a row number and then writes to it, and a delete shifts every row below,
// so two saves overlapping could write into another day's row.

import { batch, signal } from '@preact/signals';
import { upsertJournalEntry } from '../../api/journal-api';
import { isDemo } from '../../api/demo-data';
import { applyJournalSave, journalEntries } from '../../state/store';
import { onPageHidden } from '../../state/page-visible';

export type NoteStatus = 'waiting' | 'saving' | 'saved' | 'failed' | 'idle';
export interface NoteDraft {
  text: string | null;
  status: NoteStatus;
}

/** Same debounce as set autosave in `workout-tracker.tsx`. */
export const NOTE_DEBOUNCE_MS = 1000;

export const noteDrafts = signal<Record<string, NoteDraft>>({});

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, string>(); // date -> the text being sent
const everSaved = new Set<string>();
let token: string | null = null;
let pending = 0;
let tail: Promise<void> = Promise.resolve();

/** Run saves one at a time, whatever their date. Starts at once when idle. */
function sequential<T>(fn: () => Promise<T>): Promise<T> {
  const p = pending === 0 ? fn() : tail.then(fn);
  pending++;
  tail = p.then(() => undefined, () => undefined).then(() => { pending--; });
  return p;
}
let focused: string | null = null;
let installed = false;
let unloadGuard = false;

/** The panel hands over the session's token; flushes outside the component use it. */
export function setNoteToken(t: string | null): void {
  token = t;
}

/** The date whose textarea has focus, so a refresh leaves its entry alone. */
export function setNoteFocus(date: string | null): void {
  focused = date;
}

/** True while a journal refresh must not touch this date's entry. */
export function isNoteLocked(date: string): boolean {
  return focused === date || noteDrafts.value[date]?.text != null;
}

/** The text a date's entry holds in the store ('' when it has none). */
function committed(date: string): string | null {
  const tab = journalEntries.value;
  if (tab.state !== 'loaded') return null;
  return tab.entries.find((e) => e.date === date)?.note ?? '';
}

function put(date: string, d: NoteDraft | null): void {
  const next = { ...noteDrafts.value };
  if (d) next[date] = d;
  else delete next[date];
  noteDrafts.value = next;
  syncUnloadGuard();
}

function unsaved(): boolean {
  return Object.values(noteDrafts.value).some((d) => d.text != null && d.status !== 'idle');
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = '';
}

/** Ask before the tab closes only while something is unsaved (never in demo mode). */
function syncUnloadGuard(): void {
  const want = !isDemo() && unsaved();
  if (want === unloadGuard) return;
  unloadGuard = want;
  if (want) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('online', retryFailed);
  window.addEventListener('pagehide', flushAllNotes);
  onPageHidden(flushAllNotes);
}

function retryFailed(): void {
  for (const [date, d] of Object.entries(noteDrafts.value)) if (d.status === 'failed') flushNote(date);
}

/** Send every held edit now (the page is going away). */
export function flushAllNotes(): void {
  for (const [date, d] of Object.entries(noteDrafts.value)) {
    if (d.text == null || d.status === 'saving') continue;
    // A pending delete of a stored note must not die with the tab, even
    // while the box has focus; a day with no note has nothing to send.
    const stored = committed(date);
    flushNote(date, stored != null && stored !== '');
  }
}

/** Whitespace only (not empty) in the focused box: held, nothing to send (#278). */
function isIdleText(date: string, text: string): boolean {
  return focused === date && text !== '' && text.trim() === '';
}

/** The user typed: hold `text` for `date` and start the debounce. */
export function editNote(date: string, text: string): void {
  install();
  clearTimeout(timers.get(date));
  timers.delete(date);
  if (inFlight.has(date)) {
    // Waits for the save in flight; it goes straight after it lands.
    put(date, { text, status: 'saving' });
    return;
  }
  if (isIdleText(date, text)) {
    put(date, { text, status: 'idle' });
    return;
  }
  put(date, { text, status: 'waiting' });
  timers.set(date, setTimeout(() => flushNote(date), NOTE_DEBOUNCE_MS));
}

/**
 * Send the held text for `date` at once. Safe to call with nothing held.
 * A whitespace-only draft in the focused box is left idle unless `force`.
 */
export function flushNote(date: string, force = false): void {
  clearTimeout(timers.get(date));
  timers.delete(date);
  const d = noteDrafts.value[date];
  if (!d || d.text == null) return;
  if (inFlight.has(date)) return; // goes out when the save in flight lands
  const text = d.text;
  if (!force && isIdleText(date, text)) {
    put(date, { text, status: 'idle' });
    return;
  }
  if (committed(date) === text) {
    // Same as what the panel already shows: nothing to send.
    put(date, everSaved.has(date) ? { text: null, status: 'saved' } : null);
    return;
  }
  if (!token) {
    put(date, { text, status: 'failed' });
    return;
  }
  if (text.trim() === '' && committed(date) === '') {
    // Only spaces or Enter in a note that does not exist: nothing to delete.
    // While it is still being typed, dropping the draft would reset the box
    // under the caret; blur or leaving the day flushes it, and then it goes.
    if (focused === date) return;
    put(date, everSaved.has(date) ? { text: null, status: 'saved' } : null);
    return;
  }
  inFlight.set(date, text);
  put(date, { text, status: 'saving' });
  sequential(() => upsertJournalEntry(date, text, token ?? '')).then(
    (entry) => {
      inFlight.delete(date);
      everSaved.add(date);
      batch(() => {
        applyJournalSave(date, entry);
        const now = noteDrafts.value[date];
        if (now && now.text != null && now.text !== text) {
          // Typed more while it was in flight: send that straight away.
          put(date, { text: now.text, status: 'saving' });
        } else {
          put(date, { text: null, status: 'saved' });
        }
      });
      const now = noteDrafts.value[date];
      if (now?.text != null) flushNote(date);
    },
    (err) => {
      inFlight.delete(date);
      console.error('Failed to save journal note:', err);
      const now = noteDrafts.value[date];
      put(date, { text: now?.text ?? text, status: 'failed' });
    },
  );
}

/** The held text for a date, or null when none is held. */
export function heldNote(date: string): string | null {
  return noteDrafts.value[date]?.text ?? null;
}

/** Test seam: forget everything. */
export function resetNoteDrafts(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  inFlight.clear();
  pending = 0;
  tail = Promise.resolve();
  everSaved.clear();
  focused = null;
  token = null;
  noteDrafts.value = {};
  syncUnloadGuard();
}
