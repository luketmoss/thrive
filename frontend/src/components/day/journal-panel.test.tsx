// #240 AC1, AC3, AC4, AC6 — the Note panel.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';

const loadJournal = vi.fn(async (_t: string) => {});
vi.mock('../../state/actions', () => ({ loadJournal: (t: string) => loadJournal(t) }));
const upsert = vi.fn();
vi.mock('../../api/journal-api', () => ({ upsertJournalEntry: (...a: unknown[]) => upsert(...a) }));
vi.mock('../../api/demo-data', () => ({ isDemo: () => false }));

import { AuthContext, type AuthState } from '../../auth/auth-context';
import { JournalPanel } from './journal-panel';
import { SLOTS } from './slots';
import { journalEntries } from '../../state/store';
import { resetNoteDrafts } from '../../panels/journal/drafts';
import type { DayState } from '../../day/dates';

const D = '2026-09-26';
const AUTH: AuthState = { token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} };
const entry = (date: string, note: string) => ({ date, note, created: 'c', updated: 'u' });

function mount(date = D, state: DayState = 'past') {
  return render(
    <AuthContext.Provider value={AUTH}>
      <JournalPanel date={date} state={state} today="2026-09-30" />
    </AuthContext.Provider>,
  );
}
const box = (c: Element) => c.querySelector('textarea') as HTMLTextAreaElement;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  loadJournal.mockClear();
  upsert.mockReset();
  upsert.mockImplementation(async (date: string, note: string) => (note.trim() ? entry(date, note) : null));
  resetNoteDrafts();
  journalEntries.value = { state: 'loaded', entries: [entry(D, 'hello')] };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Note panel', () => {
  it('fills the note slot', () => {
    expect(SLOTS.note).toBe(JournalPanel);
  });

  it("shows the date's entry, labelled for the full date, with the agreed box attributes", () => {
    const { container, getByLabelText } = mount();
    expect(box(container).value).toBe('hello');
    expect(getByLabelText('Journal entry for September 26, 2026')).toBe(box(container));
    expect(box(container).getAttribute('maxlength')).toBe('50000');
    expect(box(container).getAttribute('rows')).toBe('4');
    expect(box(container).getAttribute('autocapitalize')).toBe('sentences');
    expect(container.querySelector('.day-panel-sub')).toBeNull();
  });

  it('reads a day with no entry as blank, with a placeholder for each state', () => {
    const cases: [DayState, string][] = [['past', 'What happened this day?'], ['today', "How's today going?"], ['future', 'Notes for this day…']];
    for (const [state, text] of cases) {
      const { container, unmount } = mount('2026-10-01', state);
      expect(box(container).value).toBe('');
      expect(box(container).placeholder).toBe(text);
      unmount();
    }
  });

  it('says Saving… on an edit and Saved once it lands, which survives a remount', async () => {
    const { container, unmount } = mount();
    fireEvent.input(box(container), { target: { value: 'hello there' } });
    expect(container.querySelector('.day-panel-sub')!.textContent).toBe('Saving…');
    unmount(); // the swipe: flushes at once
    expect(upsert).toHaveBeenCalledWith(D, 'hello there', 'tok');
    await settle();
    const again = mount();
    expect(again.container.querySelector('.day-panel-sub')!.textContent).toBe('Saved');
    expect(box(again.container).value).toBe('hello there');
  });

  it('shows the held draft, not the stored entry, on coming back before the save lands', () => {
    upsert.mockReturnValue(new Promise(() => {}));
    const first = mount();
    fireEvent.input(box(first.container), { target: { value: 'draft' } });
    first.unmount();
    const again = mount();
    expect(box(again.container).value).toBe('draft');
  });

  it('flushes on blur', () => {
    const { container } = mount();
    fireEvent.input(box(container), { target: { value: 'blur me' } });
    fireEvent.blur(box(container));
    expect(upsert).toHaveBeenCalledWith(D, 'blur me', 'tok');
  });

  it('on failure: Not saved, a named Try again, one announcement, text kept', async () => {
    upsert.mockRejectedValueOnce(new Error('500'));
    const { container } = mount();
    fireEvent.input(box(container), { target: { value: 'keep me' } });
    fireEvent.blur(box(container));
    await settle();
    expect(container.querySelector('.day-panel-sub')!.textContent).toBe('Not saved');
    expect(box(container).value).toBe('keep me');
    expect(container.querySelector('p.sr-only[role="status"]')!.textContent).toBe("Couldn't save your note.");
    const retry = container.querySelector('.day-panel-action button')!;
    expect(retry.getAttribute('aria-label')).toBe('Try again — save note');
    expect(retry.textContent).toBe('Try again');
    expect(retry.classList.contains('panel-retry')).toBe(true);
    fireEvent.click(retry);
    expect(upsert).toHaveBeenCalledTimes(2);
    await settle();
    expect(container.querySelector('.day-panel-action')).toBeNull();
    expect(container.querySelector('.day-panel-sub')!.textContent).toBe('Saved');
  });

  it('clearing the box sends the blank text and keeps the box', async () => {
    const { container } = mount();
    fireEvent.input(box(container), { target: { value: '' } });
    fireEvent.blur(box(container));
    expect(upsert).toHaveBeenCalledWith(D, '', 'tok');
    await settle();
    expect(box(container).value).toBe('');
    expect(container.querySelector('.day-panel-sub')!.textContent).toBe('Saved');
  });

  it('shows no box while the journal is idle, loading or failed; Try again reloads', () => {
    for (const state of ['idle', 'loading', 'error'] as const) {
      journalEntries.value = { state };
      const { container, unmount } = mount();
      expect(container.querySelector('textarea')).toBeNull();
      expect(container.querySelector('.panel-status')).not.toBeNull();
      if (state === 'error') {
        fireEvent.click(container.querySelector('.panel-retry')!);
        expect(loadJournal).toHaveBeenCalledWith('tok');
      }
      unmount();
    }
  });

  it('keeps held changes while the journal is not loaded and shows them once it is', () => {
    upsert.mockReturnValue(new Promise(() => {}));
    const first = mount();
    fireEvent.input(box(first.container), { target: { value: 'held' } });
    first.unmount();
    journalEntries.value = { state: 'loading' };
    const loading = mount();
    expect(loading.container.querySelector('textarea')).toBeNull();
    act(() => { journalEntries.value = { state: 'loaded', entries: [entry(D, 'hello')] }; });
    expect(box(loading.container).value).toBe('held');
  });
});
