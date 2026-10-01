// #256 — focus on route change: a push focuses the new screen's heading, Back
// restores the control that opened the screen, replace moves leave focus alone.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { h, type ComponentChildren } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyOf, findByKey, headingOf, remember, remembered } from './route-focus';

type Router = typeof import('./router');
type Focus = typeof import('./route-focus');

// Screens keyed by route name, so the test can say what each one renders.
let screens: Record<string, () => ComponentChildren> = {};

async function boot(hash: string) {
  vi.resetModules();
  window.history.replaceState(null, '', hash);
  const router: Router = await import('./router');
  const focus: Focus = await import('./route-focus');
  function Stub() {
    const route = router.currentRoute.value;
    const screen = screens[route.name];
    return h('div', { class: 'screen' }, screen ? screen() : h('h1', {}, route.name));
  }
  const tabBar = h('nav', {}, h('button', { id: 'tab' }, 'Tab'));
  const utils = render(h('div', {}, h('main', { class: 'app-content', tabIndex: -1 }, h(Stub, {}), h(focus.RouteFocus, {})), tabBar));
  // Let RouteFocus subscribe (its effect runs after paint).
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 30));
  return { router, focus, ...utils };
}

/** Change route, then wait for RouteFocus to act. */
async function go(router: Router, move: () => void, name: string) {
  move();
  await waitFor(() => expect(router.currentRoute.value.name).toBe(name));
  await new Promise((r) => setTimeout(r, 120));
}

const active = () => document.activeElement as HTMLElement;
const byText = (text: string) => [...document.querySelectorAll<HTMLElement>('button, a, h1, h2, div')].find((e) => e.textContent === text)!;

let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  screens = {};
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('helpers', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('keyOf: data-focus-key, else id, else an <a> href; a descendant uses its closest [data-focus-key]', () => {
    document.body.innerHTML = `
      <div data-focus-key="trend-charts"><a id="x" href="#/day/2026-01-01">Open day</a></div>
      <button id="b">B</button><a href="#/">Day</a><button>none</button>`;
    expect(keyOf(document.querySelector('a#x'))).toEqual({ by: 'key', value: 'trend-charts' });
    expect(keyOf(document.getElementById('b'))).toEqual({ by: 'id', value: 'b' });
    expect(keyOf(document.querySelector('a[href="#/"]'))).toEqual({ by: 'href', value: '#/' });
    expect(keyOf(document.querySelectorAll('button')[1])).toBeNull();
    expect(keyOf(null)).toBeNull();
  });

  it('keyOf ignores a [data-focus-key] ancestor outside the root', () => {
    document.body.innerHTML = '<div data-focus-key="outer"><main><button id="in">In</button></main></div>';
    expect(keyOf(document.getElementById('in'), document.querySelector('main'))).toEqual({ by: 'id', value: 'in' });
  });

  it('findByKey finds the first match, without selector escaping', () => {
    document.body.innerHTML = '<b data-focus-key="w:1">a</b><b data-focus-key="w:1">b</b><b id="q&quot;x">c</b>';
    expect(findByKey(document, { by: 'key', value: 'w:1' })!.textContent).toBe('a');
    expect(findByKey(document, { by: 'id', value: 'q"x' })!.textContent).toBe('c');
    expect(findByKey(document, { by: 'key', value: 'gone' })).toBeNull();
  });

  it('headingOf: [data-screen-heading], else the first h1, else the first h2', () => {
    document.body.innerHTML = '<main><h2>Two</h2><h1>One</h1></main>';
    expect(headingOf(document.querySelector('main')!)!.textContent).toBe('One');
    document.body.innerHTML = '<main><h2>Two</h2><h2>Later</h2></main>';
    expect(headingOf(document.querySelector('main')!)!.textContent).toBe('Two');
    document.body.innerHTML = '<main><h1>One</h1><p data-screen-heading>Mark</p></main>';
    expect(headingOf(document.querySelector('main')!)!.textContent).toBe('Mark');
    document.body.innerHTML = '<main><p>none</p></main>';
    expect(headingOf(document.querySelector('main')!)).toBeNull();
  });

  it('remembers at most 50 hashes, oldest out first, and a null key forgets', () => {
    for (let i = 0; i < 51; i++) remember(`#/h${i}`, { by: 'id', value: String(i) });
    expect(remembered('#/h0')).toBeUndefined();
    expect(remembered('#/h50')).toEqual({ by: 'id', value: '50' });
    remember('#/h50', null);
    expect(remembered('#/h50')).toBeUndefined();
  });
});

