// #376 — planned Reps take whole numbers only. A stored value that is not one
// (a range such as 4-6, AMRAP, 0) is held: shown read-only beside an empty
// input with a Clear, and saved exactly as stored until the user types a
// number over it or presses Clear. Drives the real TemplateEditor and
// WorkoutPlanner; only the writing actions are mocked. The new-plan planner
// seeded from a template is covered in workout/planner-reps-per-set.test.tsx.

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/preact';
import { templates } from '../../state/store';
import { DEMO_SETS, DEMO_TEMPLATE_ROWS, DEMO_WORKOUTS } from '../../api/demo-data';
import { isHeldReps, isWholeReps, plannerToBuilderExercises, REPS_INPUT_PROPS } from '../workout/planned-reps';
import type { PlannerExercise } from '../workout/workout-planner';

const editTemplate = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../../state/actions', () => ({
  addTemplate: vi.fn(),
  editTemplate: (...args: unknown[]) => editTemplate(...args),
  removeTemplate: vi.fn(),
}));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: vi.fn() }));

const { TemplateEditor } = await import('../templates/template-editor');
const { WorkoutPlanner } = await import('../workout/workout-planner');

// ── Helpers ────────────────────────────────────────────────────────

const ROWS: [string, string, string, string][] = [
  ['ex_bench', 'Bench Press', '5', '4-6'],
  ['ex_row', 'Row BB', '3', '12'],
  ['ex_curl', 'Curl DB', '3', ''],
  ['ex_plank', 'Plank', '3', 'AMRAP'],
  ['ex_dip', 'Dips', '3', '0'],
  ['ex_lunge', 'Lunge DB', '3', '8 each side'],
];
const T = { bench: 0, row: 1, curl: 2, plank: 3, dip: 4, lunge: 5 } as const;

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.compact-card-body'));
const summary = (i: number) => {
  const m = cards()[i].querySelector('.compact-card-meta');
  if (!m) return null;
  return (m.querySelector('[aria-hidden="true"]') ?? m).textContent;
};
const type = (el: HTMLInputElement, value: string) => fireEvent.input(el, { target: { value } });
const repsInput = () => screen.getByLabelText('Reps') as HTMLInputElement;
const heldLine = () => document.querySelector<HTMLElement>('.reps-field-held-line');
const clears = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.reps-field-clear'));
/** The text a sighted user sees in an element: its sr-only parts removed. */
function visible(el: Element | null): string | null {
  if (!el) return null;
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('.sr-only').forEach((n) => n.remove());
  return copy.textContent;
}
const description = (el: HTMLInputElement) => document.getElementById(el.getAttribute('aria-describedby')!)?.textContent ?? null;

function openTemplate(i: number) {
  render(<TemplateEditor templateId="t1" />);
  fireEvent.click(cards()[i]);
}

let confirmSpy: MockInstance<typeof window.confirm>;
beforeEach(() => {
  templates.value = [
    {
      id: 't1',
      name: 'Push Day',
      exercises: ROWS.map(([exercise_id, exercise_name, sets, reps], i) => ({
        template_id: 't1', template_name: 'Push Day', order: i + 1,
        exercise_id, exercise_name, section: 'primary', sets, reps, sheetRow: i + 2,
      })),
    },
  ];
  editTemplate.mockClear();
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
  templates.value = [];
});

describe('isWholeReps: 1-999, no leading zero, sign or decimal', () => {
  it.each(['1', '8', '10', '99', '999'])('%j is whole', (v) => {
    expect(isWholeReps(v)).toBe(true);
    expect(isHeldReps(v)).toBe(false);
  });
  it.each(['4-6', '10-12', 'AMRAP', '8+', '0', '08', '1000', '8.5', ' 8', '-1', 'e'])('%j is held', (v) => {
    expect(isWholeReps(v)).toBe(false);
    expect(isHeldReps(v)).toBe(true);
  });
  it('blank is neither: it means no target', () => {
    expect(isWholeReps('')).toBe(false);
    expect(isHeldReps('')).toBe(false);
  });
});

// ── AC1 ────────────────────────────────────────────────────────────

