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
  RANGE_PHRASE, type RangeKey, dateTicks, dayAtX, metricSeries, segments, tickLabel, windowText, yDomain,
  type MetricSeries,
} from './series';
import { withUnit } from './readout';
import { TrendReadout } from './trend-readout';

/** Width drawn before the card has been measured (and in jsdom). */
export const DEFAULT_CHART_WIDTH = 300;
export const CHART_HEIGHT = 180;
/** Fixed, not fitted to the labels, so stacked cards share their x positions. */
export const PAD_LEFT = 40;
const PAD_TOP = 8;
const PAD_RIGHT = 6;
const PAD_BOTTOM = 22;
const MIN_DOT_R = 1.5;
/** Centre-line radius of the selected day's marker: 4 px of fill inside a 2 px ring. */
const MARKER_R = 5;

/** "resting HR" from "Resting HR": the label mid-sentence. */
export function midSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

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
  /** The day the group has selected (#247), if any. */
  selectedDate?: string | null;
  /** A pointer chose a day. The screen decides what that means. */
  onSelect?: (date: string) => void;
}

/** The SVG itself. Exported for tests; cards use it through TrendCard. */
export function TrendPlot({ metric, series, width, label, describedBy, selectedDate, onSelect }: PlotProps) {
  const values = series.points.map((p) => p.value);
  for (const v of series.average.values()) values.push(v);
  const dom = yDomain(values, series.band, metric.zeroBased);
  const tickLabels = dom.ticks.map((t) => (metric.axisFormat ? metric.axisFormat(t, dom.ticks) : tickLabel(t, dom.ticks)));
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
  const selected = selectedDate && index.has(selectedDate) ? selectedDate : null;
  const selectedPoint = selected ? series.points.find((p) => p.date === selected) : undefined;

  // Pointer x → plot x, through the svg's own scale (it is width:100%), → a day.
  const pick = (e: PointerEvent) => {
    if (!onSelect) return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width > 0 ? width / rect.width : 1;
    onSelect(dayAtX(series.dates, (e.clientX - rect.left) * scale, padLeft, plotW));
  };

  return (
    <svg
      class="trend-plot"
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      width={width}
      height={CHART_HEIGHT}
      onPointerDown={pick}
      onPointerMove={pick}
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
      {selected && (
        <g class="trend-selection" pointer-events="none">
          <line class="trend-hairline" x1={x(selected)} x2={x(selected)} y1={PAD_TOP} y2={PAD_TOP + plotH}
            stroke="var(--color-text-secondary)" stroke-width={1} />
          {selectedPoint && (selectedPoint.partial !== undefined ? (
            <circle class="trend-marker trend-marker-partial" cx={x(selected)} cy={y(selectedPoint.value)} r={MARKER_R}
              fill="var(--color-surface)" stroke="var(--color-text)" stroke-width={2} />
          ) : (
            <circle class="trend-marker" cx={x(selected)} cy={y(selectedPoint.value)} r={MARKER_R}
              fill="var(--color-text)" stroke="var(--color-surface)" stroke-width={2} />
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
  selectedDate?: string | null;
  onSelect?: (date: string) => void;
}

/** One metric's card: header, summary line and the plot, or its empty state. */
export function TrendCard({ metric, from, to, range, avgDays, today, selectedDate, onSelect }: CardProps) {
  const [measure, width] = useWidth();
  const all = metric.points();
  const series = metricSeries(metric, from, to, avgDays, today, all);
  const headingId = `trend-${metric.id}-heading`;
  const summaryId = `trend-${metric.id}-summary`;
  const noteId = `trend-${metric.id}-note`;
  // A note ("Outdoor only", #245) is a caveat on the number: announced with the summary.
  const describedBy = metric.note ? `${noteId} ${summaryId}` : summaryId;
  let body;
  if (all.length === 0) {
    body = <p class="trend-empty">Nothing recorded yet.</p>;
  } else if (series.points.length === 0) {
    body = <p class="trend-empty">No {midSentence(metric.label)} in this range.</p>;
  } else {
    body = (
      <>
        {/* Summary and readout share one grid cell, so a selection never moves the card.
            The summary stays in the DOM, only hidden, for the chart's aria-describedby. */}
        <div class={`trend-readout-cell${selectedDate ? ' has-readout' : ''}`}>
          <p class="trend-summary" id={summaryId}>{summaryText(metric, series, today)}</p>
          {selectedDate && series.dates.includes(selectedDate) && (
            <TrendReadout metric={metric} series={series} date={selectedDate} avgDays={avgDays} today={today} />
          )}
        </div>
        <div class="trend-plot-wrap" ref={measure}>
          <TrendPlot metric={metric} series={series} width={width}
            label={`${metric.label}, ${RANGE_PHRASE[range]}`} describedBy={describedBy}
            selectedDate={selectedDate} onSelect={onSelect} />
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
      {metric.note && <p class="trend-note" id={noteId}>{metric.note}</p>}
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
  selectedDate?: string | null;
  onSelect?: (date: string) => void;
}

/** A group as stacked cards, all on the same from..to and so the same x positions. */
export function TrendCharts({ group, from, to, range, avgDays, today, selectedDate, onSelect }: ChartsProps) {
  return (
    <div class="trend-cards">
      {group.metrics.map((m) => (
        <TrendCard key={m.id} metric={m} from={from} to={to} range={range} avgDays={avgDays} today={today}
          selectedDate={selectedDate} onSelect={onSelect} />
      ))}
    </div>
  );
}
