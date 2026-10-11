// #375 — planned reps per set in the workout planner: a row per set in the
// planned-workout editor and the new-plan planner, a "Reps, all sets" field,
// and a `3 × 10/8/6` summary. Drives the real WorkoutFlow, WorkoutPlanner,
// WorkoutEdit and WorkoutDetail; only the actions that write are mocked.
// The sheet-level save (what lands in `Sets`) is covered against the real
// actions in activities/planned-save-in-place.test.tsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { h } from 'preact';
import { templates, workouts, sets, exercises, labels } from '../../state/store';
import type { WorkoutWithRow, SetWithRow } from '../../api/types';
import { plannedSetCount, repsSummary, REPS_INPUT_PROPS, MAX_PLANNED_SETS } from './planned-reps';
import { WorkoutPlanner, type PlannerExercise } from './workout-planner';

const saveWorkoutForLater = vi.fn(async (_data: unknown, _token: string) => undefined);
const savePlannedWorkoutEdits = vi.fn(async (_id: string, _patch: unknown, _exercises: unknown, _token: string) => undefined);

vi.mock('../../state/actions', () => ({
  startWorkout: vi.fn(),
  saveWorkoutForLater: (data: unknown, token: string) => saveWorkoutForLater(data, token),
  deleteWorkout: vi.fn(),
  savePlannedWorkoutEdits: (id: string, patch: unknown, exercises: unknown, token: string) =>
    savePlannedWorkoutEdits(id, patch, exercises, token),
  enterEditMode: vi.fn(),
  exitEditMode: vi.fn(),
  startPlannedWorkout: vi.fn(),
  copyWorkout: vi.fn(),
  saveWorkoutAsTemplate: vi.fn(),
  addExercise: vi.fn(),
}));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../router/router', () => ({ navigate: vi.fn(), goBack: vi.fn() }));
vi.mock('./workout-tracker', () => ({
  WorkoutTracker: ({ workoutId }: { workoutId: string }) => h('div', { 'data-testid': 'tracker' }, workoutId),
}));

const { WorkoutFlow } = await import('./workout-flow');
const { WorkoutEdit } = await import('../activities/workout-edit');
const { WorkoutDetail } = await import('../activities/workout-detail');

// ── Fixtures and helpers ───────────────────────────────────────────

function planned(): WorkoutWithRow {
  return {
    id: 'w_plan', date: '2099-12-31', time: '', type: 'weight', name: 'Upper Push A', template_id: '',
    notes: '', elapsed_seconds: '', created: '', copied_from: '', status: 'planned', moving_seconds: '',
    effort: '', distance_m: '', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '',
    source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '',
    started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 2,
  };
}

let row = 1;
function planSets(id: string, name: string, section: string, order: number, reps: string[]): SetWithRow[] {
  return reps.map((planned_reps, i) => ({
    workout_id: 'w_plan', exercise_id: id, exercise_name: name, section, exercise_order: order,
    set_number: i + 1, planned_reps, weight: '', reps: '', effort: '', sheetRow: ++row,
  }));
}

/** Warmup, Bench 10/8/6, Row 8/8/8, Curl 10/blank/6, Plank all blank, Squat 4-6 ×3. */
function PLAN(): SetWithRow[] {
  row = 1;
  return [
    ...planSets('ex_warm', 'Arm Circles', 'warmup', 1, ['']),
    ...planSets('ex_bench', 'Bench Press', 'primary', 2, ['10', '8', '6']),
    ...planSets('ex_row', 'Row BB', 'SS1', 3, ['8', '8', '8']),
    ...planSets('ex_curl', 'Curl DB', 'SS2', 4, ['10', '', '6']),
    ...planSets('ex_plank', 'Plank', 'burnout', 5, ['', '', '']),
    ...planSets('ex_squat', 'Squat BB', 'primary', 6, ['4-6', '4-6', '4-6']),
  ];
}
const ENTRY = { warm: 0, bench: 1, row: 2, curl: 3, plank: 4, squat: 5 } as const;

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.compact-card-body'));
const meta = (i: number) => cards()[i].querySelector('.compact-card-meta');
const visual = (i: number) => {
  const m = meta(i);
  if (!m) return null;
  const hidden = m.querySelector('[aria-hidden="true"]');
  return (hidden ?? m).textContent;
};
const spoken = (i: number) => meta(i)?.querySelector('.sr-only')?.textContent ?? null;

