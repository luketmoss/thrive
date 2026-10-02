// #240 — the Day screen's Note panel: one free-text journal entry per day,
// autosaved. Reads its date out of `journalEntries` (loaded once per Day-screen
// visit by `journalRefresh`) and writes through `panels/journal/drafts.ts`,
// which holds edits outside this component because the slot remounts on every
// date change. No Save button: the debounce, blur, unmount and page-hidden
// flushes do it.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAuth } from '../../auth/auth-context';
import { journalEntries } from '../../state/store';
import { loadJournal } from '../../state/actions';
import { fullDate } from '../../day/format';
import type { DayState } from '../../day/dates';
import { editNote, flushNote, noteDrafts, setNoteFocus, setNoteToken, type NoteStatus } from '../../panels/journal/drafts';
import { Panel, PanelStatus, type DayPanelProps } from './panel';
import { useFocusHandoff } from '../focus-handoff';

/** Sheets' per-cell limit, matching #233's boundary. */
export const NOTE_MAX_LENGTH = 50000;

export const NOTE_PLACEHOLDER: Record<DayState, string> = {
  past: 'What happened this day?',
  today: "How's today going?",
  future: 'Notes for this day…',
};

const SUB: Record<NoteStatus, string | undefined> = {
  idle: undefined,
  waiting: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Not saved',
};

/**
 * The save retry (#290). Kept mounted while its retry runs (`aria-disabled`, not
 * `disabled`, so focus stays on it); when it unmounts holding focus, focus goes
 * to the panel's heading, never `body` and never the textarea.
 */
function NoteRetry({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusHandoff(ref, (el) => el.closest('.day-panel')?.querySelector<HTMLElement>('.day-panel-title'));
  return (
    <button
      type="button"
      ref={ref}
      class="btn btn-secondary panel-retry"
      aria-label="Try again — save note"
      aria-disabled={busy ? 'true' : undefined}
      onClick={() => { if (!busy) onPress(); }}
    >
      Try again
    </button>
  );
}

export function JournalPanel({ date, state }: DayPanelProps) {
  const { token } = useAuth();
  setNoteToken(token);
  const tab = journalEntries.value;
  const draft = noteDrafts.value[date];
  const ref = useRef<HTMLTextAreaElement>(null);
  // #290: a Try again is in flight (keeps its button mounted), and its save landed.
  const [retrying, setRetrying] = useState(false);
  const [savedAfterRetry, setSavedAfterRetry] = useState(false);
  useEffect(() => { setRetrying(false); setSavedAfterRetry(false); }, [date]);
  const status = draft?.status;
  useEffect(() => {
    if (!retrying || status === 'saving' || status === 'failed') return;
    setRetrying(false);
    if (status === 'saved' || status === undefined) setSavedAfterRetry(true);
  }, [retrying, status]);

  // A day swipe, the week strip, a tab change or the midnight rollover
  // unmounts this: send what is held to the date it was showing.
  useEffect(() => () => {
    setNoteFocus(null);
    flushNote(date);
  }, [date]);

  const loaded = tab.state === 'loaded';
  const entryText = loaded ? tab.entries.find((e) => e.date === date)?.note ?? '' : '';
  const value = draft?.text ?? entryText;

  // Grow with the content: the page scrolls, the box does not.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, loaded]);

  const failed = draft?.status === 'failed';
  const sub = draft ? SUB[draft.status] : undefined;

  if (!loaded) {
    return (
      <Panel title="Note">
        <PanelStatus
          status={tab.state === 'error' ? 'error' : tab.state === 'loading' ? 'loading' : 'idle'}
          what="your journal"
          onRetry={() => { if (token) void loadJournal(token); }}
        />
      </Panel>
    );
  }

  const showRetry = failed || (retrying && status === 'saving');
  const textId = `note-${date}`;
  return (
    <Panel
      title="Note"
      sub={sub}
      action={showRetry ? (
        <NoteRetry
          busy={status === 'saving'}
          onPress={() => { setRetrying(true); setSavedAfterRetry(false); flushNote(date); }}
        />
      ) : undefined}
    >
      <label class="sr-only" for={textId}>{`Journal entry for ${fullDate(date)}`}</label>
      <textarea
        id={textId}
        ref={ref}
        class="form-textarea note-box"
        rows={4}
        maxLength={NOTE_MAX_LENGTH}
        autocapitalize="sentences"
        placeholder={NOTE_PLACEHOLDER[state]}
        value={value}
        onInput={(e) => {
          setRetrying(false);
          setSavedAfterRetry(false);
          editNote(date, (e.currentTarget as HTMLTextAreaElement).value);
        }}
        onFocus={() => setNoteFocus(date)}
        onBlur={() => { setNoteFocus(null); flushNote(date); }}
      />
      <p class="sr-only" role="status">{failed ? "Couldn't save your note." : savedAfterRetry ? 'Note saved.' : ''}</p>
    </Panel>
  );
}
