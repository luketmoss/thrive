// #348: the editors and Delete leave with goBack('/activities'), so the history
// stack after Back/Save/Delete is the one the user came from. These drive the
// real router (jsdom history) through each path in the issue's table.

import { describe, it, expect } from 'vitest';
// First, so every router this file loads is recorded (#264).
import { freshRouter, nextHashchange } from './history.test-utils';

type Router = Awaited<ReturnType<typeof freshRouter>>;
const go = (r: Router, path: string) => nextHashchange(() => r.navigate(path));
const leave = (r: Router) => nextHashchange(() => r.goBack('/activities'));

describe('P1: Day -> edit', () => {
  it('Back lands on the same Day, adding no entry', async () => {
    const r = await freshRouter('#/day/2026-09-20');
    await go(r, '/history/w1/edit');
    const before = window.history.length;
    await leave(r);
    expect(window.location.hash).toBe('#/day/2026-09-20');
    expect(window.history.length).toBe(before);
  });
});

describe('P2: Day -> detail -> edit', () => {
  it('Back/Save lands on the detail, whose own Back lands on Day', async () => {
    const r = await freshRouter('#/day/2026-09-20');
    await go(r, '/history/w1');
    await go(r, '/history/w1/edit');
    const before = window.history.length;
    await leave(r);
    expect(window.location.hash).toBe('#/history/w1');
    expect(window.history.length).toBe(before);
    expect(r.canGoBack()).toBe(true);
    await leave(r);
    expect(window.location.hash).toBe('#/day/2026-09-20');
  });

  it('after Save the stack is [Day, detail]: the detail is not followed by another detail', async () => {
    const r = await freshRouter('#/day/2026-09-20');
    await go(r, '/history/w1');
    await go(r, '/history/w1/edit');
    await leave(r); // Save
    // One Back from the detail reaches Day directly; a duplicate detail entry
    // below it would have made canGoBack land on the detail again.
    await leave(r);
    expect(window.location.hash).toBe('#/day/2026-09-20');
  });
});

describe('P3: Activities -> detail -> edit', () => {
  it('Back lands on the detail, whose own Back lands on Activities', async () => {
    const r = await freshRouter('#/activities');
    await go(r, '/history/w1');
    await go(r, '/history/w1/edit');
    await leave(r);
    expect(window.location.hash).toBe('#/history/w1');
    await leave(r);
    expect(window.location.hash).toBe('#/activities');
  });
});

describe('P4: deep link to the editor', () => {
  it('falls back to #/activities for Back, Discard and Save alike', async () => {
    const r = await freshRouter('#/history/w1/edit');
    expect(r.canGoBack()).toBe(false);
    r.goBack('/activities');
    expect(window.location.hash).toBe('#/activities');
  });
});

describe('Delete on the detail', () => {
  it('[Day, detail] -> Delete lands on Day', async () => {
    const r = await freshRouter('#/day/2026-09-20');
    await go(r, '/history/w1');
    await leave(r);
    expect(window.location.hash).toBe('#/day/2026-09-20');
  });

  it('[Activities, detail] -> Delete lands on Activities', async () => {
    const r = await freshRouter('#/activities');
    await go(r, '/history/w1');
    await leave(r);
    expect(window.location.hash).toBe('#/activities');
  });

  it('a detail opened by deep link falls back to #/activities', async () => {
    const r = await freshRouter('#/history/w1');
    r.goBack('/activities');
    expect(window.location.hash).toBe('#/activities');
  });
});
