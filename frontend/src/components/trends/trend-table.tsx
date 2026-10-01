// The Trends table view (#242 AC4): every chart's values as rows, newest
// first, one row per day in the range including the blank ones. The page
// scrolls it — no height-capped inner box — and its header sticks to the page.
//
// Sideways scroll only when the table is wider than the column: an element
// with `overflow-x: auto` becomes a scroll container on both axes, which
// would stop the header sticking to the page, so the wrapper only gets it
// (`.trend-table-scroll`) once the table has measured wider than the column.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { openDayClick, openDayHref } from './open-day';
import type { TrendGroup } from './metrics';
import { RANGE_PHRASE, type RangeKey, type MetricSeries, rowDate } from './series';
import { dayCells, pointsByDate } from './readout';
import { rangeText } from './trend-chart';

interface Props {
  group: TrendGroup;
  /** One per metric of `group`, in order, built once by the screen (#270). */
  series: readonly MetricSeries[];
  range: RangeKey;
  avgDays: number;
  today: string;
}

// The roving tab stop (#255 AC4): one row link has tabindex 0, by date. It is
// remembered across the table's unmount so that after Back (a fresh mount) the
// next Tab lands on the row that was opened, not on the newest row, which would
// scroll the page back to the top of the table. In memory only, never persisted.
let rememberedStop: string | null = null;

/** Test hook: forget the remembered stop. */
export function resetTableStop(): void {
  rememberedStop = null;
}

const HINT_ID = 'trend-table-hint';
const HINT = 'Up and down arrows, Home, End, Page Up and Page Down move between days. Enter opens a day in the Day view.';
const WEEK = 7;

/** "Last 3 months" from "last 3 months". */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function TrendTable({ group, series: built, range, avgDays, today }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const [stop, setStop] = useState<string | null>(rememberedStop);
  useLayoutEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const check = () => {
      setScrolls(node.scrollWidth > node.clientWidth + 1);
      // The stuck header's height varies with the columns and their wrapping:
      // a focused row scrolls clear of it by this, not by a fixed offset.
      const head = node.querySelector('thead');
      if (head) node.style.setProperty('--trend-head-h', `${head.getBoundingClientRect().height}px`);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(node);
    if (node.firstElementChild) ro.observe(node.firstElementChild);
    return () => ro.disconnect();
  });

  const columns = group.metrics.map((metric, i) => {
    const series = built[i];
    const byDate = pointsByDate(series);
    return { metric, series, byDate };
  });
  const dates = columns[0]?.series.dates ?? [];
  const rows = [...dates].reverse();
  // Stays on the same date while it is still a row, else the newest.
  const active = stop !== null && rows.includes(stop) ? stop : rows[0];

  const onFocusIn = (e: FocusEvent) => {
    const date = (e.target as HTMLElement).closest?.('a.trend-row-link')?.getAttribute('data-date');
    if (!date) return;
    rememberedStop = date;
    setStop(date);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    const link = (e.target as HTMLElement).closest?.('a.trend-row-link');
    if (!link) return;
    const at = rows.indexOf(link.getAttribute('data-date') ?? '');
    if (at < 0) return;
    let target: number;
    switch (e.key) {
      case 'ArrowDown': target = at + 1; break;
      case 'ArrowUp': target = at - 1; break;
      case 'PageDown': target = at + WEEK; break;
      case 'PageUp': target = at - WEEK; break;
      case 'Home': target = 0; break;
      case 'End': target = rows.length - 1; break;
      default: return;
    }
    e.preventDefault();
    target = Math.min(rows.length - 1, Math.max(0, target));
    const next = wrap.current?.querySelector<HTMLElement>(`a.trend-row-link[data-date="${rows[target]}"]`);
    next?.focus();
  };

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
      aria-describedby={rows.length > 0 ? HINT_ID : undefined}
    >
      {rows.length > 0 && <p id={HINT_ID} class="sr-only">{HINT}</p>}
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
        <tbody onFocusCapture={onFocusIn} onKeyDown={onKeyDown}>
          {rows.map((date) => (
            <tr key={date}>
              <th scope="row">
                <a class="trend-row-link" href={openDayHref(date, today)} data-date={date}
                  tabIndex={date === active ? 0 : -1} onClick={(e) => {
                    // Safari and Firefox on macOS do not focus a clicked link: remember the row here too.
                    rememberedStop = date;
                    openDayClick(date, today)(e);
                  }}>
                  {rowDate(date, today)}<span aria-hidden="true">›</span>
                </a>
              </th>
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
