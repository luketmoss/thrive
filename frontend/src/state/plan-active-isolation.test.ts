// #351: saving a plan must not touch the active workout's in-memory state,
// and starting a workout sets it from that workout alone. Drives the REAL
// actions.ts + workouts-api.ts through an in-memory `../api/sheets` (live),
// and through demo mode, where the plan's rows are added to `sets` locally.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  workouts, sets, templates, toasts,
  activeWorkoutId, activeWorkoutSets, activeWarmupExercises, isEditMode,
} from './store';
import type { SetWithRow, Template, BuilderExercise } from '../api/types';

let sheet: { Workouts: string[][]; Sets: string[][] };
let demo = false;

const colIndex = (letters: string) =>
  [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

function parseRange(range: string) {
  const [tab, cells] = range.split('!');
  const m = cells.match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/);
  if (!m) throw new Error(`Unsupported range: ${range}`);
  const [, colStart, rowStart, colEnd, rowEnd] = m;
  return {
    tab: tab as keyof typeof sheet,
    colStart: colIndex(colStart),
    colEnd: colIndex(colEnd),
    rowStart: rowStart ? Number(rowStart) : null,
    rowEnd: rowEnd ? Number(rowEnd) : null,
  };
}

vi.mock('../api/sheets', () => ({
  SheetsApiError: class extends Error { status = 0; },
  withReauth: vi.fn(async (token: string, fn: (t: string) => Promise<unknown>) => fn(token)),
  sheetsGet: vi.fn(async (range: string) => {
    const { tab, colStart, colEnd, rowStart, rowEnd } = parseRange(range);
    const rows = sheet[tab];
    const out: string[][] = [];
    for (let r = rowStart ?? 2; r <= (rowEnd ?? rows.length + 1); r++) {
      if (rows[r - 2]) out.push(rows[r - 2].slice(colStart, colEnd + 1));
    }
    return out;
  }),
  sheetsUpdate: vi.fn(),
  sheetsAppend: vi.fn(async (range: string, values: string[][]) => {
    const [tab] = range.split('!') as [keyof typeof sheet];
    for (const row of values) sheet[tab].push([...row]);
  }),
  sheetsDeleteRow: vi.fn(),
  getSheetId: vi.fn(async () => 1),
}));

vi.mock('../api/demo-data', () => ({
  isDemo: () => demo,
  DEMO_WORKOUTS: [],
  DEMO_SETS: [],
  shiftDemoWorkouts: (w: unknown) => w,
}));
vi.mock('../auth/reauth', () => ({ attemptReauth: vi.fn(), ReauthFailedError: class extends Error {} }));

const { saveWorkoutForLater, startWorkout } = await import('./actions');

const TOKEN = 'test-token';

const PUSH: Template = {
  id: 'tpl_push',
  name: 'Upper Push A',
  exercises: [
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 1, exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', section: 'warmup', sets: '', reps: '', sheetRow: 2 },
    { template_id: 'tpl_push', template_name: 'Upper Push A', order: 2, exercise_id: 'ex_bp', exercise_name: 'Bench Press BB', section: 'primary', sets: '3', reps: '8', sheetRow: 3 },
  ],
};

