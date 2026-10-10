import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { h } from 'preact';
import { EffortToggle } from './effort-toggle';
import type { Effort } from '../../api/types';

afterEach(cleanup);

function renderToggle(overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const props = { value: '' as Effort | '', onChange, size: 'session', label: 'Session effort', ...overrides };
  const result = render(h(EffortToggle as any, props));
  return { ...result, onChange };
}

const buttons = (c: Element) => [...c.querySelectorAll('button')];

// Issue #102 — session-level effort.
describe('EffortToggle', () => {
  // AC1: nothing is ever pre-selected.
  describe('AC1: never defaulted', () => {
    it('pre-selects nothing when the value is unset', () => {
      const { container } = renderToggle();
      expect(buttons(container).every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
      expect(container.querySelector('.active')).toBeNull();
    });

    it('offers exactly Easy, Medium and Hard', () => {
      const { container } = renderToggle();
      expect(buttons(container).map((b) => b.textContent!.trim())).toEqual(['Easy', 'Medium', 'Hard']);
    });
  });

  // AC2: unset is reachable, and the control meets mobile + a11y standards.
  describe('AC2: clearing, labelling and affordance', () => {
    it('clears back to unset when the selected value is tapped again', () => {
      const { container, onChange } = renderToggle({ value: 'Hard' });
      fireEvent.click(buttons(container).find((b) => b.textContent!.trim() === 'Hard')!);
      expect(onChange).toHaveBeenCalledWith('');
    });

    it('selects a value when a different button is tapped', () => {
      const { container, onChange } = renderToggle({ value: 'Hard' });
      fireEvent.click(buttons(container).find((b) => b.textContent!.trim() === 'Easy')!);
      expect(onChange).toHaveBeenCalledWith('Easy');
    });

    it('shows full words, so a voice-control user saying "Easy" hits the right button', () => {
      const { container } = renderToggle();
      const easy = buttons(container)[0];
      // WCAG 2.5.3 Label in Name: the visible text must be in the accessible name.
      expect(easy.textContent!.trim()).toBe('Easy');
      expect(easy.getAttribute('aria-label')).toContain('Easy');
    });

    it('groups the buttons and names the group', () => {
      const { container } = renderToggle();
      const group = container.querySelector('[role="group"]')!;
      expect(group.getAttribute('aria-label')).toBe('Session effort');
    });

    it('labels each button for the session, not for filling sets', () => {
      const { container } = renderToggle();
      expect(buttons(container).map((b) => b.getAttribute('aria-label'))).toEqual([
        'Session effort: Easy', 'Session effort: Medium', 'Session effort: Hard',
      ]);
    });

    it('signals the active state with more than colour', () => {
      const { container } = renderToggle({ value: 'Medium' });
      const active = buttons(container).find((b) => b.className.includes('active'))!;
      // aria-pressed carries it non-visually; .active carries the border/weight cue.
      expect(active.getAttribute('aria-pressed')).toBe('true');
      expect(active.textContent!.trim()).toBe('Medium');
    });

    it('uses the session class so the 44px sizing applies', () => {
      const { container } = renderToggle();
      expect(container.querySelector('.effort-toggle-session')).toBeTruthy();
    });

    it('does not carry the session class in compact mode', () => {
      const { container } = renderToggle({ size: 'compact' });
      expect(container.querySelector('.effort-toggle-session')).toBeNull();
      expect(container.querySelector('.effort-toggle')).toBeTruthy();
    });
  });

  // The dense set row keeps its 28px single-letter control.
  describe('compact variant is unchanged', () => {
    it('shows single letters', () => {
      const { container } = renderToggle({ size: 'compact', label: 'Fill all sets' });
      expect(buttons(container).map((b) => b.textContent!.trim())).toEqual(['E', 'M', 'H']);
    });

    it('keeps the set row’s own button labels', () => {
      const { container } = renderToggle({ size: 'compact', label: 'Fill all sets' });
      expect(buttons(container)[0].getAttribute('aria-label')).toBe('Fill all sets: Easy');
    });

    it('still clears on a second tap', () => {
      const { container, onChange } = renderToggle({ size: 'compact', value: 'Easy', label: 'Fill all sets' });
      fireEvent.click(buttons(container)[0]);
      expect(onChange).toHaveBeenCalledWith('');
    });
  });
});

// #372: optional labelledBy names the group; label still names the buttons.
describe('EffortToggle labelledBy (#372)', () => {
  it('names the group by the referenced element when labelledBy is set', () => {
    const { getByRole } = render(h('div', null,
      h('span', { id: 'lbl' }, 'Session Effort (optional)'),
      h(EffortToggle as any, { value: '', onChange: vi.fn(), size: 'session', label: 'Session effort', labelledBy: 'lbl' })));
    const g = getByRole('group', { name: 'Session Effort (optional)' });
    expect(g.hasAttribute('aria-label')).toBe(false);
    expect(getByRole('button', { name: 'Session effort: Easy' })).toBeTruthy();
  });

  it('falls back to label for the group name without labelledBy', () => {
    const { getByRole } = renderToggle();
    expect(getByRole('group', { name: 'Session effort' })).toBeTruthy();
  });
});
