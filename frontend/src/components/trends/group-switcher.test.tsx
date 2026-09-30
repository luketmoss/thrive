// #243 AC4 — the group switcher, against a 3-group and a 6-group registry.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GroupSwitcher } from './group-switcher';
import type { TrendGroup } from './metrics';
import { groupPref, readPref, writePref } from './prefs';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const fixture = (n: number): TrendGroup[] =>
  Array.from({ length: n }, (_, i) => ({ id: `g${i}`, label: `Group ${i}`, metrics: [] }));

const mount = (n: number, value = 'g0', onChange = vi.fn()) =>
  ({ onChange, ...render(h(GroupSwitcher, { groups: fixture(n), value, onChange })) });

describe('renders', () => {
  it.each([3, 6])('with %i groups: one labelled row, one button per group in order', (n) => {
    const { container } = mount(n, 'g1');
    const region = container.querySelector('[role="region"]')!;
    expect(region.getAttribute('aria-label')).toBe('Metric group');
    expect(region.getAttribute('tabindex')).toBe('0');
    const row = region.querySelector('[role="group"]')!;
    expect(row.getAttribute('aria-label')).toBe('Metric group');
    const buttons = [...row.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(fixture(n).map((g) => g.label));
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(buttons.map((_, i) => (i === 1 ? 'true' : 'false')));
    expect(buttons.every((b) => b.classList.contains('trends-group-btn'))).toBe(true);
  });

  it('renders nothing with fewer than two groups', () => {
    expect(mount(1).container.innerHTML).toBe('');
    expect(mount(0).container.innerHTML).toBe('');
  });

  it('reports the clicked group', () => {
    const { container, onChange } = mount(6);
    fireEvent.click(container.querySelectorAll('button')[4]);
    expect(onChange).toHaveBeenCalledWith('g4');
  });
});

describe('layout contract (css)', () => {
  // jsdom has no layout; prove the rules that keep six groups inside the wrapper.
  it('the row never wraps and the wrapper scrolls sideways', () => {
    const css = readFileSync(resolve(__dirname, '../../global.css'), 'utf8');
    expect(css).toMatch(/\.trends-group-scroll\s*{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.trends-group-scroll\s*{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.trends-group-row\s*{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.sub-type-btn\.trends-group-btn\s*{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.sub-type-btn\.trends-group-btn\s*{[^}]*min-height:\s*44px/);
  });
});

describe('the group pref', () => {
  const groups = fixture(6);
  it('defaults to the first group when missing, unknown or unreadable', () => {
    const p = groupPref(groups);
    expect(p.key).toBe('thrive-trends-group');
    expect(readPref(p)).toBe('g0');
    localStorage.setItem(p.key, 'nope');
    expect(readPref(p)).toBe('g0');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('x'); });
    expect(readPref(p)).toBe('g0');
  });
  it('restores a stored group', () => {
    const p = groupPref(groups);
    writePref(p, 'g5');
    expect(readPref(p)).toBe('g5');
  });
});
