// Opening a chart day in the Day view (#254): the link and Enter share this.
//
// `navigate` pushes a history entry (#237 AC1), so Back returns to Trends.
// Trends' scroll offset must not carry over to the Day view, which starts at its
// top. The scroll waits for the hashchange: the browser records Trends' offset
// for Back when the entry changes, and scrolling before that would lose it.

import { navigate } from '../../router/router';
import { dayHref } from '../../day/dates';

/** The href of a day's link: `#/` for today, `#/day/YYYY-MM-DD` otherwise. */
export function openDayHref(date: string, today: string): string {
  return dayHref(date, today);
}

export function openDay(date: string, today: string): void {
  const href = openDayHref(date, today);
  window.addEventListener('hashchange', () => window.scrollTo(0, 0), { once: true });
  navigate(href.replace(/^#/, ''));
}

/**
 * The click handler of every link that opens a day (#254, #255): a modified or
 * non-primary click keeps the browser's own behaviour (new tab or window), is
 * not prevented and registers no scroll reset; any other opens the day.
 */
export function openDayClick(date: string, today: string) {
  return (e: MouseEvent): void => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openDay(date, today);
  };
}
