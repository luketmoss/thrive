import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { SetRow } from './set-row';
import type { TrackerSet } from './set-row';

function makeSet(overrides: Partial<TrackerSet> = {}): TrackerSet {
  return {
    set_number: 1,
    planned_reps: '',
    weight: '135',
    reps: '10',
    effort: '',
    notes: '',
    saved: false,
    sheetRow: -1,
    ...overrides,
  };
}

const noop = () => {};

describe('SetRow — planned reps position (issue #91)', () => {
  // AC1: planned_reps appears inside .set-inputs after the reps input
  it('renders planned reps inside .set-inputs when provided', () => {
    const { container } = render(
      SetRow({ set: makeSet({ planned_reps: '6' }), onUpdate: noop, onRemove: noop })
    );
    const setInputs = container.querySelector('.set-inputs');
    expect(setInputs).not.toBeNull();
    const planned = setInputs!.querySelector('.set-planned-target');
    expect(planned).not.toBeNull();
  });

  // AC1: old .tracker-set-planned span outside .set-inputs is gone
  it('does not render .tracker-set-planned outside .set-inputs', () => {
    const { container } = render(
      SetRow({ set: makeSet({ planned_reps: '6' }), onUpdate: noop, onRemove: noop })
    );
    const trackerSet = container.querySelector('.tracker-set');
    // .tracker-set-planned should not be a direct child of .tracker-set
    const oldPlanned = trackerSet!.querySelector(':scope > .tracker-set-planned');
    expect(oldPlanned).toBeNull();
  });

  // AC2: nothing rendered when planned_reps is empty
  it('does not render planned reps element when planned_reps is empty', () => {
    const { container } = render(
      SetRow({ set: makeSet({ planned_reps: '' }), onUpdate: noop, onRemove: noop })
    );
    expect(container.querySelector('.set-planned-target')).toBeNull();
  });

  // AC3: DOM order inside .set-inputs is weight → separator → reps → planned-reps
  it('renders planned reps after reps input inside .set-inputs', () => {
    const { container } = render(
      SetRow({ set: makeSet({ planned_reps: '4-6' }), onUpdate: noop, onRemove: noop })
    );
    const setInputs = container.querySelector('.set-inputs')!;
    const children = Array.from(setInputs.children);
    const repsInput = setInputs.querySelector('.set-reps-input')!;
    const planned = setInputs.querySelector('.set-planned-target')!;
    expect(children.indexOf(repsInput)).toBeLessThan(children.indexOf(planned));
  });

  // AC5: aria-label conveys target reps meaningfully; visual prefix is aria-hidden
  it('has accessible aria-label and aria-hidden prefix on planned reps span', () => {
    const { container } = render(
      SetRow({ set: makeSet({ planned_reps: '6' }), onUpdate: noop, onRemove: noop })
    );
    const planned = container.querySelector('.set-planned-target') as HTMLElement;
    expect(planned.getAttribute('aria-label')).toBe('target: 6 reps');
    const prefix = planned.querySelector('[aria-hidden]') as HTMLElement;
    expect(prefix).not.toBeNull();
    expect(prefix.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('SetRow — saved checkmark layout (issue #26)', () => {
  // AC1 + AC2: The .set-saved span is always in the DOM (reserves space)
  it('always renders the .set-saved span regardless of saved state', () => {
    const { container } = render(
      SetRow({ set: makeSet({ saved: false }), onUpdate: noop, onRemove: noop })
    );
    const savedSpan = container.querySelector('.set-saved');
    expect(savedSpan).not.toBeNull();
    expect(savedSpan!.textContent).toBe('✓');
  });

  // AC2: When unsaved, span is visually hidden and aria-hidden="true"
  it('hides the checkmark visually and from assistive tech when unsaved', () => {
    const { container } = render(
      SetRow({ set: makeSet({ saved: false }), onUpdate: noop, onRemove: noop })
    );
    const savedSpan = container.querySelector('.set-saved') as HTMLElement;
    expect(savedSpan.style.visibility).toBe('hidden');
    expect(savedSpan.getAttribute('aria-hidden')).toBe('true');
  });

  // AC3: When saved, span is visible and aria-hidden="false"
  it('shows the checkmark and exposes to assistive tech when saved', () => {
    const { container } = render(
      SetRow({ set: makeSet({ saved: true }), onUpdate: noop, onRemove: noop })
    );
    const savedSpan = container.querySelector('.set-saved') as HTMLElement;
    expect(savedSpan.style.visibility).toBe('visible');
    expect(savedSpan.getAttribute('aria-hidden')).toBe('false');
    expect(savedSpan.getAttribute('aria-label')).toBe('Saved');
  });

  // AC4: Remove button is always present in a consistent position
  it('always renders the remove button after the set-saved span', () => {
    const { container: unsavedContainer } = render(
      SetRow({ set: makeSet({ saved: false }), onUpdate: noop, onRemove: noop })
    );
    const { container: savedContainer } = render(
      SetRow({ set: makeSet({ saved: true }), onUpdate: noop, onRemove: noop })
    );

    // Both should have the remove button
    const unsavedRemove = unsavedContainer.querySelector('.set-remove-btn');
    const savedRemove = savedContainer.querySelector('.set-remove-btn');
    expect(unsavedRemove).not.toBeNull();
    expect(savedRemove).not.toBeNull();

    // The .set-saved span should come before .set-remove-btn in DOM order
    const unsavedSaved = unsavedContainer.querySelector('.set-saved');
    const unsavedParent = unsavedSaved!.parentElement!;
    const children = Array.from(unsavedParent.children);
    const savedIndex = children.indexOf(unsavedSaved as Element);
    const removeIndex = children.indexOf(unsavedRemove as Element);
    expect(savedIndex).toBeLessThan(removeIndex);
  });
});
