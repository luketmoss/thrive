// Issue #129 AC3 — the venue control must inherit EffortToggle's contract:
// role="group" with a group label, per-button aria-pressed, 44px targets, and
// tapping the selected value clears it back to unset.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import { h } from 'preact';
import { SubTypeToggle } from './sub-type-toggle';

afterEach(cleanup);

function renderToggle(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(h(SubTypeToggle, {
    workoutType: 'bike',
    value: '',
    onChange,
    label: 'Activity type',
    ...overrides,
  } as never));
  return { onChange };
}

describe('AC3: the control matches the three-way control contract', () => {
  it('exposes a labelled group', () => {
    renderToggle();
    expect(screen.getByRole('group', { name: 'Activity type' })).toBeTruthy();
  });

  it('gives every button aria-pressed, not just the active one', () => {
    renderToggle({ value: 'gravel' });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.getAttribute('aria-pressed')))
      .toEqual(['false', 'true', 'false']);
  });

  it('prefixes each accessible name with the group label', () => {
    renderToggle();
    expect(screen.getByRole('button', { name: 'Activity type: Mountain' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activity type: Indoor' })).toBeTruthy();
  });

  // The whole reason the control exists in this shape: unset must stay
  // reachable from every value, without a "None" button to explain.
  it('clears back to unset when the selected value is tapped again', () => {
    const { onChange } = renderToggle({ value: 'indoor' });
    fireEvent.click(screen.getByRole('button', { name: 'Activity type: Indoor' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('selects an unselected value', () => {
    const { onChange } = renderToggle({ value: 'indoor' });
    fireEvent.click(screen.getByRole('button', { name: 'Activity type: Gravel' }));
    expect(onChange).toHaveBeenCalledWith('gravel');
  });

  it('renders type="button" so it never submits a form', () => {
    renderToggle();
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('type')).toBe('button');
    }
  });

  // AC2: weight, stretch and hike show no control at all.
  it('renders nothing for a type with no venue split', () => {
    const { container } = render(h(SubTypeToggle, {
      workoutType: 'hike', value: '', onChange: vi.fn(),
    } as never));
    expect(container.innerHTML).toBe('');
  });

  it('offers two options for a run and three for a bike', () => {
    renderToggle({ workoutType: 'run' });
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
