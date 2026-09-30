// #237 AC1 — "today" in America/Denver, as a signal.
//
// Re-checked every minute and when the page becomes visible, while something
// has asked for it with `watchToday()` (the Day screen, while it is showing).
// Setting the same value again is a no-op for signals, so nothing redraws
// until the date actually changes.

import { signal } from '@preact/signals';
import { todayInDenver } from './dates';
import { onPageVisible } from '../state/page-visible';

export const today = signal<string>(todayInDenver());

/** Bring `today` up to date now. */
export function recheckToday(): void {
  today.value = todayInDenver();
}

let watchers = 0;
let stop: (() => void) | null = null;

/** Keep `today` current until the returned function is called. */
export function watchToday(): () => void {
  recheckToday();
  if (watchers++ === 0) {
    const timer = setInterval(recheckToday, 60_000);
    const unsubscribe = onPageVisible(recheckToday);
    stop = () => {
      clearInterval(timer);
      unsubscribe();
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--watchers === 0 && stop) {
      stop();
      stop = null;
    }
  };
}
