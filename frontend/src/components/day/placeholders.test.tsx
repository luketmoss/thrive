// #235 AC1 — the Day placeholder. (#242 replaced the Trends one.)
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { DayPlaceholder } from './day-placeholder';

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
