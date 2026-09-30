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
    Day: ['day'],
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
