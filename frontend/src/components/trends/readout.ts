// One day of one metric, written one way (#247 AC2). The table's cells and the
// chart's readout both come from `dayCells`, so they cannot disagree, and the
// screen-reader announcement is built from the same pieces.
//
// Charts show and never conclude: only the value, never a comparison.

import type { TrendMetric, TrendPoint } from './metrics';
import { rowDate, type MetricSeries } from './series';

/** A blank value or a missing average. Never `0`. */
export const BLANK = '—';

export const withUnit = (text: string, unit: string) => (unit ? `${text} ${unit}` : text);

export interface DayCells {
  /** The value as `metric.format` prints it (no unit), or BLANK. */
  value: string;
  /** The point's `partial` sentence, when it has one. */
  partial?: string;
  /** The average as formatted, or BLANK; null when the average is Off. */
  average: string | null;
}

const byDateCache = new WeakMap<MetricSeries, ReadonlyMap<string, TrendPoint>>();

/**
 * The series' points keyed by date. Built once per series (#270): a series is
 * never mutated, so every readout and announcement shares one map. Read only.
 */
export function pointsByDate(series: MetricSeries): ReadonlyMap<string, TrendPoint> {
  let m = byDateCache.get(series);
  if (!m) {
    m = new Map(series.points.map((p) => [p.date, p]));
    byDateCache.set(series, m);
  }
  return m;
}

/** What the table prints for `date` in this metric's columns. */
export function dayCells(
  metric: TrendMetric, series: MetricSeries, byDate: ReadonlyMap<string, TrendPoint>, date: string, avgDays: number,
): DayCells {
  const p = byDate.get(date);
  const avg = series.average.get(date);
  return {
    value: p ? metric.format(p.value) : BLANK,
    partial: p?.partial || undefined,
    average: avgDays > 0 ? (avg !== undefined ? metric.format(avg) : BLANK) : null,
  };
}

/** "53 bpm", or "—". The unit is never put beside a blank. */
export const valueText = (metric: TrendMetric, c: DayCells) =>
  c.value === BLANK ? BLANK : withUnit(c.value, metric.unit);

/** "7-day avg 52 bpm", or "7-day avg —"; null when the average is Off. */
export function averageText(metric: TrendMetric, c: DayCells, avgDays: number): string | null {
  if (c.average === null) return null;
  return `${avgDays}-day avg ${c.average === BLANK ? BLANK : withUnit(c.average, metric.unit)}`;
}

/** Line 2 of a card's readout: "53 bpm · 7-day avg 52 bpm", with any partial sentence. */
export function readoutLine(metric: TrendMetric, c: DayCells, avgDays: number): string {
  const parts = [valueText(metric, c)];
  if (c.partial) parts[0] += ` ${c.partial}`;
  const avg = averageText(metric, c, avgDays);
  if (avg) parts.push(avg);
  return parts.join(' · ');
}

/** The date as the table's row header writes it: "Fri, Aug 28". */
export const readoutDate = rowDate;

export interface AnnouncePart {
  metric: TrendMetric;
  series: MetricSeries;
}

/**
 * The status region's sentence: "Fri, Aug 28. Resting HR 53 bpm, 7-day avg
 * 52 bpm. HRV —." One clause per card, in group order.
 */
export function announceText(date: string, today: string, parts: readonly AnnouncePart[], avgDays: number): string {
  const clauses = parts.map(({ metric, series }) => {
    const c = dayCells(metric, series, pointsByDate(series), date, avgDays);
    const bits = [`${metric.label} ${valueText(metric, c)}${c.partial ? ` ${c.partial}` : ''}`];
    const avg = averageText(metric, c, avgDays);
    if (avg) bits.push(avg);
    return `${bits.join(', ')}.`;
  });
  return [`${readoutDate(date, today)}.`, ...clauses].join(' ');
}
