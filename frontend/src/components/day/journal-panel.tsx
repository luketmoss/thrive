// #240 — the Day screen's Note panel: one free-text journal entry per day,
// autosaved. Reads its date out of `journalEntries` (loaded once per Day-screen
// visit by `journalRefresh`) and writes through `panels/journal/drafts.ts`,
// which holds edits outside this component because the slot remounts on every
// date change. No Save button: the debounce, blur, unmount and page-hidden
// flushes do it.

import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { useAuth } from '../../auth/auth-context';
import { journalEntries } from '../../state/store';
import { loadJournal } from '../../state/actions';
import { fullDate } from '../../day/format';
import type { DayState } from '../../day/dates';
import { editNote, flushNote, noteDrafts, setNoteFocus, setNoteToken, type NoteStatus } from '../../panels/journal/drafts';
import { Panel, PanelStatus, type DayPanelProps } from './panel';

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

export function JournalPanel({ date, state }: DayPanelProps) {
  const { token } = useAuth();
  setNoteToken(token);
  const tab = journalEntries.value;
  const draft = noteDrafts.value[date];
  const ref = useRef<HTMLTextAreaElement>(null);

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

  const textId = `note-${date}`;
  return (
    <Panel
      title="Note"
      sub={sub}
      action={failed ? (
        <button
          type="button"
          class="btn btn-secondary panel-retry"
          aria-label="Try again — save note"
          onClick={() => flushNote(date)}
        >
          Try again
        </button>
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
        onInput={(e) => editNote(date, (e.currentTarget as HTMLTextAreaElement).value)}
        onFocus={() => setNoteFocus(date)}
        onBlur={() => { setNoteFocus(null); flushNote(date); }}
      />
      <p class="sr-only" role="status">{failed ? "Couldn't save your note." : ''}</p>
    </Panel>
  );
}