const panel = () => document.querySelector<HTMLElement>('.planner-exercise-config');
const setsInput = () => screen.getByLabelText('Sets') as HTMLInputElement;
const allInput = () => screen.getByLabelText('Reps, all sets') as HTMLInputElement;
const rowInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('.planner-set-row input'));
const rowValues = () => rowInputs().map((el) => el.value);
const rowLabels = () => Array.from(document.querySelectorAll<HTMLLabelElement>('.planner-set-row label')).map((l) => l.textContent);
const type = (el: HTMLInputElement, value: string) => fireEvent.input(el, { target: { value } });

function button(text: string): HTMLElement {
  const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`No button "${text}"`);
  return el as HTMLElement;
}
async function tap(text: string) {
  fireEvent.click(button(text));
  await Promise.resolve();
  await Promise.resolve();
}

function openEditor(i: number) {
  render(<WorkoutEdit workoutId="w_plan" />);
  fireEvent.click(cards()[i]);
}

/** The entries the editor sent on Save. */
async function savedEditorEntries() {
  await tap('Save Workout');
  expect(savePlannedWorkoutEdits).toHaveBeenCalledTimes(1);
  return savePlannedWorkoutEdits.mock.calls[0][2] as { exercise_id: string; sets: number; planned_reps_by_set?: string[] }[];
}
const benchSaved = async () => (await savedEditorEntries()).find((e) => e.exercise_id === 'ex_bench')!;

beforeEach(() => {
  vi.clearAllMocks();
  workouts.value = [planned()];
  sets.value = PLAN();
  templates.value = [];
  labels.value = [];
});
afterEach(() => {
  cleanup();
  workouts.value = [];
  sets.value = [];
  templates.value = [];
  exercises.value = [];
});

// ── Helpers ────────────────────────────────────────────────────────

describe('plannedSetCount: one rule for the rows and the save', () => {
  it.each([
    ['3', 3], ['', 1], ['0', 1], ['-1', 1], ['abc', 1], ['2.9', 2], ['0.5', 1], ['20', 20], ['21', 20], ['999', 20],
  ])('%j → %i', (typed, n) => {
    expect(plannedSetCount(typed)).toBe(n);
  });
  it('caps at the Sets input\'s own max', () => {
    expect(MAX_PLANNED_SETS).toBe(20);
  });
});

describe('repsSummary', () => {
  it.each([
    [['10', '8', '6'], '3 × 10/8/6', '3 sets: 10, 8, 6 reps'],
    [['8', '8', '8'], '3 × 8', '3 sets of 8 reps'],
    [['10', '', '6'], '3 × 10/—/6', '3 sets: 10, blank, 6 reps'],
    [['', '', ''], '3 sets', '3 sets'],
    [['4-6', '4-6'], '2 × 4-6', '2 sets of 4-6 reps'],
    [['12'], '1 × 12', '1 set of 12 reps'],
    [[], '', ''],
  ])('%j', (held, v, s) => {
    expect(repsSummary(held)).toEqual({ visual: v, spoken: s });
  });
});

// ── AC1 ────────────────────────────────────────────────────────────

