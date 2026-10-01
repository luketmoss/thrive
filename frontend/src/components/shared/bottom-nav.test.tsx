// #182 AC5 — the active tab is announced, not only coloured.
// #235 AC4 — five tabs, and every route marks exactly one.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { BottomNav } from './bottom-nav';
import { currentRoute } from '../../router/router';

afterEach(cleanup);

function renderAt(name: string) {
  currentRoute.value = { name, params: {}, hash: '/' };
  return render(h(BottomNav, {}));
}

const tabs = (c: Element) => [...c.querySelectorAll('button')];
const currentLabel = (c: Element) =>
  tabs(c).filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.getAttribute('aria-label'));

describe('BottomNav', () => {
  it('keeps its five tabs in order', () => {
    const { container } = renderAt('day');
    expect(tabs(container).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Day',
      'Activities',
      'Trends',
      'Library',
      'Settings',
    ]);
  });

  it('uses the agreed icons', () => {
    const { container } = renderAt('day');
    expect(tabs(container).map((b) => b.querySelector('.bottom-nav-icon')?.textContent)).toEqual([
      '\u{1F5D3}️', '\u{1F4CB}', '\u{1F4C8}', '\u{1F4DA}', '⚙️',
    ]);
  });

  it('marks only the active tab with aria-current="page"', () => {
    const { container } = renderAt('settings');
    expect(currentLabel(container)).toEqual(['Settings']);
    expect(tabs(container).filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1);
  });

  const map: Record<string, string[]> = {
    Day: ['day', 'calendar'],
    Trends: ['trends'],
    Activities: ['activities', 'workout-detail', 'workout-edit', 'workout-new', 'workout-active'],
    Library: ['templates', 'template-new', 'template-detail', 'template-edit', 'exercises'],
    Settings: ['settings', 'manage-labels'],
  };
  for (const [label, routes] of Object.entries(map)) {
    for (const route of routes) {
      it(`marks ${label} for route ${route}`, () => {
        const { container } = renderAt(route);
        expect(currentLabel(container)).toEqual([label]);
      });
    }
  }
});

// #237 AC1 — re-tapping Day.
describe('BottomNav Day re-tap (#237 AC1)', () => {
  it('goes to today from another date, replacing, and scrolls to the top', async () => {
    const { vi } = await import('vitest');
    const { replaceRoute } = await import('../../router/router');
    const { fireEvent } = await import('@testing-library/preact');
    const scrollTo = vi.fn();
    const saved = window.scrollTo;
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    window.history.replaceState(null, '', '#/activities');
    replaceRoute('/day/2026-09-12');
    const before = window.history.length;
    const { getByLabelText } = render(h(BottomNav, {}));
    fireEvent.click(getByLabelText('Day'));
    expect(window.location.hash).toBe('#/');
    expect(currentRoute.value.params).toEqual({});
    expect(window.history.length).toBe(before);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // On today it only scrolls
    fireEvent.click(getByLabelText('Day'));
    expect(window.location.hash).toBe('#/');
    expect(window.history.length).toBe(before);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    window.scrollTo = saved;
  });

  it('opens today from another tab, not the last date viewed', async () => {
    const { fireEvent } = await import('@testing-library/preact');
    const { replaceRoute } = await import('../../router/router');
    window.history.replaceState(null, '', '#/day/2026-09-12');
    replaceRoute('/settings');
    const { getByLabelText } = render(h(BottomNav, {}));
    fireEvent.click(getByLabelText('Day'));
    expect(window.location.hash).toBe('#/');
  });
});
