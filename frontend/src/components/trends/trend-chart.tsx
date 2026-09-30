// The Trends chart primitive (#242 AC2, AC3): one card per metric, each day a
// dot, the rolling average a line that breaks at every gap, and "your range"
// a flat band behind both. Hand-rolled inline SVG, no chart library: every
// mark stays in the DOM, and `var(--chart-*)` follows the theme with no
// redraw. A change of range or average is a swap, never an animation.
//
// Charts show and never conclude: no arrows, no comparisons, no good/bad
// colour, no judging words.

import { useLayoutEffect, useState } from 'preact/hooks';
import type { TrendGroup, TrendMetric } from './metrics';
import {
  RANGE_PHRASE, type RangeKey, dateTicks, metricSeries, segments, windowText, yDomain,
  type MetricSeries,
} from './series';

/** Width drawn before the card has been measured (and in jsdom). */
export const DEFAULT_CHART_WIDTH = 300;
export const CHART_HEIGHT = 180;
/** Fixed, not fitted to the labels, so stacked cards share their x positions. */
export const PAD_LEFT = 40;
const PAD_TOP = 8;
const PAD_RIGHT = 6;
const PAD_BOTTOM = 22;
const MIN_DOT_R = 1.5;

/** "resting HR" from "Resting HR": the label mid-sentence. */
export function midSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

const withUnit = (text: string, unit: string) => (unit ? `${text} ${unit}` : text);

/** "Your range 48–56 bpm (Aug 28 – Sep 26)". */
export function rangeText(metric: TrendMetric, s: MetricSeries, today: string): string | null {
  if (!s.band) return null;
  const { lo, hi, from, to } = s.band;
  return `${withUnit(`Your range ${metric.format(lo)}–${metric.format(hi)}`, metric.unit)} ${windowText(from, to, today)}`;
}

/** The card's summary line: average, coverage, your range. */
export function summaryText(metric: TrendMetric, s: MetricSeries, today: string): string {
  const out: string[] = [];
  if (s.mean !== null) out.push(withUnit(`Average ${metric.format(s.mean)}`, metric.unit));
  out.push(`${s.covered} of ${s.dates.length} days`);
  const r = rangeText(metric, s, today);
  if (r) out.push(r);
  return out.join(' · ');
}

