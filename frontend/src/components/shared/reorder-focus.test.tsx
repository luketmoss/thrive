// #328 — after Move up/down in the template editor and the workout planner,
// focus stays on the moved exercise's button, ends are aria-disabled, each
// move is announced, and the open panel travels with its row. Both lists hold
// "Row BB" twice, so rows must be told apart by more than exercise_id.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { templates } from '../../state/store';
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

const LIST: [string, string, string][] = [
  ['e1', 'Row BB', 'warmup'],
  ['e2', 'Pull-up', 'primary'],
  ['e1', 'Row BB', 'SS1'],
  ['e3', 'Curl', 'burnout'],
];

beforeEach(() => {
  templates.value = [
    {
      id: 't1',
      name: 'Upper Pull A',
      exercises: LIST.map(([exercise_id, exercise_name, section], i) => ({
        template_id: 't1', template_name: 'Upper Pull A', order: i + 1,
        exercise_id, exercise_name, section, sets: '3', reps: '8', sheetRow: i + 2,
      })),
    },
  ];
  editTemplate.mockClear();
});
afterEach(() => cleanup());

const plannerExercises = (): PlannerExercise[] =>
  LIST.map(([exercise_id, exercise_name, section]) => ({ exercise_id, exercise_name, section, sets: '3', reps_by_set: ['8', '8', '8'] }));

const onSave = vi.fn(async (..._args: unknown[]) => undefined);

const screens: [string, () => void][] = [
  ['template editor', () => render(<TemplateEditor templateId="t1" />)],
  [
    'workout planner',
    () =>
      render(
        <WorkoutPlanner initialName="Plan" initialExercises={plannerExercises()} onSave={onSave} onDiscard={() => {}} saving={false} />,
      ),
  ],
];

const rows = () => [...document.querySelectorAll<HTMLElement>('.compact-card-list > [data-row-key]')];
const badges = () => rows().map((r) => r.querySelector('.compact-card-top span')!.textContent);
const moveBtn = (row: number, dir: 'up' | 'down') =>
  rows()[row].querySelector<HTMLButtonElement>(`[data-move="${dir}"]`)!;
const status = () => document.querySelector('[role="status"]')!;

describe.each(screens)('%s', (_name, mount) => {
  it('AC3: a polite status region is present and empty before any move', () => {
    mount();
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(status().textContent).toBe('');
  });

  it('AC1: focus follows the moved duplicate, and pressing again moves it again', () => {
    mount();
    // The second "Row BB" (SS1), third of four.
    moveBtn(2, 'up').focus();
    fireEvent.click(moveBtn(2, 'up'));
    expect(badges()).toEqual(['warmup', 'SS1', 'primary', 'burnout']);
    expect(document.activeElement).toBe(moveBtn(1, 'up'));
    expect(status().textContent).toBe('Row BB moved to position 2 of 4');

    fireEvent.click(document.activeElement as HTMLElement);
    expect(badges()).toEqual(['SS1', 'warmup', 'primary', 'burnout']);
    expect(document.activeElement).toBe(moveBtn(0, 'up'));
    expect(status().textContent).toBe('Row BB moved to position 1 of 4');
  });

  it('AC1: Move down keeps focus on the down button of the moved row', () => {
    mount();
    moveBtn(0, 'down').focus();
    fireEvent.click(moveBtn(0, 'down'));
    expect(badges()).toEqual(['primary', 'warmup', 'SS1', 'burnout']);
    expect(document.activeElement).toBe(moveBtn(1, 'down'));
    expect(status().textContent).toBe('Row BB moved to position 2 of 4');
  });

  it('AC2: reaching an end keeps focus on the now aria-disabled button, which does nothing', () => {
    mount();
    moveBtn(1, 'up').focus();
    fireEvent.click(moveBtn(1, 'up'));
    const btn = moveBtn(0, 'up');
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Move Pull-up up');
    expect(moveBtn(0, 'down').hasAttribute('aria-disabled')).toBe(false);

    fireEvent.click(btn);
    expect(badges()).toEqual(['primary', 'warmup', 'SS1', 'burnout']);
    expect(document.activeElement).toBe(btn);
    expect(status().textContent).toBe('Pull-up moved to position 1 of 4');
  });

  it('AC4: the open panel and its typed values travel with the moved row', () => {
    mount();
    // Open the second "Row BB" and type a new Sets value.
    fireEvent.click(rows()[2].querySelector('.compact-card-body')!);
    const sets = () => document.querySelector<HTMLInputElement>('.template-exercise-config input[type="number"]')!;
    fireEvent.input(sets(), { target: { value: '5' } });

    fireEvent.click(moveBtn(2, 'down'));
    expect(badges()).toEqual(['warmup', 'primary', 'burnout', 'SS1']);
    const panelRow = sets().closest('[data-row-key]');
    expect(panelRow).toBe(rows()[3]);
    expect(sets().value).toBe('5');

    // Moving its neighbour leaves the panel on the same exercise.
    fireEvent.click(moveBtn(2, 'down'));
    expect(badges()).toEqual(['warmup', 'primary', 'SS1', 'burnout']);
    expect(sets().closest('[data-row-key]')).toBe(rows()[2]);
    expect(rows()[2].textContent).toContain('5 × 8');
  });
});

describe('saved order is the displayed order, with no row key in it', () => {
  it('template editor', async () => {
    render(<TemplateEditor templateId="t1" />);
    fireEvent.click(moveBtn(2, 'up'));
    fireEvent.click(document.querySelector('.btn-primary')!);
    await vi.waitFor(() => expect(editTemplate).toHaveBeenCalled());
    const inputs = editTemplate.mock.calls[0][2] as Record<string, unknown>[];
    expect(inputs.map((x) => x.section)).toEqual(['warmup', 'SS1', 'primary', 'burnout']);
    for (const x of inputs) expect(Object.keys(x).sort()).toEqual(['exercise_id', 'exercise_name', 'reps', 'section', 'sets']);
  });

  it('workout planner', async () => {
    onSave.mockClear();
    render(<WorkoutPlanner initialName="Plan" initialExercises={plannerExercises()} onSave={onSave} onDiscard={() => {}} saving={false} />);
    fireEvent.click(moveBtn(2, 'up'));
    fireEvent.click(document.querySelector('.btn-primary')!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][1] as Record<string, unknown>[];
    expect(saved.map((x) => x.section)).toEqual(['warmup', 'SS1', 'primary', 'burnout']);
    for (const x of saved) expect(Object.keys(x).sort()).toEqual(['exercise_id', 'exercise_name', 'reps_by_set', 'section', 'sets']);
  });
});
