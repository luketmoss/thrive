// Issue #129 AC4/AC6 — what the cardio fieldset actually renders, and the
// guarantee that a field nobody filled writes nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/preact';
import { h } from 'preact';
import { CardioFields } from './cardio-fields';
import type { CardioValues } from './cardio-fields';
import { feetToMeters, milesToMeters, bpmToStored } from '../../api/units';

afterEach(cleanup);

const EMPTY: CardioValues = { distance: '', ascent: '', descent: '', avgHr: '' };

function renderFields(workoutType: string, subType: string, values = EMPTY) {
  return render(h(CardioFields, {
    workoutType, subType, values, onChange: vi.fn(), idPrefix: 't',
  } as never));
}

const labels = () => Array.from(document.querySelectorAll('label.form-label'))
  .map((el) => el.textContent);

describe('AC4: the legend comes from a type map, not a ternary', () => {
  it('names the activity for each type', () => {
    for (const [type, legend] of [
      ['bike', 'Ride details'], ['hike', 'Hike details'],
      ['run', 'Run details'], ['walk', 'Walk details'],
    ] as const) {
      cleanup();
      renderFields(type, '');
      expect(screen.getByText(legend), type).toBeTruthy();
    }
  });
});

describe('AC4: fields respond to venue', () => {
  it('shows Distance and Avg HR but not Ascent for an indoor run', () => {
    renderFields('run', 'indoor');
    expect(labels()).toEqual(['Distance (miles)', 'Avg HR (bpm)']);
  });

  it('shows Ascent for an outdoor run', () => {
    renderFields('run', 'outdoor');
    expect(labels()).toEqual(['Distance (miles)', 'Ascent (feet)', 'Avg HR (bpm)']);
  });

  it('never hides a field that already holds a value', () => {
    renderFields('run', 'indoor', { ...EMPTY, ascent: '1200' });
    expect(labels()).toContain('Ascent (feet)');
    expect((screen.getByLabelText('Ascent (feet)') as HTMLInputElement).value).toBe('1200');
  });

  it('drops the elevation note when no elevation field is shown', () => {
    renderFields('run', 'indoor');
    expect(screen.queryByText(/Elevation is recorded/)).toBeNull();
    cleanup();
    renderFields('run', 'outdoor');
    expect(screen.getByText(/Elevation is recorded/)).toBeTruthy();
  });

  // The change is announced rather than focused — the user is mid-form.
  it('announces the current field set politely', () => {
    renderFields('bike', 'indoor');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Distance (miles), Avg HR (bpm)');
    expect(status.className).toContain('sr-only');
  });

  it('renders nothing at all for a weight workout', () => {
    const { container } = renderFields('weight', '');
    expect(container.innerHTML).toBe('');
  });
});

// AC6: a hidden field is an empty field, and an empty field stores ''.
describe('AC6: nothing writes a zero into a field nobody filled', () => {
  it('converts an untouched cardio value to empty, never 0', () => {
    expect(feetToMeters('')).toBe('');
    expect(milesToMeters('')).toBe('');
    expect(bpmToStored('')).toBe('');
  });

  it('keeps a deliberate zero distinct from unset', () => {
    expect(feetToMeters('0')).toBe('0');
    expect(bpmToStored('0')).toBe('0');
  });

  it('leaves a hidden field empty so the save path stores an empty cell', () => {
    // Ascent is not rendered for an indoor ride, so it can never be typed
    // into, so it reaches feetToMeters as '' — which stays ''.
    renderFields('bike', 'indoor');
    expect(screen.queryByLabelText('Ascent (feet)')).toBeNull();
    expect(feetToMeters(EMPTY.ascent)).toBe('');
  });
});
