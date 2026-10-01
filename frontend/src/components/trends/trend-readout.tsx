// A card's readout (#247 AC2): the selected day's date, value and average,
// drawn in the same grid cell as the card's summary line and in the same type,
// so a selection changes the text and never the card's height.
//
// Hidden from assistive tech on purpose: a screen reader hears the day through
// the screen's one `role="status"` region, and only when the day is moved by
// keyboard (AC4). Moving a pointer must never talk.
//
// #254 adds "Open day ›" to this component, after the value line. It is not
// here yet: a tap on a chart selects, so the link must be its own control.

import type { TrendMetric } from './metrics';
import { dayCells, pointsByDate, readoutDate, readoutLine } from './readout';
import type { MetricSeries } from './series';

interface Props {
  metric: TrendMetric;
  series: MetricSeries;
  date: string;
  avgDays: number;
  today: string;
}

export function TrendReadout({ metric, series, date, avgDays, today }: Props) {
  const cells = dayCells(metric, series, pointsByDate(series), date, avgDays);
  return (
    <div class="trend-readout" aria-hidden="true" data-date={date}>
      <p class="trend-readout-date">{readoutDate(date, today)}</p>
      <p class="trend-readout-value">{readoutLine(metric, cells, avgDays)}</p>
    </div>
  );
}
