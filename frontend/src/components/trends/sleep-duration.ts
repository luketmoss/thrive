// Sleep durations on the Trends screen (#243 AC2). DailyHealth stores seconds;
// the metrics chart HOURS, so the y-axis gridlines land on round hours and not
// on round numbers of seconds (5000 s is 1h 23m, not a place a reader expects
// a line). Stored seconds become hours in metrics.ts. Everything shown is "7h 32m", or "45m" under an hour.

/** 7.53 hours → "7h 32m"; 0.75 → "45m"; 8 → "8h 0m"; never "0h 45m". */
export function formatSleep(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/**
 * A gridline in hours: "6h" on whole hours, "6.5h" on half hours. Finer steps
 * (a narrow range gives 0.05 h) keep up to two decimals, so neighbouring
 * gridlines never share a label.
 */
export function axisSleep(hours: number): string {
  return `${Number(hours.toFixed(2))}h`;
}
