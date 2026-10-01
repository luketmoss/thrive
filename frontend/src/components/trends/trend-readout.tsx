// A card's readout (#247 AC2): the selected day's date, value and average,
// drawn in the same grid cell as the card's summary line and in the same type,
// so a selection changes the text and never the card's height.
//
// The date and value are hidden from assistive tech on purpose: a screen reader
// hears the day through the screen's one `role="status"` region, and only when
// the day is moved by keyboard (AC4). Moving a pointer must never talk.
//
// "Open day ›" (#254) is not hidden: it is a real link, `tabindex="-1"` so the
// cards add no tab stops (Enter on the charts is the keyboard's way). Its
// `::after` covers the whole cell, so the whole readout is the target.

import type { TrendMetric } from './metrics';
import { dayCells, pointsByDate, readoutDate, readoutLine } from './readout';
import type { MetricSeries } from './series';
import { weekdayMonthDay } from '../../day/format';
import { openDay, openDayHref } from './open-day';

interface Props {
  metric: TrendMetric;
  series: MetricSeries;
  date: string;
  avgDays: number;
  today: string;
}

/** "Friday, August 28", with the year when it is not this year. Screen-reader text. */
export function openDayName(date: string, today: string): string {
  const name = weekdayMonthDay(date);
  return date.slice(0, 4) === today.slice(0, 4) ? name : `${name}, ${date.slice(0, 4)}`;
}

export function TrendReadout({ metric, series, date, avgDays, today }: Props) {
  const cells = dayCells(metric, series, pointsByDate(series), date, avgDays);
  return (
    <div class="trend-readout" data-date={date}>
      <div class="trend-readout-head">
        <p class="trend-readout-date" aria-hidden="true">{readoutDate(date, today)}</p>
        <a class="trend-open-day" href={openDayHref(date)} tabIndex={-1}
          onClick={(e) => {
            // A modified click keeps the browser's own behaviour (new tab).
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            openDay(date);
          }}>
          Open day<span class="sr-only">{`, ${openDayName(date, today)}`}</span>{' '}
          <span aria-hidden="true">›</span>
        </a>
      </div>
      <p class="trend-readout-value" aria-hidden="true">{readoutLine(metric, cells, avgDays)}</p>
    </div>
  );
}
