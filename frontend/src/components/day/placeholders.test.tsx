// #235 AC1 — Day and Trends placeholders.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { DayPlaceholder } from './day-placeholder';
import { TrendsPlaceholder } from '../trends/trends-placeholder';

afterEach(cleanup);

describe('DayPlaceholder', () => {
  it('has an h1, today, a plain sentence without issue numbers, and a link to Activities', () => {
    const { container } = render(h(DayPlaceholder, {}));
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.textContent).toContain(String(new Date().getFullYear()));
    expect(container.textContent).not.toMatch(/#\d+/);
    expect(container.querySelector('a[href="#/activities"]')).not.toBeNull();
  });

  it('carries the Start workout FAB pointing at #/workout/new', () => {
    const { getByLabelText } = render(h(DayPlaceholder, {}));
    fireEvent.click(getByLabelText('Start workout'));
    expect(window.location.hash).toBe('#/workout/new');
  });
});

describe('TrendsPlaceholder', () => {
  it('has a heading and one sentence, no chart and no FAB', () => {
    const { container } = render(h(TrendsPlaceholder, {}));
    expect(container.querySelector('h1')?.textContent).toBe('Trends');
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('svg, canvas, .fab')).toBeNull();
  });
});
