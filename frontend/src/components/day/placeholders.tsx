// #237 AC5 — the four panels' stand-ins, until #238, #239 and #240 replace
// them. Each shows its title and one line that changes with the day's state,
// and makes no read. A panel issue points its slot at its own component and
// deletes its placeholder from this file.

import type { DayState } from '../../day/dates';
import { Panel, PanelNote, type DayPanelProps } from './panel';

type Copy = Partial<Record<DayState, string>>;

function placeholder(title: string, copy: Copy) {
  return function Placeholder({ state }: DayPanelProps) {
    return (
      <Panel title={title}>
        <PanelNote>{copy[state]}</PanelNote>
      </Panel>
    );
  };
}

export const TrainingPlaceholder = placeholder('Training', {
  past: 'What you did this day will show here.',
  today: "What's planned today, and what you've done, will show here.",
  future: "What's planned for this day will show here.",
});

export const HealthPlaceholder = placeholder('Health', {
  past: "That day's sleep, heart rate and steps will show here.",
  today: "Last night's sleep, heart rate and steps so far will show here.",
});

export const BodyPlaceholder = placeholder('Body', {
  past: "That day's weight and blood pressure will show here.",
  today: "Today's weight and blood pressure will show here once they arrive.",
});

export const NotePlaceholder = placeholder('Note', {
  past: "That day's note will show here.",
  today: "Today's note will show here.",
  future: 'A note for this day will show here.',
});
