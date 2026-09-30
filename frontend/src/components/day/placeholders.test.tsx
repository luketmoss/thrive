// #237 AC5 — the panel shell contract and the four placeholders.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { SLOTS, SLOT_ORDER, slotsFor } from './slots';
import { Panel, PanelNote } from './panel';
import type { DayState } from '../../day/dates';

afterEach(cleanup);

const COPY: Record<string, Partial<Record<DayState, string>>> = {
  training: {
    past: 'What you did this day will show here.',
    today: "What's planned today, and what you've done, will show here.",
    future: "What's planned for this day will show here.",
  },
  health: {
    past: "That day's sleep, heart rate and steps will show here.",
    today: "Last night's sleep, heart rate and steps so far will show here.",
  },
  body: {
    past: "That day's weight and blood pressure will show here.",
    today: "Today's weight and blood pressure will show here once they arrive.",
  },
  note: {
    past: "That day's note will show here.",
    today: "Today's note will show here.",
    future: 'A note for this day will show here.',
  },
};
const TITLES: Record<string, string> = { training: 'Training', health: 'Health', body: 'Body', note: 'Note' };

describe('slots', () => {
  it('orders the four slots and drops health and body on a future day', () => {
    expect(SLOT_ORDER).toEqual(['training', 'health', 'body', 'note']);
    expect(slotsFor('past')).toEqual(['training', 'health', 'body', 'note']);
    expect(slotsFor('today')).toEqual(['training', 'health', 'body', 'note']);
    expect(slotsFor('future')).toEqual(['training', 'note']);
  });

  for (const state of ['past', 'today', 'future'] as DayState[]) {
    for (const name of slotsFor(state)) {
      it(`${name} placeholder on a ${state} day shows its title and line`, () => {
        const Slot = SLOTS[name];
        const { container } = render(<Slot date="2026-09-30" state={state} today="2026-09-30" />);
        expect(container.querySelector('section h2')!.textContent).toBe(TITLES[name]);
        const note = container.querySelector('.panel-note')!;
        expect(note.textContent).toBe(COPY[name][state]);
        expect(note.textContent).not.toMatch(/#\d+/);
      });
    }
  }
});

describe('Panel', () => {
  it('is a section labelled by its h2, with optional sub and action', () => {
    const { container } = render(
      <Panel title="Training" sub="6:30 AM" action={<button>Edit</button>}>
        <PanelNote>Nothing yet.</PanelNote>
      </Panel>,
    );
    const section = container.querySelector('section.day-panel')!;
    const h2 = section.querySelector('h2')!;
    expect(section.getAttribute('aria-labelledby')).toBe(h2.id);
    expect(h2.id).not.toBe('');
    expect(section.querySelector('.day-panel-sub')!.textContent).toBe('6:30 AM');
    expect(section.querySelector('.day-panel-action button')!.textContent).toBe('Edit');
    expect(section.querySelector('p.panel-note')!.textContent).toBe('Nothing yet.');
  });

  it('leaves out sub and action when not given', () => {
    const { container } = render(<Panel title="Note" />);
    expect(container.querySelector('.day-panel-sub')).toBeNull();
    expect(container.querySelector('.day-panel-action')).toBeNull();
  });
});
