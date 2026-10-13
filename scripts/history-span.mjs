/**
 * The date span a DailySummary backfill should cover (#162).
 *
 * `getHistoryDateRange` is computed from Workouts alone, so a day that has
 * DailyHealth but no workout outside that span (Garmin wellness starts three
 * days before the first workout) would never be summarized. This widens the
 * workouts span to take in the DailyHealth dates too.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {{ from?: string, to?: string }} workoutsSpan  `getHistoryDateRange`'s answer
 * @param {{ date?: string }[]} healthRows  `getDailyHealth` rows (may be empty)
 * @returns {{ from: string, to: string, widened: boolean }} blank when neither source has a date
 */
export function widenSpan(workoutsSpan, healthRows) {
  const dates = (healthRows ?? []).map((r) => String(r?.date ?? '')).filter((d) => DATE.test(d)).sort();
  let from = workoutsSpan?.from || '';
  let to = workoutsSpan?.to || '';
  let widened = false;
  if (dates.length) {
    if (!from || dates[0] < from) { from = dates[0]; widened = true; }
    if (!to || dates.at(-1) > to) { to = dates.at(-1); widened = true; }
  }
  return { from, to, widened };
}
