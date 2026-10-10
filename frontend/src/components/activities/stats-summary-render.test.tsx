// #329 — the Activities stats figures are real (visually hidden) text, not an
// aria-label on a role-less div.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'tok' }) }));

import { ActivitiesScreen } from './activities-screen';
import { workouts, sets, exercises } from '../../state/store';
import { toLocalDateStr } from './activities-helpers';
import type { WorkoutWithRow } from '../../api/types';

function makeWorkout(overrides: Partial<WorkoutWithRow>): WorkoutWithRow {
  return {
    id: 'w1', date: toLocalDateStr(new Date()), time: '08:10', type: 'hike', name: 'Ridge Trail', template_id: '',
    notes: '', elapsed_seconds: '3600', created: '', copied_from: '', status: '', moving_seconds: '',
    effort: '', distance_m: '8046.72', ascent_m: '304.8', descent_m: '', avg_hr: '', sub_type: '',
    source: '', source_activity_id: '', raw_ref: '', fit_ref: '', fit_fetched_at: '', synced_at: '',
    started_at_utc: '', calories: '', estimated_seconds: '', sport_type: '', sheetRow: 2, ...overrides,
  };
}

afterEach(() => {
  cleanup();
  workouts.value = [];
  sets.value = [];
  exercises.value = [];
});

describe('AC1/AC2/AC4: stats summary is announced as text', () => {
  it('puts every figure in a hidden paragraph and nothing in an aria-label', () => {
    workouts.value = [makeWorkout({})];
    const { container } = render(h(ActivitiesScreen, {}));
    const bar = container.querySelector('.week-streak-bar')!;
    const paras = Array.from(bar.querySelectorAll('p.sr-only'));
    const text = paras.map((p) => p.textContent).join(' ');
    expect(text).toContain('1 workout this week, 60 minutes.');
    expect(text).toContain('last week, 0 minutes.');
    expect(text).toContain('this month,');
    expect(text).toContain('5 miles across 1 of 1');
    expect(text).toContain('1,000 feet of ascent across 1 of 1');
    const statsBar = bar.querySelector('.stats-bar')!;
    expect(statsBar.hasAttribute('aria-label')).toBe(false);
    expect(statsBar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.querySelectorAll('[aria-label]')).toHaveLength(0);
  });

  it('reads the zero state in full', () => {
    const { container } = render(h(ActivitiesScreen, {}));
    const text = container.querySelector('.week-streak-bar')!.textContent;
    expect(text).toContain('0 workouts this week, 0 minutes.');
    expect(text).toContain('0 workouts last week, 0 minutes.');
    expect(text).toContain('0 workouts this month, 0 minutes.');
  });
});
