// The Trends screen (#242): range, average and view controls, remembered on
// this device, over one group of metric cards or their table.
//
// Loads the health tabs once on entry if nothing has loaded them; every
// control then redraws from the rows already in memory, with no sheet read.

import { useEffect, useState } from 'preact/hooks';
import { useAuth } from '../../auth/auth-context';
import { loadHealth } from '../../state/actions';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { TREND_GROUPS, type TrendGroup, type TrendMetric } from './metrics';
import {
  RANGES, AVERAGES, VIEWS, type RangeKey, type AverageKey, type ViewKey,
  averageDays, earliestDate, localToday, metricSeries, rangeBounds,
} from './series';
import { RANGE_PREF, AVERAGE_PREF, VIEW_PREF, GROUP_PREF, readPref, writePref, type Pref } from './prefs';
import { GroupSwitcher } from './group-switcher';
import { TrendCharts } from './trend-chart';
import { TrendTable } from './trend-table';

interface SegmentedProps<T extends string> {
  label: string;
  id: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  tight?: boolean;
}

/** A labelled `.sub-type-toggle` group (#129): exactly one button pressed. */
function Segmented<T extends string>({ label, id, options, value, onChange, tight }: SegmentedProps<T>) {
  const labelId = `trends-${id}-label`;
  return (
    <div class="trends-control">
      <span class="trends-control-label" id={labelId}>{label}</span>
      <div class={`sub-type-toggle${tight ? ' trends-toggle-tight' : ''}`} role="group" aria-labelledby={labelId}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            class={`sub-type-btn${o === value ? ' active' : ''}`}
            aria-pressed={o === value ? 'true' : 'false'}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A control's state, read from and written to its remembered pref. */
function usePref<T extends string>(pref: Pref<T>): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(pref));
  return [value, (v: T) => {
    setValue(v);
    writePref(pref, v);
  }];
}

/** The caption: what the marks are, in words. */
export function captionText(avgDays: number, hasBand: boolean): string {
  const clauses = ['Dots are each day'];
  if (avgDays > 0) clauses.push(`line is the ${avgDays}-day average`);
  if (hasBand) clauses.push('shaded band is your range, the mean ± 1 SD of the 30 days before today');
  return `${clauses.join(' · ')}. Blank days stay blank.`;
}

/**
 * Whether the caption keeps its band clause: only when some rendered metric of
 * the group actually draws a band this range (`band: true` and enough data).
 * One banded card is enough; the clause stays generic.
 */
export function groupHasBand(
  metrics: readonly TrendMetric[],
  pointSets: readonly (readonly { date: string; value: number }[])[],
  from: string, to: string, avgDays: number, today: string,
): boolean {
  return metrics.some((m, i) => {
    if (!m.band) return false;
    const s = metricSeries(m, from, to, avgDays, today, pointSets[i] as never);
    return s.band !== null && s.points.length > 0;
  });
}

export function TrendsScreen() {
  const { token } = useAuth();
  const [range, setRange] = usePref<RangeKey>(RANGE_PREF);
  const [average, setAverage] = usePref<AverageKey>(AVERAGE_PREF);
  const [view, setView] = usePref<ViewKey>(VIEW_PREF);
  const [groupId, setGroupId] = usePref<string>(GROUP_PREF);

  useEffect(() => {
    if (!token) return;
    const idle = [dailyHealth, bodyMeasurements, dailySummary].some((s) => s.value.state === 'idle');
    if (idle) void loadHealth(token);
  }, [token]);

  const group: TrendGroup = TREND_GROUPS.find((g) => g.id === groupId) ?? TREND_GROUPS[0];
  // Only the tabs this group reads count: a Body group is neither held up by
  // DailyHealth nor spared by a BodyMeasurements failure.
  const sources = [...new Set(group.metrics.map((m) => m.source ?? 'dailyHealth'))];
  const states = sources.map((s) => (s === 'bodyMeasurements' ? bodyMeasurements : dailyHealth).value.state);
  const today = localToday();
  const avgDays = averageDays(average);

  let content;
  if (states.includes('error')) {
    content = (
      <div class="trends-error" role="alert">
        <p>Couldn't load your health data.</p>
        <button type="button" class="btn btn-secondary trends-retry" onClick={() => token && void loadHealth(token)}>
          Try again
        </button>
      </div>
    );
  } else if (states.some((s) => s !== 'loaded')) {
    content = <p class="trends-loading" role="status">Loading…</p>;
  } else {
    const pointSets = group.metrics.map((m) => m.points());
    const { from, to } = rangeBounds(range, today, earliestDate(pointSets));
    // The band clause stays only while some card actually draws a band.
    const hasBand = groupHasBand(group.metrics, pointSets, from, to, avgDays, today);
    const nothingEver = pointSets.every((p) => p.length === 0);
    content = (
      <>
        <p class="trends-caption">{captionText(avgDays, hasBand)}</p>
        {view === 'Table' && !nothingEver ? (
          <TrendTable group={group} from={from} to={to} range={range} avgDays={avgDays} today={today} />
        ) : (
          <TrendCharts group={group} from={from} to={to} range={range} avgDays={avgDays} today={today} />
        )}
      </>
    );
  }

  return (
    <div class="screen trends-screen">
      <header class="screen-header">
        <h1>Trends</h1>
      </header>
      <div class="screen-body">
        <GroupSwitcher groups={TREND_GROUPS} value={group.id} onChange={setGroupId} />
        <div class="trends-controls">
          <Segmented label="Range" id="range" options={RANGES} value={range} onChange={setRange} tight />
          <Segmented label="Average" id="average" options={AVERAGES} value={average} onChange={setAverage} />
          <Segmented label="View" id="view" options={VIEWS} value={view} onChange={setView} />
        </div>
        {content}
      </div>
    </div>
  );
}
