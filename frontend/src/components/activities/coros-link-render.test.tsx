// #260 AC7/AC8 — the "View on COROS" link on the workout detail screen,
// rendered: where it sits, what it says, how it opens, and that nothing is
// rendered where there is nothing to link to.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/preact';
import { h } from 'preact';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'tok' }) }));

import { ActivitiesScreen } from './activities-screen';
import { WorkoutDetail } from './workout-detail';
import { workouts, sets, exercises } from '../../state/store';
import type { WorkoutWithRow } from '../../api/types';

function makeWorkout(overrides: Partial<WorkoutWithRow>): WorkoutWithRow {
  return {
    id: 'w1', date: '2026-09-20', time: '08:10', type: 'hike', name: 'Ridge Trail', template_id: '',
    notes: '', elapsed_seconds: '5143', created: '', copied_from: '', status: '', moving_seconds: '',
    effort: '', distance_m: '6512', ascent_m: '', descent_m: '', avg_hr: '', sub_type: '',
    source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '',
    started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 2, ...overrides,
  };
}

const ID = '480640601618940011';
const URL_204 = `https://t.coros.com/activity-detail?labelId=${ID}&sportType=204`;
const synced = makeWorkout({
  id: 'w_s', name: 'MTB', type: 'bike', source: 'coros', source_activity_id: ID, sport_type: '204',
  synced_at: '2026-09-20T18:00:00.000Z', notes: 'Muddy',
});
const enriched = makeWorkout({
  id: 'w_e', name: 'Leg Day', type: 'weight', source_activity_id: '4722', sport_type: '402',
  synced_at: '2026-09-19T15:02:37.000Z', sheetRow: 3,
});

afterEach(() => {
  cleanup();
  workouts.value = [];
  sets.value = [];
  exercises.value = [];
});

function detail(w: WorkoutWithRow) {
  workouts.value = [w];
  render(h(WorkoutDetail, { workoutId: w.id }));
  return document.querySelector<HTMLAnchorElement>('a.detail-coros-link');
}

describe('AC7: the detail screen shows the link', () => {
  it('links a synced row to its portal page, in a new tab, without an opener or referrer', () => {
    const a = detail(synced)!;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe(URL_204);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('links an enriched row too', () => {
    expect(detail(enriched)!.getAttribute('href')).toBe(
      'https://t.coros.com/activity-detail?labelId=4722&sportType=402',
    );
  });

  it('is named "View on COROS (opens in a new tab)", containing the visible label; the glyph is hidden', () => {
    detail(synced);
    const a = screen.getByRole('link', { name: 'View on COROS (opens in a new tab)' });
    expect(a.querySelector('.sr-only')!.textContent).toBe('(opens in a new tab)');
    const svg = a.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    const visible = [...a.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    expect(visible.trim()).toBe('View on COROS');
  });

  it('sits on its own row directly after the provenance line and before the notes', () => {
    const a = detail(synced)!;
    expect(a.parentElement!.classList.contains('detail-provenance')).toBe(false);
    expect(a.previousElementSibling!.classList.contains('detail-provenance')).toBe(true);
    expect(a.nextElementSibling!.classList.contains('detail-notes')).toBe(true);
  });

  it('comes before the Exercises heading on an enriched weight workout', () => {
    workouts.value = [enriched];
    sets.value = [{
      workout_id: 'w_e', exercise_id: 'ex1', exercise_name: 'Squat', section: 'primary',
      exercise_order: 1, set_number: 1, planned_reps: '5', weight: '225', reps: '5', effort: '', sheetRow: 2,
    }];
    render(h(WorkoutDetail, { workoutId: 'w_e' }));
    const a = document.querySelector('a.detail-coros-link')!;
    const heading = [...document.querySelectorAll('h3')].find((x) => x.textContent === 'Exercises')!;
    expect(a.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('AC7: the link\'s CSS', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(resolve(here, '../../global.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  };

  it('is a 44 px inline-flex text link that hugs its text: never a full-width block, no fill, border or margin', () => {
    const r = rule('.detail-coros-link');
    expect(r).toMatch(/display:\s*inline-flex/);
    expect(r).toMatch(/min-height:\s*44px/);
    expect(r).toMatch(/font-size:\s*var\(--text-sm\)/);
    expect(r).toMatch(/color:\s*var\(--color-primary-text\)/);
    expect(r).toMatch(/text-decoration:\s*underline/);
    expect(r).not.toMatch(/display:\s*(block|flex)\b/);
    expect(r).not.toMatch(/width:\s*100%/);
    expect(r).not.toMatch(/background|border|margin/);
  });

  it('has a 2px --color-text focus ring (#320)', () => {
    expect(rule('.detail-coros-link:focus-visible')).toMatch(/outline:\s*2px solid var\(--color-text\)/);
  });
});

describe('AC8: no link, and nothing in its place, where there is nothing to link to', () => {
  const cases: [string, Partial<WorkoutWithRow>][] = [
    ['a manual row', { source: '', source_activity_id: '', sport_type: '' }],
    ['a garmin_import row', { source: 'garmin_import', source_activity_id: ID, sport_type: '204' }],
    ['a planned workout', { source: 'coros', source_activity_id: ID, sport_type: '204', status: 'planned' }],
    ['a blank source_activity_id', { source: 'coros', source_activity_id: '', sport_type: '204' }],
    ['a non-digit source_activity_id', { source: 'coros', source_activity_id: 'demo_act_001', sport_type: '204' }],
    ['a blank sport_type (not yet backfilled)', { source: 'coros', source_activity_id: ID, sport_type: '' }],
  ];
  for (const [what, over] of cases) {
    it(`renders nothing for ${what}`, () => {
      expect(detail(makeWorkout({ id: 'w_x', ...over }))).toBeNull();
      expect(document.body.textContent).not.toMatch(/COROS portal|View on COROS/);
    });
  }

  it('leaves the Activities card a single link to the detail screen, with no nested portal link', () => {
    workouts.value = [synced];
    render(h(ActivitiesScreen, {}));
    expect(document.querySelector('a.detail-coros-link')).toBeNull();
    expect(document.querySelector('a[href*="coros.com"]')).toBeNull();
  });
});