describe('AC1: a push focuses the new screen heading', () => {
  it('moves no focus on the first render', async () => {
    await boot('#/activities');
    expect(active()).toBe(document.body);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('focuses the h1 with tabindex=-1, scrolled to the top first, without its own scroll', async () => {
    const { router } = await boot('#/activities');
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await go(router, () => router.navigate('/trends'), 'trends');
    expect(active().tagName).toBe('H1');
    expect(active().textContent).toBe('trends');
    expect(active().getAttribute('tabindex')).toBe('-1');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('every route name lands on a heading', async () => {
    const { router } = await boot('#/activities');
    const paths: Array<[string, string]> = [
      ['/', 'day'], ['/calendar', 'calendar'], ['/trends', 'trends'], ['/activities', 'activities'],
      ['/workout/new', 'workout-new'], ['/history/w1', 'workout-detail'], ['/history/w1/edit', 'workout-edit'],
      ['/workout/w1', 'workout-active'], ['/templates', 'templates'], ['/templates/new', 'template-new'],
      ['/templates/t1', 'template-detail'], ['/templates/t1/edit', 'template-edit'], ['/exercises', 'exercises'],
      ['/settings', 'settings'], ['/settings/labels', 'manage-labels'],
    ];
    for (const [path, name] of paths) {
      await go(router, () => router.navigate(path), name);
      expect(active().textContent).toBe(name);
    }
  });

  it('falls back to the first h2 when there is no h1', async () => {
    screens['workout-detail'] = () => [h('button', {}, 'Back'), h('h2', {}, 'Leg day'), h('h2', {}, 'Squat')];
    const { router } = await boot('#/activities');
    await go(router, () => router.navigate('/history/w1'), 'workout-detail');
    expect(active().textContent).toBe('Leg day');
  });

  it('prefers [data-screen-heading]', async () => {
    screens.settings = () => [h('h1', {}, 'Settings'), h('p', { 'data-screen-heading': '' }, 'Marked')];
    const { router } = await boot('#/activities');
    await go(router, () => router.navigate('/settings'), 'settings');
    expect(active().textContent).toBe('Marked');
  });

  it('focuses main when the screen has no heading, never body', async () => {
    screens.settings = () => h('p', {}, 'Not found');
    const { router } = await boot('#/activities');
    await go(router, () => router.navigate('/settings'), 'settings');
    expect(active().tagName).toBe('MAIN');
  });

  it('leaves a field that focused itself on mount (autoFocus) alone', async () => {
    screens['template-new'] = () => [h('h1', {}, 'New'), h('input', { ref: (el: HTMLInputElement | null) => el?.focus(), 'aria-label': 'Name' })];
    const { router } = await boot('#/templates');
    await go(router, () => router.navigate('/templates/new'), 'template-new');
    expect(active().tagName).toBe('INPUT');
  });

  it('keeps focus on a control both screens render (Library switch)', async () => {
    const lib = (title: string) => () => [
      h('h1', {}, 'Library'),
      h('button', { 'data-focus-key': 'library-switch:templates', 'data-screen': title }, 'Templates'),
      h('button', { 'data-focus-key': 'library-switch:exercises', 'data-screen': title }, 'Exercises'),
    ];
    screens.templates = lib('templates');
    screens.exercises = lib('exercises');
    const { router } = await boot('#/templates');
    byText('Exercises').focus();
    await go(router, () => router.navigate('/exercises'), 'exercises');
    expect(active().textContent).toBe('Exercises');
    expect(active().getAttribute('data-screen')).toBe('exercises');
  });

  it('a push into a screen never restores a remembered control', async () => {
    screens.activities = () => [h('h1', {}, 'Activities'), h('button', { 'data-focus-key': 'workout:w1' }, 'Card')];
    const { router } = await boot('#/activities');
    byText('Card').focus();
    await go(router, () => router.navigate('/history/w1'), 'workout-detail');
    await go(router, () => router.navigate('/activities'), 'activities');
    expect(active().textContent).toBe('Activities');
  });
});

describe('AC2: moves that do not take focus', () => {
  it('replaceRoute moves no focus and does not scroll', async () => {
    screens.day = () => [h('h1', { tabIndex: -1 }, 'Day'), h('button', {}, 'Next day')];
    const { router } = await boot('#/');
    byText('Next day').focus();
    await go(router, () => router.replaceRoute('/day/2026-01-02'), 'day');
    expect(active().textContent).toBe('Next day');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('a replace between day and calendar names still moves nothing', async () => {
    const { router } = await boot('#/calendar');
    const cell = byText('calendar');
    cell.setAttribute('tabindex', '0');
    cell.focus();
    await go(router, () => router.replaceRoute('/'), 'day');
    expect(active()).toBe(cell);
    expect(active().tagName).not.toBe('H1');
  });

  it('a hashchange that keeps the route name moves no focus', async () => {
    screens['workout-detail'] = () => [h('h2', {}, 'Detail'), h('button', {}, 'Copy')];
    const { router } = await boot('#/history/w1');
    byText('Copy').focus();
    await go(router, () => router.navigate('/history/w2'), 'workout-detail');
    await waitFor(() => expect(router.currentRoute.value.params.id).toBe('w2'));
    expect(active().textContent).toBe('Copy');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('a bottom tab to another screen focuses its heading', async () => {
    const { router } = await boot('#/activities');
    document.getElementById('tab')!.focus();
    await go(router, () => router.navigate('/trends'), 'trends');
    expect(active().textContent).toBe('trends');
  });
});

describe('AC3: Back restores the opener', () => {
  beforeEach(() => {
    screens.activities = () => [
      h('h1', {}, 'Activities'),
      h('button', { 'data-focus-key': 'workout:w1' }, 'W1'),
      h('button', { 'data-focus-key': 'workout:w2' }, 'W2'),
    ];
    screens['workout-detail'] = () => [h('button', {}, 'Back'), h('h2', {}, 'Detail')];
  });

  it('returns focus to the card by its key, without scrolling', async () => {
    const { router } = await boot('#/activities');
    byText('W2').focus();
    await go(router, () => router.navigate('/history/w2'), 'workout-detail');
    expect(active().textContent).toBe('Detail');
    scrollTo.mockClear();
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    await go(router, () => router.goBack(), 'activities');
    expect(active().textContent).toBe('W2');
    expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('restores by id and by href too', async () => {
    screens.day = () => [h('h1', {}, 'Day'), h('a', { href: '#/history/w1' }, 'Card')];
    const { router } = await boot('#/');
    byText('Card').focus();
    await go(router, () => router.navigate('/history/w1'), 'workout-detail');
    await go(router, () => router.goBack(), 'day');
    expect(active().textContent).toBe('Card');

    screens.settings = () => [h('h1', {}, 'Settings'), h('button', { id: 'opener' }, 'Opener')];
    await go(router, () => router.navigate('/settings'), 'settings');
    byText('Opener').focus();
    await go(router, () => router.navigate('/settings/labels'), 'manage-labels');
    await go(router, () => router.goBack(), 'settings');
    expect(active().id).toBe('opener');
  });

  it('a browser Back (unannounced hashchange to the previous entry) restores too', async () => {
    const { router } = await boot('#/activities');
    byText('W1').focus();
    await go(router, () => router.navigate('/history/w1'), 'workout-detail');
    await go(router, () => { window.location.hash = '#/activities'; }, 'activities');
    expect(active().textContent).toBe('W1');
  });

  it('focus from the tab bar is not remembered: Back lands on the heading', async () => {
    const { router } = await boot('#/activities');
    byText('W1').focus();
    await go(router, () => router.navigate('/history/w1'), 'workout-detail');
    await go(router, () => router.goBack(), 'activities');
    expect(active().textContent).toBe('W1');
    document.getElementById('tab')!.focus();
    await go(router, () => router.navigate('/trends'), 'trends');
    await go(router, () => router.goBack(), 'activities');
    expect(active().textContent).toBe('Activities');
  });
});

describe('AC4: failure modes land on the heading', () => {
  let list: string[];
  let disabled: boolean;
  beforeEach(() => {
    list = ['w1', 'w2'];
    disabled = false;
    screens.activities = () => [
      h('h1', {}, 'Activities'),
      ...list.map((id) => h('button', { key: id, 'data-focus-key': `workout:${id}`, disabled: disabled && id === 'w2' }, id)),
    ];
  });

  it('a deleted item focuses the heading', async () => {
    const { router } = await boot('#/activities');
    byText('w2').focus();
    await go(router, () => router.navigate('/history/w2'), 'workout-detail');
    list = ['w1'];
    await go(router, () => router.goBack(), 'activities');
    expect(active().textContent).toBe('Activities');
  });

  it('an element that will not take focus focuses the heading', async () => {
    const { router } = await boot('#/activities');
    byText('w2').focus();
    await go(router, () => router.navigate('/history/w2'), 'workout-detail');
    disabled = true;
    await go(router, () => router.goBack(), 'activities');
    expect(active().textContent).toBe('Activities');
  });

  it('a reordered list follows the item', async () => {
    const { router } = await boot('#/activities');
    byText('w2').focus();
    await go(router, () => router.navigate('/history/w2'), 'workout-detail');
    list = ['w2', 'w0', 'w1'];
    await go(router, () => router.goBack(), 'activities');
    expect(active().textContent).toBe('w2');
  });

  it('a key present twice focuses the first', async () => {
    screens.settings = () => [
      h('h1', {}, 'Settings'),
      h('button', { 'data-focus-key': 'dup', 'data-n': '1' }, 'A'),
      h('button', { 'data-focus-key': 'dup', 'data-n': '2' }, 'B'),
    ];
    const { router } = await boot('#/settings');
    byText('B').focus();
    await go(router, () => router.navigate('/settings/labels'), 'manage-labels');
    await go(router, () => router.goBack(), 'settings');
    expect(active().getAttribute('data-n')).toBe('1');
  });

  it('an opener that was never inside main focuses the heading', async () => {
    const { router } = await boot('#/activities');
    document.getElementById('tab')!.focus();
    await go(router, () => router.navigate('/history/w1'), 'workout-detail');
    await go(router, () => router.goBack(), 'activities');
    expect(active().textContent).toBe('Activities');
  });
});

// Review of #300: the no-ring rule must not reach a heading a screen focuses
// itself — a Day panel title after Try again keeps its ring (#276).
describe('no focus ring only on route-focused headings', () => {
  it('marks the heading it focuses, and unmarks it on blur', async () => {
    const { router } = await boot('#/activities');
    await go(router, () => router.navigate('/settings'), 'settings');
    const heading = active();
    expect(heading.hasAttribute('data-route-focus')).toBe(true);
    document.getElementById('tab')!.focus();
    expect(heading.hasAttribute('data-route-focus')).toBe(false);
  });

  it("global.css's #256 rule matches main and a marked heading, never a Day panel title", async () => {
    const css = readFileSync(resolve(__dirname, '../global.css'), 'utf-8').replace(/\r\n/g, '\n');
    const block = css.slice(css.indexOf('Route focus (#256)'));
    const selectors = block.slice(block.indexOf('*/') + 2, block.indexOf('{')).split(',').map((s) => s.trim().replace(/:focus$/, ''));
    expect(selectors).toEqual(['.app-content', '[data-route-focus]']);
    document.body.innerHTML = `
      <main class="app-content"><div class="day-screen">
        <h1 class="day-title" tabindex="-1">Day</h1>
        <h2 class="day-panel-title" tabindex="-1">Training</h2>
        <h1 id="marked" tabindex="-1" data-route-focus>Trends</h1>
      </div></main>`;
    const hits = (el: Element) => selectors.some((s) => el.matches(s));
    expect(hits(document.querySelector('main')!)).toBe(true);
    expect(hits(document.getElementById('marked')!)).toBe(true);
    expect(hits(document.querySelector('.day-panel-title')!)).toBe(false);
    expect(hits(document.querySelector('.day-title')!)).toBe(false);
  });
});
