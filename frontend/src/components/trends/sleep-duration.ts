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
 * A gridline in hours, given every gridline of the axis so its step decides
 * the precision (as `tickLabel` does): "6h" on whole hours, "6.5h" on half
 * hours, "7h 15m" or "45m" once the step is under half an hour, and decimal
 * hours only below a minute. Neighbouring gridlines never share a label.
 */
export function axisSleep(hours: number, ticks: readonly number[] = []): string {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  if (step >= 0.5) return `${Number(hours.toFixed(1))}h`;
  if (step >= 1 / 60) return formatSleep(hours);
  const decimals = Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
  return `${Number(hours.toFixed(decimals))}h`;
}
