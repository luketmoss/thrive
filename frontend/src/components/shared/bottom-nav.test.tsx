// #182 AC5 — the active tab is announced, not only coloured.
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

describe('BottomNav', () => {
  it('keeps its four tabs in order', () => {
    const { container } = renderAt('activities');
    expect(tabs(container).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Activities',
      'Templates',
      'Exercises',
      'Settings',
    ]);
  });

  it('marks only the active tab with aria-current="page"', () => {
    const { container } = renderAt('settings');
    const current = tabs(container).filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current.map((b) => b.getAttribute('aria-label'))).toEqual(['Settings']);
    expect(tabs(container).filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('treats a nested route as its tab', () => {
    const { container } = renderAt('workout-detail');
    const current = tabs(container).find((b) => b.getAttribute('aria-current') === 'page');
    expect(current?.getAttribute('aria-label')).toBe('Activities');
  });
});