describe('AC1: the editor shows each set\'s planned reps', () => {
  it('a varied entry: a "Reps per set" group, one row per set in order, "Reps, all sets" blank with Varies', () => {
    openEditor(ENTRY.bench);
    expect(setsInput().value).toBe('3');
    const legend = panel()!.querySelector('fieldset legend')!;
    expect(legend.textContent).toBe('Reps per set, Bench Press');
    expect(rowLabels()).toEqual(['Set 1', 'Set 2', 'Set 3']);
    expect(rowValues()).toEqual(['10', '8', '6']);
    expect(allInput().value).toBe('');
    expect(allInput().placeholder).toBe('Varies');
  });

  it('the collapsed summary reads 3 × 10/8/6, with a spoken form', () => {
    render(<WorkoutEdit workoutId="w_plan" />);
    expect(visual(ENTRY.bench)).toBe('3 × 10/8/6');
    expect(spoken(ENTRY.bench)).toBe('3 sets: 10, 8, 6 reps');
    expect(meta(ENTRY.bench)!.querySelector('[aria-hidden="true"]')!.textContent).toBe('3 × 10/8/6');
  });

  it('a uniform entry: "Reps, all sets" shows 8 and the summary reads 3 × 8, as today', () => {
    openEditor(ENTRY.row);
    expect(allInput().value).toBe('8');
    expect(allInput().placeholder).not.toBe('Varies');
    expect(rowValues()).toEqual(['8', '8', '8']);
    expect(visual(ENTRY.row)).toBe('3 × 8');
  });

  it('a blank set shows as — in the summary; every set blank reads 3 sets', () => {
    render(<WorkoutEdit workoutId="w_plan" />);
    expect(visual(ENTRY.curl)).toBe('3 × 10/—/6');
    expect(visual(ENTRY.plank)).toBe('3 sets');
  });

  it('a warmup shows no "Reps per set" group and no summary', () => {
    openEditor(ENTRY.warm);
    expect(panel()!.querySelector('fieldset')).toBeNull();
    expect(rowInputs()).toHaveLength(0);
    expect(meta(ENTRY.warm)).toBeNull();
  });

  it('the planned workout\'s detail view reads the same summaries', () => {
    render(<WorkoutDetail workoutId="w_plan" />);
    const metas = Array.from(document.querySelectorAll('.compact-card-meta'));
    const texts = metas.map((m) => (m.querySelector('[aria-hidden="true"]') ?? m).textContent);
    expect(texts).toEqual(['3 × 10/8/6', '3 × 8', '3 × 10/—/6', '3 sets', '3 × 4-6']);
    expect(metas[0].querySelector('.sr-only')!.textContent).toBe('3 sets: 10, 8, 6 reps');
  });
});

// ── AC2 ────────────────────────────────────────────────────────────

describe('AC2: editing a set, all sets, and Save', () => {
  it('changing Set 2 changes only set 2, and the summary follows', async () => {
    openEditor(ENTRY.bench);
    type(rowInputs()[1], '9');
    expect(rowValues()).toEqual(['10', '9', '6']);
    expect(visual(ENTRY.bench)).toBe('3 × 10/9/6');
    expect((await benchSaved()).planned_reps_by_set).toEqual(['10', '9', '6']);
  });

  it('typing 10 into "Reps, all sets" fills every row and flattens the summary', async () => {
    openEditor(ENTRY.bench);
    type(allInput(), '10');
    expect(rowValues()).toEqual(['10', '10', '10']);
    expect(allInput().value).toBe('10');
    expect(allInput().placeholder).not.toBe('Varies');
    expect(visual(ENTRY.bench)).toBe('3 × 10');
    expect((await benchSaved()).planned_reps_by_set).toEqual(['10', '10', '10']);
  });

  it('clearing "Reps, all sets" clears every row', async () => {
    openEditor(ENTRY.row);
    type(allInput(), '');
    expect(rowValues()).toEqual(['', '', '']);
    expect(visual(ENTRY.row)).toBe('3 sets');
  });

  it('Save sends each set exactly as held: untouched entries their stored text, ranges included', async () => {
    openEditor(ENTRY.bench);
    const saved = await savedEditorEntries();
    expect(saved.map((e) => [e.exercise_id, e.sets, e.planned_reps_by_set])).toEqual([
      ['ex_warm', 1, undefined],
      ['ex_bench', 3, ['10', '8', '6']],
      ['ex_row', 3, ['8', '8', '8']],
      ['ex_curl', 3, ['10', '', '6']],
      ['ex_plank', 3, ['', '', '']],
      ['ex_squat', 3, ['4-6', '4-6', '4-6']],
    ]);
  });
});

// ── AC3 ────────────────────────────────────────────────────────────

