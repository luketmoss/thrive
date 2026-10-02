// #291 — every route has a document title, set by one owner.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { freshRouter, nextHashchange } from './history.test-utils';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { titleFor, DEFAULT_TITLE, type TitleLookups } from './document-title';
import { ROUTE_NAMES } from './router';

const none: TitleLookups = { workout: () => undefined, template: () => undefined };
const lookups = (
  w: Record<string, { name: string; type: string }> = {},
  t: Record<string, { name: string }> = {},
): TitleLookups => ({ workout: (id) => w[id], template: (id) => t[id] });
const at = (name: (typeof ROUTE_NAMES)[number], params: Record<string, string> = {}) => ({ name, params });

describe('titleFor (AC1, AC3, AC5)', () => {
  it('titles the fixed routes', () => {
    expect(titleFor(at('day'), none)).toBe('Today — Thrive');
    expect(titleFor(at('day', { date: '2026-09-30' }), none)).toBe('Wed 30 Sep 2026 — Thrive');
    expect(titleFor(at('day', { date: '2026-01-05' }), none)).toBe('Mon 5 Jan 2026 — Thrive');
    expect(titleFor(at('calendar'), none)).toBe('Calendar — Thrive');
    expect(titleFor(at('calendar', { month: '2026-09' }), none)).toBe('September 2026 — Thrive');
    expect(titleFor(at('trends'), none)).toBe('Trends — Thrive');
    expect(titleFor(at('activities'), none)).toBe('Activities — Thrive');
    expect(titleFor(at('settings'), none)).toBe('Settings — Thrive');
    expect(titleFor(at('manage-labels'), none)).toBe('Manage Labels — Thrive');
    expect(titleFor(at('templates'), none)).toBe('Templates — Thrive');
    expect(titleFor(at('exercises'), none)).toBe('Exercises — Thrive');
    expect(titleFor(at('template-new'), none)).toBe('New Template — Thrive');
    expect(titleFor(at('workout-new'), none)).toBe('New Workout — Thrive');
  });

  it('names a workout or template by its own name', () => {
    const l = lookups({ w1: { name: 'Push Day', type: 'weight' } }, { t1: { name: 'Pull A' } });
    expect(titleFor(at('workout-detail', { id: 'w1' }), l)).toBe('Push Day — Thrive');
    expect(titleFor(at('workout-active', { id: 'w1' }), l)).toBe('Log Push Day — Thrive');
    expect(titleFor(at('workout-edit', { id: 'w1' }), l)).toBe('Edit Push Day — Thrive');
    expect(titleFor(at('template-detail', { id: 't1' }), l)).toBe('Pull A — Thrive');
    expect(titleFor(at('template-edit', { id: 't1' }), l)).toBe('Edit Pull A — Thrive');
  });

  it('falls back: a blank name uses the type, an unknown id the generic word', () => {
    const l = lookups({ w1: { name: '   ', type: 'hike' } }, { t1: { name: ' ' } });
    expect(titleFor(at('workout-detail', { id: 'w1' }), l)).toBe('hike — Thrive');
    expect(titleFor(at('workout-edit', { id: 'w1' }), l)).toBe('Edit hike — Thrive');
    expect(titleFor(at('template-detail', { id: 't1' }), l)).toBe('Template — Thrive');
    expect(titleFor(at('workout-detail', { id: 'nope' }), none)).toBe('Workout — Thrive');
    expect(titleFor(at('workout-active', { id: 'nope' }), none)).toBe('Workout — Thrive');
    expect(titleFor(at('workout-edit', { id: 'nope' }), none)).toBe('Workout — Thrive');
    expect(titleFor(at('template-detail', { id: 'nope' }), none)).toBe('Template — Thrive');
    expect(titleFor(at('template-edit', { id: 'nope' }), none)).toBe('Template — Thrive');
  });

  it('collapses whitespace and cuts names over 60 characters with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const l = lookups({ w1: { name: long, type: 'weight' }, w2: { name: 'a \n  b', type: 'weight' } });
    expect(titleFor(at('workout-detail', { id: 'w1' }), l)).toBe(`${'x'.repeat(60)}… — Thrive`);
    expect(titleFor(at('workout-detail', { id: 'w2' }), l)).toBe('a b — Thrive');
  });

  it('every route name has a non-empty title ending in " — Thrive"', () => {
    for (const name of ROUTE_NAMES) {
      const t = titleFor(at(name, { id: 'x' }), none);
      expect(t.length).toBeGreaterThan(' — Thrive'.length);
      expect(t.endsWith(' — Thrive')).toBe(true);
      expect(t).not.toContain('undefined');
    }
  });

  it('no screen sets document.title itself, and the stale routes.ts is gone', () => {
    const src = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && /document\.title\s*=/.test(readFileSync(p, 'utf8'))) offenders.push(e.name);
      }
    };
    walk(src);
    expect(offenders).toEqual(['document-title.ts']);
    expect(() => readFileSync(resolve(__dirname, 'routes.ts'))).toThrow();
  });
});

