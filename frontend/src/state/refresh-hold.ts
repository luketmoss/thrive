// When a background refresh of workouts/sets could overwrite something in
// progress (#249 AC3), shared by app.tsx (the page becoming visible) and the
// Day screen (a Sync now request landing, #409). Not a store: it only reads.

import { currentRoute } from '../router/router';
import { pendingSyncCount, isSyncing } from './store';

export const EDIT_ROUTES = new Set(['workout-new', 'workout-active', 'workout-edit']);

export function queueBusy(): boolean {
  return pendingSyncCount.value > 0 || isSyncing.value;
}

/** True while a refresh of workouts/sets could overwrite something in progress (#249 AC3). */
export function refreshHeld(): boolean {
  return EDIT_ROUTES.has(currentRoute.value.name) || queueBusy();
}

/**
 * A workouts/sets refresh that was asked for while held and is waiting for the
 * hold to lift. Module-level so a screen that asked and then unmounted (the
 * user went to start a workout) still has it run once, by app.tsx, when the
 * hold lifts.
 */
export const workoutsRefreshPending = { value: false };