describe('AC3: changing the Sets count', () => {
  it('4 adds a Set 4 row pre-filled from the row above', () => {
    openEditor(ENTRY.bench);
    type(setsInput(), '4');
    expect(rowLabels()).toEqual(['Set 1', 'Set 2', 'Set 3', 'Set 4']);
    expect(rowValues()).toEqual(['10', '8', '6', '6']);
  });

  it('2 removes the Set 3 row and saves 2 sets', async () => {
    openEditor(ENTRY.bench);
    type(setsInput(), '2');
    expect(rowValues()).toEqual(['10', '8']);
    expect(visual(ENTRY.bench)).toBe('2 × 10/8');
    const bench = await benchSaved();
    expect(bench.sets).toBe(2);
    expect(bench.planned_reps_by_set).toEqual(['10', '8']);
  });

  it('values are remembered while the editor is open: 4 → 2 → 3 restores Set 3 as 6', () => {
    openEditor(ENTRY.bench);
    type(rowInputs()[2], '5');
    type(setsInput(), '4');
    type(rowInputs()[3], '3');
    type(setsInput(), '2');
    type(setsInput(), '3');
    expect(rowValues()).toEqual(['10', '8', '5']);
    type(setsInput(), '4');
    expect(rowValues()).toEqual(['10', '8', '5', '3']);
  });

  it('clearing Sets to retype it loses nothing', () => {
    openEditor(ENTRY.bench);
    type(setsInput(), '');
    expect(rowValues()).toEqual(['10']);
    type(setsInput(), '3');
    expect(rowValues()).toEqual(['10', '8', '6']);
  });

  it('positions never shown are pre-filled from the row above', () => {
    openEditor(ENTRY.bench);
    type(setsInput(), '5');
    expect(rowValues()).toEqual(['10', '8', '6', '6', '6']);
  });

  it('a blank set above pre-fills a new row blank', () => {
    openEditor(ENTRY.plank);
    type(setsInput(), '4');
    expect(rowValues()).toEqual(['', '', '', '']);
  });

  it.each([
    ['', 1], ['0', 1], ['2.7', 2], ['25', 20],
  ])('Sets %j shows and saves %i rows', async (typed, n) => {
    openEditor(ENTRY.row);
    type(setsInput(), typed);
    expect(rowInputs()).toHaveLength(n);
    const saved = (await savedEditorEntries()).find((e) => e.exercise_id === 'ex_row')!;
    expect(saved.sets).toBe(n);
    expect(saved.planned_reps_by_set).toEqual(Array(n).fill('8'));
  });

  it('warmup hides the rows (nothing saved for them); back again shows their values', async () => {
    openEditor(ENTRY.bench);
    const pill = (text: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('.section-picker-row button')).find((b) => b.textContent === text)!;
    fireEvent.click(pill('warmup'));
    expect(rowInputs()).toHaveLength(0);
    expect(meta(ENTRY.bench)).toBeNull();
    fireEvent.click(pill('primary'));
    expect(rowValues()).toEqual(['10', '8', '6']);
    fireEvent.click(pill('warmup'));
    const bench = await benchSaved();
    expect(bench).not.toHaveProperty('planned_reps_by_set');
  });
});

// ── AC4 ────────────────────────────────────────────────────────────

