// Opening a chart day in the Day view (#254): the link and Enter share this.
//
// `navigate` pushes a history entry (#237 AC1), so Back returns to Trends.
// Trends' scroll offset must not carry over to the Day view, which starts at its
// top. The scroll waits for the hashchange: the browser records Trends' offset
// for Back when the entry changes, and scrolling before that would lose it.

import { navigate } from '../../router/router';
import { dayHref, todayInDenver } from '../../day/dates';

/** The href of a day's link: `#/` for today, `#/day/YYYY-MM-DD` otherwise. */
export function openDayHref(date: string): string {
  return dayHref(date, todayInDenver());
}

export function openDay(date: string): void {
  const href = openDayHref(date);
  window.addEventListener('hashchange', () => window.scrollTo(0, 0), { once: true });
  navigate(href.replace(/^#/, ''));
}