describe('AC1: the template editor shows held text read-only', () => {
  it('4-6: an empty input with no placeholder, "Planned: 4-6" and Clear beneath it', () => {
    openTemplate(T.bench);
    expect(repsInput().value).toBe('');
    expect(repsInput().hasAttribute('placeholder')).toBe(false);
    const line = heldLine()!;
    expect(line.closest('.form-group')).toBe(repsInput().closest('.form-group'));
    expect(visible(line.querySelector('.reps-field-held'))).toBe('Planned: 4-6');
    expect(clears()).toHaveLength(1);
    expect(clears()[0].textContent).toBe('Clear');
    expect(summary(T.bench)).toBe('5 × 4-6');
  });

  it('a whole number shows in the input, editable, with no Planned line and no Clear', () => {
    openTemplate(T.row);
    expect(repsInput().value).toBe('12');
    expect(heldLine()).toBeNull();
    expect(clears()).toHaveLength(0);
  });

  it('blank shows the empty input with the e.g. 10 placeholder', () => {
    openTemplate(T.curl);
    expect(repsInput().value).toBe('');
    expect(repsInput().placeholder).toBe('e.g. 10');
    expect(heldLine()).toBeNull();
  });

  it.each([[T.plank, 'Planned: AMRAP'], [T.dip, 'Planned: 0'], [T.lunge, 'Planned: 8 each side']])(
    'held text is shown exactly as stored (%i)',
    (i, text) => {
      openTemplate(i);
      expect(visible(heldLine()!.querySelector('.reps-field-held'))).toBe(text);
    },
  );
});

// ── AC2 ────────────────────────────────────────────────────────────

