// #237 — which component fills each Day panel. The one file in
// `components/day/` that panel issues change: #238 points `training` at its
// component, #239 `health` and `body`, #240 `note`, each deleting the
// placeholder it replaces. One import and one entry per line, so those
// changes do not touch each other's lines.
//
// The screen decides what is mounted and in which order (`SLOT_ORDER`,
// `slotsFor`): `health` and `body` never mount on a future day, so a slot
// never handles a state it is not shown in. Every slot remounts on each date
// change; anything it must not lose has to live outside it.

import type { ComponentType } from 'preact';
import type { DayState } from '../../day/dates';
import type { DayPanelProps } from './panel';
import { TrainingPanel } from './training-panel';
import { HealthPanel } from './health-panel';
import { BodyPanel } from './body-panel';
import { JournalPanel } from './journal-panel';

export type SlotName = 'training' | 'health' | 'body' | 'note';

export const SLOTS: Record<SlotName, ComponentType<DayPanelProps>> = {
  training: TrainingPanel,
  health: HealthPanel,
  body: BodyPanel,
  note: JournalPanel,
};

/** Top to bottom, one column. */
export const SLOT_ORDER: readonly SlotName[] = ['training', 'health', 'body', 'note'];

/** Nothing is known about a future day's health or body. */
const PAST_AND_TODAY_ONLY: ReadonlySet<SlotName> = new Set(['health', 'body']);

/** The slots shown on a day in `state`, in order. */
export function slotsFor(state: DayState): SlotName[] {
  return SLOT_ORDER.filter((s) => state !== 'future' || !PAST_AND_TODAY_ONLY.has(s));
}