describe('AC4: the new-plan planner behaves the same', () => {
  const PUSH = {
    id: 'tpl_push',
    name: 'Upper Push A',
    exercises: [
      { template_id: 'tpl_push', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_w', exercise_name: 'Arm Circles', section: 'warmup', sets: '', reps: '', sheetRow: 2 },
      { template_id: 'tpl_push', template_name: 'Upper Push A', order: 2, exercise_id: 'ex_1', exercise_name: 'Bench Press BB', section: 'primary', sets: '3', reps: '8', sheetRow: 3 },
    ],
  };
  beforeEach(() => {
    templates.value = [PUSH];
  });
  const saved = () =>
    (saveWorkoutForLater.mock.calls[0][0] as { exercises: { exercise_id: string; sets: number; planned_reps_by_set?: string[] }[] }).exercises;

  it('a template row with Sets 3, Reps 8 shows three rows reading 8; Save writes each set\'s own value', async () => {
    render(<WorkoutFlow planDate="2099-12-31" />);
    await tap('Upper Push A');
    expect(visual(1)).toBe('3 × 8');
    fireEvent.click(cards()[1]);
    expect(rowValues()).toEqual(['8', '8', '8']);
    expect(allInput().value).toBe('8');
    type(rowInputs()[2], '6');
    type(setsInput(), '4');
    expect(rowValues()).toEqual(['8', '8', '6', '6']);
    expect(visual(1)).toBe('4 × 8/8/6/6');
    await tap('Save Workout');
    expect(saved().map((e) => [e.exercise_id, e.sets, e.planned_reps_by_set])).toEqual([
      ['ex_w', 1, undefined],
      ['ex_1', 4, ['8', '8', '6', '6']],
    ]);
  });

  it('an untouched template plan saves the template\'s Reps on every set, as today', async () => {
    render(<WorkoutFlow planDate="2099-12-31" />);
    await tap('Upper Push A');
    await tap('Save Workout');
    expect(saved()[1]).toMatchObject({ sets: 3, planned_reps: '8', planned_reps_by_set: ['8', '8', '8'] });
  });

  it('an exercise added in the planner starts with Sets 1 and one blank Set 1 row', async () => {
    exercises.value = [{ id: 'ex_new', name: 'Dips', tags: '', notes: '', created: '', sheetRow: 2 }];
    render(<WorkoutFlow planDate="2099-12-31" />);
    await tap('Build Custom');
    await tap('+ Add Exercise');
    fireEvent.click(document.querySelector<HTMLElement>('.exercise-list > .exercise-list-item')!);
    await Promise.resolve();
    expect(setsInput().value).toBe('1');
    expect(rowLabels()).toEqual(['Set 1']);
    expect(rowValues()).toEqual(['']);
    expect(visual(0)).toBe('1 sets');
  });
});

// ── AC5 ────────────────────────────────────────────────────────────

describe('AC5: accessibility', () => {
  it('each row\'s input has its own visible "Set n" label, tied by for/id', () => {
    openEditor(ENTRY.bench);
    for (const [i, el] of rowInputs().entries()) {
      expect(screen.getAllByLabelText(`Set ${i + 1}`)).toContain(el);
      expect(el.id).toBeTruthy();
    }
  });

  it('two entries for the same exercise never share an id', () => {
    const twin: PlannerExercise[] = [
      { exercise_id: 'ex_b', exercise_name: 'Bench', section: 'primary', sets: '2', reps_by_set: ['5', '5'] },
      { exercise_id: 'ex_b', exercise_name: 'Bench', section: 'primary', sets: '2', reps_by_set: ['8', '8'] },
    ];
    render(<WorkoutPlanner initialExercises={twin} onSave={async () => {}} onDiscard={() => {}} saving={false} />);
    fireEvent.click(cards()[0]);
    const first = [setsInput().id, allInput().id, ...rowInputs().map((el) => el.id)];
    fireEvent.click(cards()[0]);
    fireEvent.click(cards()[1]);
    const second = [setsInput().id, allInput().id, ...rowInputs().map((el) => el.id)];
    expect(new Set([...first, ...second]).size).toBe(first.length + second.length);
  });

  it('Sets and "Reps, all sets" are labelled by for/id', () => {
    openEditor(ENTRY.bench);
    expect(document.querySelector(`label[for="${setsInput().id}"]`)!.textContent).toBe('Sets');
    expect(document.querySelector(`label[for="${allInput().id}"]`)!.textContent).toBe('Reps, all sets');
  });

  it('the Varies hint is described only when the held values differ', () => {
    openEditor(ENTRY.bench);
    const hintId = allInput().getAttribute('aria-describedby')!;
    expect(document.getElementById(hintId)!.textContent).toBe('Sets differ. A value here replaces every set.');
    type(allInput(), '9');
    expect(allInput().hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById(hintId)).toBeNull();
  });

  it('judged on the stored text: three sets of 4-6 are not "varied"', () => {
    openEditor(ENTRY.squat);
    expect(allInput().placeholder).not.toBe('Varies');
    expect(allInput().hasAttribute('aria-describedby')).toBe(false);
  });

  it('the expanded card reports aria-expanded', () => {
    render(<WorkoutEdit workoutId="w_plan" />);
    expect(cards()[ENTRY.bench].getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(cards()[ENTRY.bench]);
    expect(cards()[ENTRY.bench].getAttribute('aria-expanded')).toBe('true');
    expect(cards()[ENTRY.row].getAttribute('aria-expanded')).toBe('false');
  });

  it('only the expanded entry shows rows', () => {
    openEditor(ENTRY.bench);
    expect(document.querySelectorAll('.planner-reps-per-set')).toHaveLength(1);
  });

  it('every Reps input shares one input type and inputMode', () => {
    openEditor(ENTRY.bench);
    for (const el of [allInput(), ...rowInputs()]) {
      expect(el.type).toBe(REPS_INPUT_PROPS.type);
      expect(el.getAttribute('inputmode')).toBe(REPS_INPUT_PROPS.inputMode);
    }
  });
});