describe('AC2: replacing, clearing or keeping held text (template editor)', () => {
  it('typing 8 replaces it; deleting the 8 leaves Reps blank, not 4-6', () => {
    openTemplate(T.bench);
    type(repsInput(), '8');
    expect(repsInput().value).toBe('8');
    expect(heldLine()).toBeNull();
    expect(clears()).toHaveLength(0);
    expect(summary(T.bench)).toBe('5 × 8');
    type(repsInput(), '');
    expect(repsInput().value).toBe('');
    expect(heldLine()).toBeNull();
    expect(summary(T.bench)).toBe('5 sets');
  });

  it('Clear blanks it, brings back the placeholder and focuses the Reps input', () => {
    openTemplate(T.bench);
    fireEvent.click(clears()[0]);
    expect(repsInput().value).toBe('');
    expect(heldLine()).toBeNull();
    expect(clears()).toHaveLength(0);
    expect(repsInput().placeholder).toBe('e.g. 10');
    expect(document.activeElement).toBe(repsInput());
    expect(summary(T.bench)).toBe('5 sets');
  });

  it('Save untouched writes every stored Reps byte for byte', async () => {
    openTemplate(T.bench);
    fireEvent.click(screen.getByText('Save Template'));
    await Promise.resolve();
    expect(editTemplate).toHaveBeenCalledTimes(1);
    const inputs = editTemplate.mock.calls[0][2] as { reps: string; sets: string }[];
    expect(inputs.map((x) => x.reps)).toEqual(['4-6', '12', '', 'AMRAP', '0', '8 each side']);
  });

  it('a replaced held value saves the number', async () => {
    openTemplate(T.bench);
    type(repsInput(), '8');
    fireEvent.click(screen.getByText('Save Template'));
    await Promise.resolve();
    expect((editTemplate.mock.calls[0][2] as { reps: string }[])[0].reps).toBe('8');
  });

  it('an editor opened (and expanded) but untouched is not dirty: Back does not ask', () => {
    openTemplate(T.bench);
    fireEvent.click(screen.getByLabelText('Back'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('a refused keystroke does not make it dirty either', () => {
    openTemplate(T.bench);
    type(repsInput(), '-');
    fireEvent.click(screen.getByLabelText('Back'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Clear makes it dirty: Back asks', () => {
    openTemplate(T.bench);
    fireEvent.click(clears()[0]);
    fireEvent.click(screen.getByLabelText('Back'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});

// ── AC3 ────────────────────────────────────────────────────────────

describe('AC3: whole numbers only', () => {
  it('the input is text with a numeric keypad, a digits pattern, 3 characters, no autocomplete', () => {
    openTemplate(T.row);
    const el = repsInput();
    expect(el.type).toBe('text');
    expect(el.getAttribute('inputmode')).toBe('numeric');
    expect(el.getAttribute('pattern')).toBe('[0-9]*');
    expect(el.maxLength).toBe(3);
    expect(el.getAttribute('autocomplete')).toBe('off');
    expect(REPS_INPUT_PROPS).toEqual({ type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 3, autoComplete: 'off' });
  });

  it.each(['12.', '12-', '12+', '12e', '12 ', '1234', '4-6', '8.5'])('on 12, %j is refused and 12 kept', async (v) => {
    openTemplate(T.row);
    type(repsInput(), v);
    expect(repsInput().value).toBe('12');
    expect(summary(T.row)).toBe('3 × 12');
    fireEvent.click(screen.getByText('Save Template'));
    await Promise.resolve();
    expect((editTemplate.mock.calls[0][2] as { reps: string }[])[1].reps).toBe('12');
  });

  it.each(['0', '-', '.', '4-6', '05'])('on blank, %j is refused', (v) => {
    openTemplate(T.curl);
    type(repsInput(), v);
    expect(repsInput().value).toBe('');
    expect(summary(T.curl)).toBe('3 sets');
  });

  it.each(['0', '-', '4-6', '8.5'])('on held 4-6, %j is refused and 4-6 still held', async (v) => {
    openTemplate(T.bench);
    type(repsInput(), v);
    expect(repsInput().value).toBe('');
    expect(visible(heldLine()!.querySelector('.reps-field-held'))).toBe('Planned: 4-6');
    fireEvent.click(screen.getByText('Save Template'));
    await Promise.resolve();
    expect((editTemplate.mock.calls[0][2] as { reps: string }[])[0].reps).toBe('4-6');
  });

  it('blank is valid and saves blank', async () => {
    openTemplate(T.row);
    type(repsInput(), '');
    fireEvent.click(screen.getByText('Save Template'));
    await Promise.resolve();
    expect((editTemplate.mock.calls[0][2] as { reps: string }[])[1].reps).toBe('');
  });

  it('the Sets input is unchanged: a number input', () => {
    openTemplate(T.row);
    expect((screen.getByLabelText('Sets') as HTMLInputElement).type).toBe('number');
  });
});

// ── AC4 (planner) ──────────────────────────────────────────────────

const onSave = vi.fn(async (..._args: unknown[]) => undefined);
function openPlanner(list: PlannerExercise[], i = 0) {
  render(<WorkoutPlanner initialName="Plan" initialExercises={list} onSave={onSave} onDiscard={() => {}} saving={false} />);
  fireEvent.click(cards()[i]);
}
const rowBB = (reps: string[]): PlannerExercise => ({
  exercise_id: 'ex_row', exercise_name: 'Row BB', section: 'primary', sets: String(reps.length), reps_by_set: reps,
});
const allInput = () => screen.getByLabelText('Reps, all sets') as HTMLInputElement;
const rowInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('.planner-set-row input'));
const rowHeld = () =>
  Array.from(document.querySelectorAll('.planner-set-row')).map((r) => visible(r.querySelector('.reps-field-held')));
const savedReps = () => {
  const list = onSave.mock.calls[0][1] as PlannerExercise[];
  return plannerToBuilderExercises(list).map((e) => e.planned_reps_by_set);
};

describe('AC4: the planner', () => {
  beforeEach(() => onSave.mockClear());

  it('three sets of 4-6: each row reads Set n, an empty input, 4-6, Clear; all sets shows Planned: 4-6', () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    const rows = Array.from(document.querySelectorAll('.planner-set-row'));
    expect(rows.map((r) => visible(r))).toEqual(['Set 14-6Clear', 'Set 24-6Clear', 'Set 34-6Clear']);
    expect(rowInputs().map((el) => el.value)).toEqual(['', '', '']);
    expect(allInput().value).toBe('');
    expect(allInput().placeholder).not.toBe('Varies');
    expect(visible(heldLine()!.querySelector('.reps-field-held'))).toBe('Planned: 4-6');
    expect(clears()).toHaveLength(4);
  });

  it('6 into all sets sets every row; its Clear clears every row', () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    type(allInput(), '6');
    expect(rowInputs().map((el) => el.value)).toEqual(['6', '6', '6']);
    expect(clears()).toHaveLength(0);
    cleanup();
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    fireEvent.click(clears()[0]);
    expect(rowInputs().map((el) => el.value)).toEqual(['', '', '']);
    expect(rowHeld()).toEqual([null, null, null]);
    expect(document.activeElement).toBe(allInput());
  });

  it('6 into Set 2 replaces only set 2; all sets then reads Varies with no Planned line', () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    type(rowInputs()[1], '6');
    expect(rowInputs().map((el) => el.value)).toEqual(['', '6', '']);
    expect(rowHeld()).toEqual(['4-6', null, '4-6']);
    expect(allInput().placeholder).toBe('Varies');
    expect(heldLine()).toBeNull();
  });

  it('Set 2\'s Clear clears only set 2 and focuses its input', () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    const set2 = clears().find((b) => b.getAttribute('aria-label')!.startsWith('Clear set 2'))!;
    fireEvent.click(set2);
    expect(rowHeld()).toEqual(['4-6', null, '4-6']);
    expect(document.activeElement).toBe(rowInputs()[1]);
  });

  it('4-6, 4-6, 8: all sets Varies with no Planned line; rows 1-2 held, row 3 shows 8', () => {
    openPlanner([rowBB(['4-6', '4-6', '8'])]);
    expect(allInput().value).toBe('');
    expect(allInput().placeholder).toBe('Varies');
    expect(heldLine()).toBeNull();
    expect(rowHeld()).toEqual(['4-6', '4-6', null]);
    expect(rowInputs().map((el) => el.value)).toEqual(['', '', '8']);
    expect(summary(0)).toBe('3 × 4-6/4-6/8');
  });

  it('Sets 3 → 4 pre-fills Set 4 with 4-6 verbatim, held', () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    type(screen.getByLabelText('Sets') as HTMLInputElement, '4');
    expect(rowHeld()).toEqual(['4-6', '4-6', '4-6', '4-6']);
  });

  it('Save untouched writes each set\'s stored text; the summaries read 3 × 4-6 and 3 × 4-6/4-6/8', async () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6']), rowBB(['4-6', '4-6', '8'])]);
    expect(summary(0)).toBe('3 × 4-6');
    expect(summary(1)).toBe('3 × 4-6/4-6/8');
    fireEvent.click(screen.getByText('Save Workout'));
    await Promise.resolve();
    expect(savedReps()).toEqual([['4-6', '4-6', '4-6'], ['4-6', '4-6', '8']]);
  });

  it('refused edits leave the held rows and the save unchanged; Back does not ask', async () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    type(rowInputs()[0], '-');
    type(allInput(), '0');
    expect(rowHeld()).toEqual(['4-6', '4-6', '4-6']);
    fireEvent.click(screen.getByLabelText('Back'));
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Save Workout'));
    await Promise.resolve();
    expect(savedReps()).toEqual([['4-6', '4-6', '4-6']]);
  });

  it('more than 20 stored sets of held text keep their count and text (#375 caveat)', async () => {
    const reps = Array(22).fill('4-6');
    openPlanner([{ ...rowBB(reps), max_sets: 22 }]);
    expect(rowHeld()).toHaveLength(22);
    fireEvent.click(screen.getByText('Save Workout'));
    await Promise.resolve();
    expect(savedReps()).toEqual([reps]);
  });

  it('every Reps input in the planner is the same text field', () => {
    openPlanner([rowBB(['4-6', '4-6', '8'])]);
    for (const el of [allInput(), ...rowInputs()]) {
      expect(el.type).toBe('text');
      expect(el.getAttribute('inputmode')).toBe('numeric');
      expect(el.maxLength).toBe(3);
    }
  });
});

// ── AC5 ────────────────────────────────────────────────────────────

describe('AC5: accessibility', () => {
  it('held text is described in full; a plain field says whole number only', () => {
    openTemplate(T.bench);
    expect(description(repsInput())).toBe('Planned: 4-6. Whole number only: type one to replace it, or press Clear.');
    cleanup();
    openTemplate(T.row);
    expect(description(repsInput())).toBe('Whole number only.');
  });

  it('a per-set row reads "Planned 4-6. …"', () => {
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    expect(description(rowInputs()[0])).toBe('Planned 4-6. Whole number only: type one to replace it, or press Clear.');
  });

  it('a held Planned line and Varies never both describe "Reps, all sets"', () => {
    openPlanner([rowBB(['4-6', '4-6', '8'])]);
    expect(description(allInput())).toBe('Sets differ. A value here replaces every set. Whole number only.');
  });

  it('Clear is a button named for what it clears and where', () => {
    openTemplate(T.bench);
    expect(clears()[0].getAttribute('type')).toBe('button');
    expect(clears()[0].getAttribute('aria-label')).toBe('Clear reps 4-6, Bench Press');
    cleanup();
    openPlanner([rowBB(['4-6', '4-6', '4-6'])]);
    expect(clears().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Clear reps 4-6, Row BB',
      'Clear set 1 reps 4-6, Row BB',
      'Clear set 2 reps 4-6, Row BB',
      'Clear set 3 reps 4-6, Row BB',
    ]);
  });

  it('the template editor\'s Sets and Reps labels are tied by for/id, unique per open panel', () => {
    openTemplate(T.bench);
    const sets = screen.getByLabelText('Sets') as HTMLInputElement;
    expect(document.querySelector(`label[for="${sets.id}"]`)!.textContent).toBe('Sets');
    expect(document.querySelector(`label[for="${repsInput().id}"]`)!.textContent).toBe('Reps');
    const first = [sets.id, repsInput().id];
    fireEvent.click(cards()[T.bench]);
    fireEvent.click(cards()[T.row]);
    const second = [(screen.getByLabelText('Sets') as HTMLInputElement).id, repsInput().id];
    expect(new Set([...first, ...second]).size).toBe(4);
  });
});

// ── AC7 ────────────────────────────────────────────────────────────

describe('AC7: demo mode holds a range in a template row and a planned entry', () => {
  it('a template row', () => {
    expect(DEMO_TEMPLATE_ROWS.some((r) => r.section !== 'warmup' && /^\d+-\d+$/.test(r.reps))).toBe(true);
  });
  it('a planned workout\'s entry', () => {
    const planned = new Set(DEMO_WORKOUTS.filter((w) => w.status === 'planned').map((w) => w.id));
    expect(DEMO_SETS.some((s) => planned.has(s.workout_id) && /^\d+-\d+$/.test(s.planned_reps))).toBe(true);
  });
});
