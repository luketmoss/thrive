// The Trends table view (#242 AC4): every chart's values as rows, newest
// first, one row per day in the range including the blank ones. The page
// scrolls it — no height-capped inner box — and its header sticks to the page.
//
// Sideways scroll only when the table is wider than the column: an element
// with `overflow-x: auto` becomes a scroll container on both axes, which
// would stop the header sticking to the page, so the wrapper only gets it
// (`.trend-table-scroll`) once the table has measured wider than the column.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { TrendGroup } from './metrics';
import { RANGE_PHRASE, type RangeKey, metricSeries, rowDate } from './series';
import { dayCells, pointsByDate } from './readout';
import { rangeText } from './trend-chart';

interface Props {
  group: TrendGroup;
  from: string;
  to: string;
  range: RangeKey;
  avgDays: number;
  today: string;
}

/** "Last 3 months" from "last 3 months". */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TrendTable({ group, from, to, range, avgDays, today }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const check = () => setScrolls(node.scrollWidth > node.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(node);
    if (node.firstElementChild) ro.observe(node.firstElementChild);
    return () => ro.disconnect();
  });

  const columns = group.metrics.map((metric) => {
    const series = metricSeries(metric, from, to, avgDays, today);
    const byDate = pointsByDate(series);
    return { metric, series, byDate };
  });
  const dates = columns[0]?.series.dates ?? [];
  const rows = [...dates].reverse();

  const captionParts = [`${capitalise(RANGE_PHRASE[range])}.`];
  for (const { metric, series } of columns) {
    const r = rangeText(metric, series, today);
    if (r) captionParts.push(`${metric.label}: ${r.charAt(0).toLowerCase()}${r.slice(1)}.`);
  }
  const regionLabel = `${group.metrics.length === 1 ? group.metrics[0].label : group.label} table`;

  return (
    <div
      class={`trend-table-wrap${scrolls ? ' trend-table-scroll' : ''}`}
      ref={wrap}
      role="region"
      tabIndex={0}
      aria-label={regionLabel}
    >
      <table class="trend-table">
        <caption>{captionParts.join(' ')}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {columns.map(({ metric }) => [
              <th scope="col" key={metric.id}>
                {metric.label}{metric.unit ? ` (${metric.unit})` : ''}
              </th>,
              avgDays > 0 && <th scope="col" key={`${metric.id}-avg`}>{avgDays}-day avg</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.map((date) => (
            <tr key={date}>
              <th scope="row">{rowDate(date, today)}</th>
              {columns.map(({ metric, series, byDate }) => {
                const c = dayCells(metric, series, byDate, date, avgDays);
                return [
                  <td key={metric.id}>
                    {c.value}
                    {c.partial && <span class="trend-partial"> {c.partial}</span>}
                  </td>,
                  avgDays > 0 && <td key={`${metric.id}-avg`}>{c.average}</td>,
                ];
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