/** Tracks an element's content width, for a chart that takes its card's width. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(DEFAULT_CHART_WIDTH);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const w = Math.floor(node.clientWidth);
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [setNode, width];
}

interface PlotProps {
  metric: TrendMetric;
  series: MetricSeries;
  width: number;
  label: string;
  describedBy: string;
}

/** The SVG itself. Exported for tests; cards use it through TrendCard. */
export function TrendPlot({ metric, series, width, label, describedBy }: PlotProps) {
  const values = series.points.map((p) => p.value);
  for (const v of series.average.values()) values.push(v);
  const dom = yDomain(values, series.band, metric.zeroBased);
  const axisFmt = metric.axisFormat ?? metric.format;
  const tickLabels = dom.ticks.map((t) => axisFmt(t));
  const padLeft = PAD_LEFT;
  const plotW = Math.max(40, width - padLeft - PAD_RIGHT);
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const n = series.dates.length;
  const slot = plotW / n;
  const index = new Map(series.dates.map((d, i) => [d, i]));
  const x = (date: string) => padLeft + (index.get(date)! + 0.5) * slot;
  const y = (v: number) => PAD_TOP + (1 - (v - dom.min) / (dom.max - dom.min || 1)) * plotH;
  const r = Math.min(3.5, Math.max(MIN_DOT_R, slot * 0.35));
  const avgPoints = [...series.average].map(([date, value]) => ({ date, value }));
  const xTicks = dateTicks(series.dates[0], series.dates[n - 1], plotW);

  return (
    <svg
      class="trend-plot"
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      width={width}
      height={CHART_HEIGHT}
    >
      {series.band && (() => {
        const top = y(series.band.hi);
        const h = Math.max(1, y(series.band.lo) - top);
        return (
          <rect class="trend-band" x={padLeft} y={h === 1 ? top - 0.5 : top} width={plotW} height={h}
            fill="var(--chart-band)" />
        );
      })()}
      <g class="trend-grid">
        {dom.ticks.map((t, i) => (
          <g key={t}>
            <line x1={padLeft} x2={padLeft + plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" stroke-width={1} />
            <text x={padLeft - 6} y={y(t)} text-anchor="end" dominant-baseline="middle" class="trend-axis-label">
              {tickLabels[i]}
            </text>
          </g>
        ))}
      </g>
      <g class="trend-x-axis">
        {xTicks.map((t) => (
          <text key={t.date} x={x(t.date)} y={CHART_HEIGHT - 6} text-anchor="middle" class="trend-axis-label">
            {t.label}
          </text>
        ))}
      </g>
      <g class="trend-dots">
        {series.points.map((p) => p.partial !== undefined ? (
          <circle key={p.date} class="trend-dot trend-dot-partial" data-date={p.date} cx={x(p.date)} cy={y(p.value)}
            r={Math.max(r, 2)} fill="var(--color-surface)" stroke="var(--chart-dot)" stroke-width={1.5} />
        ) : (
          <circle key={p.date} class="trend-dot" data-date={p.date} cx={x(p.date)} cy={y(p.value)} r={r}
            fill="var(--chart-dot)" />
        ))}
      </g>
      {avgPoints.length > 0 && (
        <g class="trend-average">
          {segments(avgPoints).map((seg) => (
            <path key={seg[0].date} class="trend-line" fill="none" stroke="var(--chart-line)" stroke-width={2}
              stroke-linejoin="round" stroke-linecap="round"
              d={seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ')
                + (seg.length === 1 ? ' l0 0' : '')} />
          ))}
        </g>
      )}
    </svg>
  );
}

interface CardProps {
  metric: TrendMetric;
  from: string;
  to: string;
  range: RangeKey;
  avgDays: number;
  today: string;
}

/** One metric's card: header, summary line and the plot, or its empty state. */
export function TrendCard({ metric, from, to, range, avgDays, today }: CardProps) {
  const [measure, width] = useWidth();
  const all = metric.points();
  const series = metricSeries(metric, from, to, avgDays, today, all);
  const headingId = `trend-${metric.id}-heading`;
  const summaryId = `trend-${metric.id}-summary`;
  let body;
  if (all.length === 0) {
    body = <p class="trend-empty">Nothing recorded yet.</p>;
  } else if (series.points.length === 0) {
    body = <p class="trend-empty">No {midSentence(metric.label)} in this range.</p>;
  } else {
    body = (
      <>
        <p class="trend-summary" id={summaryId}>{summaryText(metric, series, today)}</p>
        <div class="trend-plot-wrap" ref={measure}>
          <TrendPlot metric={metric} series={series} width={width}
            label={`${metric.label}, ${RANGE_PHRASE[range]}`} describedBy={summaryId} />
        </div>
      </>
    );
  }
  return (
    <section class="trend-card" aria-labelledby={headingId} data-metric={metric.id}>
      <h2 class="trend-card-title" id={headingId}>
        {metric.label}
        {metric.unit && <span class="trend-unit"> {metric.unit}</span>}
      </h2>
      {metric.note && <p class="trend-note">{metric.note}</p>}
      {body}
    </section>
  );
}

interface ChartsProps {
  group: TrendGroup;
  from: string;
  to: string;
  range: RangeKey;
  avgDays: number;
  today: string;
}

/** A group as stacked cards, all on the same from..to and so the same x positions. */
export function TrendCharts({ group, from, to, range, avgDays, today }: ChartsProps) {
  return (
    <div class="trend-cards">
      {group.metrics.map((m) => (
        <TrendCard key={m.id} metric={m} from={from} to={to} range={range} avgDays={avgDays} today={today} />
      ))}
    </div>
  );
}