const WARMUP_EX: BuilderExercise = { exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', section: 'warmup', sets: 1, planned_reps: '' };
const MAIN_EX: BuilderExercise = { exercise_id: 'ex_bp', exercise_name: 'Bench Press BB', section: 'primary', sets: 3, planned_reps: '8' };

const A_SETS: SetWithRow[] = [
  { workout_id: 'w_a', exercise_id: 'ex_sq', exercise_name: 'Squat', section: 'primary', exercise_order: 1, set_number: 1, planned_reps: '5', weight: '225', reps: '5', effort: 'Hard', sheetRow: 2 },
];
const A_WARMUPS = [{ exercise_id: 'ex_hip', exercise_name: 'Hip Circles', exercise_order: 0 }];

const PLANS: [string, { template_id?: string; exercises?: BuilderExercise[] }][] = [
  ['exercises including a warmup', { exercises: [WARMUP_EX, MAIN_EX] }],
  ['exercises and no warmup', { exercises: [MAIN_EX] }],
  ['no exercises', {}],
  ['a template_id', { template_id: 'tpl_push' }],
];

function planRows() {
  return sets.value.filter((s) => s.workout_id !== 'w_a');
}

describe.each([['live', false], ['demo', true]])('#351 (%s)', (_mode, isDemoMode) => {
  beforeEach(() => {
    demo = isDemoMode;
    sheet = {
      Workouts: [],
      Sets: [['w_a', 'ex_sq', 'Squat', 'primary', '1', '1', '5', '225', '5', 'Hard']],
    };
    workouts.value = [];
    sets.value = [...A_SETS];
    templates.value = [PUSH];
    toasts.value = [];
    activeWorkoutId.value = null;
    activeWorkoutSets.value = [];
    activeWarmupExercises.value = [];
    isEditMode.value = false;
  });

  describe('AC1: planning a workout leaves active-workout state alone', () => {
    describe.each([false, true])('isEditMode %s', (editMode) => {
      it.each(PLANS)('with %s', async (_label, plan) => {
        const activeSets = A_SETS;
        const activeWarmups = [...A_WARMUPS];
        activeWorkoutId.value = 'w_a';
        activeWorkoutSets.value = activeSets;
        activeWarmupExercises.value = activeWarmups;
        isEditMode.value = editMode;

        await saveWorkoutForLater({ type: 'weight', name: 'Plan', date: '2099-12-31', ...plan }, TOKEN);

        expect(activeWorkoutId.value).toBe('w_a');
        expect(activeWorkoutSets.value).toBe(activeSets);
        expect(activeWarmupExercises.value).toBe(activeWarmups);
        expect(isEditMode.value).toBe(editMode);

        // The plan is still created as today.
        const planId = workouts.value[0].id;
        expect(workouts.value[0].status).toBe('planned');
        const rows = planRows();
        expect(rows.every((s) => s.workout_id === planId)).toBe(true);
        const hasExercises = !!plan.template_id || (plan.exercises?.length ?? 0) > 0;
        expect(rows.length > 0).toBe(hasExercises);
        if (plan.template_id || plan.exercises?.includes(WARMUP_EX)) {
          expect(rows.filter((s) => s.section === 'warmup')).toHaveLength(1);
        }
        expect(rows.every((s) => typeof s.sheetRow === 'number' && s.sheetRow >= 2)).toBe(true);
        expect(toasts.value.map((t) => t.text)).toContain('Workout saved for later');
      });
    });

    it.each(PLANS)('with no workout active, %s leaves the signals empty', async (_label, plan) => {
      await saveWorkoutForLater({ type: 'weight', name: 'Plan', date: '2099-12-31', ...plan }, TOKEN);
      expect(activeWorkoutId.value).toBeNull();
      expect(activeWorkoutSets.value).toEqual([]);
      expect(activeWarmupExercises.value).toEqual([]);
    });
  });

  describe('AC2: starting a workout sets the active state, and only that', () => {
    beforeEach(() => {
      activeWarmupExercises.value = [...A_WARMUPS];
    });

    it('from a template: its rows and the template warmups', async () => {
      const id = await startWorkout({ type: 'weight', name: 'Upper Push A', template_id: 'tpl_push' }, TOKEN);
      expect(activeWorkoutSets.value.map((s) => s.workout_id)).toEqual(Array(4).fill(id));
      expect(activeWarmupExercises.value).toEqual([{ exercise_id: 'ex_wu', exercise_name: 'Band Pull-Apart', exercise_order: 1 }]);
    });

    it('from builder exercises: its rows and the builder warmups', async () => {
      const id = await startWorkout({ type: 'weight', name: 'Custom', exercises: [WARMUP_EX, MAIN_EX] }, TOKEN);
      expect(activeWorkoutSets.value).toHaveLength(4);
      expect(activeWorkoutSets.value.every((s) => s.workout_id === id)).toBe(true);
      expect(activeWarmupExercises.value.map((w) => w.exercise_id)).toEqual(['ex_wu']);
    });

    it('empty: both signals are []', async () => {
      await startWorkout({ type: 'weight', name: 'Empty' }, TOKEN);
      expect(activeWorkoutSets.value).toEqual([]);
      expect(activeWarmupExercises.value).toEqual([]);
    });

    it('with a template_id that names no loaded template: both signals are []', async () => {
      await startWorkout({ type: 'weight', name: 'Gone', template_id: 'tpl_deleted' }, TOKEN);
      expect(activeWorkoutSets.value).toEqual([]);
      expect(activeWarmupExercises.value).toEqual([]);
    });
  });
});
