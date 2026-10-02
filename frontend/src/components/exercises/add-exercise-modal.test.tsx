// #319 — the exercise picker is a keyboard- and screen-reader-operable dialog.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { useState } from 'preact/hooks';

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'tok' }) }));
const addExercise = vi.fn();
vi.mock('../../state/actions', () => ({ addExercise: (...a: unknown[]) => addExercise(...a) }));

import { AddExerciseModal } from './add-exercise-modal';
import { exercises, labels } from '../../state/store';
import type { ExerciseWithRow } from '../../api/types';

const ex = (id: string, name: string, tags = ''): ExerciseWithRow => ({
  id, name, tags, notes: '', created: '', sheetRow: 2,
});

beforeEach(() => {
  exercises.value = [
    ex('e2', 'Squat', 'Legs, Compound'),
    ex('e1', 'Ab Wheel', 'Core'),
    ex('e3', 'Plank'),
  ];
  labels.value = [
    { id: 'l1', name: 'Core', color_key: 'red', created: '', sheetRow: 2 },
    { id: 'l2', name: 'Legs', color_key: 'blue', created: '', sheetRow: 3 },
  ];
});

afterEach(() => {
  cleanup();
  exercises.value = [];
  labels.value = [];
  addExercise.mockReset();
});

/** A caller like the template editor: an opener that stays mounted. */
function Caller({ onSelect = () => {}, onClose = () => {} }: {
  onSelect?: (e: ExerciseWithRow) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return h('div', {}, [
    h('button', { id: 'add', onClick: () => setOpen(true) }, '+ Add Exercise'),
    open &&
      h(AddExerciseModal, {
        onSelect: (e: ExerciseWithRow) => { onSelect(e); setOpen(false); },
        onClose: () => { onClose(); setOpen(false); },
      }),
  ]);
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;
const rows = () => [...document.querySelectorAll<HTMLElement>('.exercise-list > .exercise-list-item')];

function openPicker(props: Parameters<typeof Caller>[0] = {}) {
  const r = render(h(Caller, props));
  $('#add').focus();
  fireEvent.click($('#add'));
  return r;
}

const nameOf = (el: HTMLElement) =>
  el.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ');
const descOf = (el: HTMLElement) =>
  el.getAttribute('aria-describedby')?.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ');

describe('AC1: exercise rows are buttons', () => {
  it('renders each row as a button with span content only, in name order', () => {
    openPicker();
    const r = rows();
    expect(r.map((x) => x.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    for (const row of r) {
      expect(row.getAttribute('type')).toBe('button');
      expect(row.querySelector('div')).toBeNull();
    }
    expect(r.map(nameOf)).toEqual(['Ab Wheel', 'Plank', 'Squat']);
    expect(document.querySelectorAll('.exercise-list div[onclick], .exercise-list .exercise-list-item:not(button)')).toHaveLength(0);
  });

  it('names a row by the exercise and describes it by its tags', () => {
    openPicker();
    const [wheel, plank, squat] = rows();
    expect(descOf(wheel)).toBe('Core');
    expect(descOf(squat)).toBe('Legs, Compound');
    expect(plank.hasAttribute('aria-describedby')).toBe(false);
    const ids = [...document.querySelectorAll('.exercise-list [id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('selects the exercise when a row is activated', () => {
    const onSelect = vi.fn();
    openPicker({ onSelect });
    fireEvent.click(rows()[0]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('keeps rows in the tab order after the search field and chips, with no listbox', () => {
    openPicker();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    const order = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] input')];
    const search = order.indexOf($('.search-input'));
    const lastChip = order.indexOf([...document.querySelectorAll<HTMLElement>('.tag-filter-row .tag-badge')].pop()!);
    const firstRow = order.indexOf(rows()[0]);
    expect(search).toBeLessThan(lastChip);
    expect(lastChip).toBeLessThan(firstRow);
    for (const row of rows()) expect(row.tabIndex).toBe(0);
  });
});

describe('AC2: Create New Exercise is a button', () => {
  it('is a button that opens the form with focus on Name', () => {
    openPicker();
    const create = $('.create-new-row');
    expect(create.tagName).toBe('BUTTON');
    expect(create.getAttribute('type')).toBe('button');
    expect(create.textContent!.trim()).toBe('+ Create New Exercise');
    fireEvent.click(create);
    expect($('[role="dialog"] h2').textContent).toBe('New Exercise');
    expect(document.activeElement).toBe($('[role="dialog"] form input'));
  });

  it('Cancel returns to the list with focus on search', () => {
    openPicker();
    fireEvent.click($('.create-new-row'));
    fireEvent.click([...document.querySelectorAll<HTMLElement>('form button')].find((b) => b.textContent === 'Cancel')!);
    expect(document.activeElement).toBe($('.search-input'));
  });

  it('Create & Select selects the new exercise, closes, and returns focus to the opener', async () => {
    const created = ex('e9', 'Dead Bug');
    addExercise.mockResolvedValue(created);
    const onSelect = vi.fn();
    openPicker({ onSelect });
    fireEvent.click($('.create-new-row'));
    const name = $('[role="dialog"] form input') as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'Dead Bug' } });
    fireEvent.submit($('[role="dialog"] form'));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(created));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe($('#add'));
  });
});

describe('AC3: dialog semantics and names', () => {
  it('is a modal dialog labelled by its title in both views', () => {
    openPicker();
    const dlg = $('.modal-content');
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dlg.getAttribute('aria-labelledby')!)!;
    expect(title.tagName).toBe('H2');
    expect(title.textContent).toBe('Select Exercise');
    fireEvent.click($('.create-new-row'));
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)).toBe(title);
    expect(title.textContent).toBe('New Exercise');
  });

  it('labels search, groups the chips, and reports each chip pressed state', () => {
    openPicker();
    expect($('.search-input').getAttribute('aria-label')).toBe('Search exercises');
    const group = $('.tag-filter-row');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Filter by tag');
    const core = [...group.querySelectorAll<HTMLElement>('.tag-badge')].find((c) => c.textContent === 'Core')!;
    expect(core.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(core);
    expect(core.getAttribute('aria-pressed')).toBe('true');
    expect(rows().map(nameOf)).toEqual(['Ab Wheel']);
  });

  it('announces No matching exercises in a status region', () => {
    openPicker();
    const status = $('.exercise-list [role="status"]');
    expect(status.textContent).toBe('');
    fireEvent.input($('.search-input'), { target: { value: 'zzz' } });
    expect($('.exercise-list [role="status"]')).toBe(status);
    expect(status.textContent).toBe('No matching exercises');
  });

  it('keeps the Close button named', () => {
    openPicker();
    expect($('.modal-close').getAttribute('aria-label')).toBe('Close');
    expect($('.modal-close').getAttribute('type')).toBe('button');
  });
});

describe('AC4: focus in, trap, Escape, restore', () => {
  it('moves focus to search on open', () => {
    openPicker();
    expect(document.activeElement).toBe($('.search-input'));
  });

  it('wraps Tab from the create row to Close, and Shift+Tab back', () => {
    openPicker();
    $('.create-new-row').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe($('.modal-close'));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe($('.create-new-row'));
  });

  it('in the form, skips a disabled Create & Select when wrapping', () => {
    openPicker();
    fireEvent.click($('.create-new-row'));
    const cancel = [...document.querySelectorAll<HTMLElement>('form button')].find((b) => b.textContent === 'Cancel')!;
    expect(($('form button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe($('.modal-close'));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['Close', () => fireEvent.click($('.modal-close'))],
    ['the overlay', () => fireEvent.click($('.modal-overlay'))],
  ])('closes on %s and returns focus to the opener', (_, act) => {
    const onClose = vi.fn();
    openPicker({ onClose });
    act();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe($('#add'));
  });

  it('closes on Escape from the form view too', () => {
    const onClose = vi.fn();
    openPicker({ onClose });
    fireEvent.click($('.create-new-row'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe($('#add'));
  });

  it('returns focus to the opener after a row is picked', () => {
    openPicker();
    rows()[1].focus();
    fireEvent.click(rows()[1]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe($('#add'));
  });
});