describe('useDocumentTitle through RouteFocus (AC1-AC4, AC6)', () => {
  type Router = typeof import('./router');
  async function boot(hash: string) {
    const router: Router = await freshRouter(hash);
    const focus = await import('./route-focus');
    const store = await import('../state/store');
    const utils = render(h('main', {}, h(focus.RouteFocus, {})));
    await new Promise((r) => setTimeout(r, 30));
    return { router, store, ...utils };
  }
  const title = () => document.title;

  beforeEach(() => { document.title = DEFAULT_TITLE; });
  afterEach(cleanup);

  it('follows Back and Forward, and a same-name move to another workout', async () => {
    const { router, store } = await boot('#/trends');
    store.workouts.value = [
      { id: 'a', name: 'Alpha', type: 'weight' },
      { id: 'b', name: 'Beta', type: 'weight' },
    ] as never;
    await waitFor(() => expect(title()).toBe('Trends — Thrive'));
    await nextHashchange(() => router.navigate('/activities'));
    await waitFor(() => expect(title()).toBe('Activities — Thrive'));
    await nextHashchange(() => router.navigate('/history/a'));
    await waitFor(() => expect(title()).toBe('Alpha — Thrive'));
    await nextHashchange(() => router.navigate('/history/b'));
    await waitFor(() => expect(title()).toBe('Beta — Thrive'));
    await nextHashchange(() => window.history.back());
    await nextHashchange(() => window.history.back());
    await waitFor(() => expect(title()).toBe('Activities — Thrive'));
    await nextHashchange(() => window.history.back());
    await waitFor(() => expect(title()).toBe('Trends — Thrive'));
    await nextHashchange(() => window.history.forward());
    await waitFor(() => expect(title()).toBe('Activities — Thrive'));
  });

  it('updates when a rename lands without a route change; unknown id is Workout', async () => {
    const { store } = await boot('#/history/a');
    await waitFor(() => expect(title()).toBe('Workout — Thrive'));
    store.workouts.value = [{ id: 'a', name: 'Alpha', type: 'weight' }] as never;
    await waitFor(() => expect(title()).toBe('Alpha — Thrive'));
    store.workouts.value = [{ id: 'a', name: 'Renamed', type: 'weight' }] as never;
    await waitFor(() => expect(title()).toBe('Renamed — Thrive'));
    store.workouts.value = [{ id: 'a', name: '', type: 'bike' }] as never;
    await waitFor(() => expect(title()).toBe('bike — Thrive'));
  });

  it('Day follows replaceRoute with no history entry', async () => {
    const { router } = await boot('#/');
    await waitFor(() => expect(title()).toBe('Today — Thrive'));
    const before = window.history.length;
    router.replaceRoute('/day/2026-09-30');
    await waitFor(() => expect(title()).toBe('Wed 30 Sep 2026 — Thrive'));
    router.replaceRoute('/');
    await waitFor(() => expect(title()).toBe('Today — Thrive'));
    expect(window.history.length).toBe(before);
  });

  it('restores the default when the app unmounts (sign-out)', async () => {
    const { unmount } = await boot('#/settings');
    await waitFor(() => expect(title()).toBe('Settings — Thrive'));
    unmount();
    expect(title()).toBe(DEFAULT_TITLE);
  });
});
