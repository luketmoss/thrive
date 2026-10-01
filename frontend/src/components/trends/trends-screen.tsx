// The Trends screen (#242): range, average and view controls, remembered on
// this device, over one group of metric cards or their table.
//
// Loads the health tabs once on entry if nothing has loaded them; every
// control then redraws from the rows already in memory, with no sheet read.

import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { useAuth } from '../../auth/auth-context';
import { loadHealth } from '../../state/actions';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { TREND_GROUPS, CUSTOM_GROUP_ID, customGroup, type TrendGroup, type TrendMetric } from './metrics';
import {
  RANGES, AVERAGES, VIEWS, type RangeKey, type AverageKey, type ViewKey,
  averageDays, earliestDate, localToday, metricSeries, rangeBounds, datesBetween,
} from './series';
import { announceText } from './readout';
import { RANGE_PREF, AVERAGE_PREF, VIEW_PREF, GROUP_PREF, readPref, writePref, readCustom, writeCustom, type Pref } from './prefs';
import { CustomMetricsPicker } from './custom-metrics-picker';
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

/**
 * The day the charts have selected (#247), or null. Module-level, owned by this
 * screen and passed down to each card. Never stored: not in localStorage, not
 * in the URL. It lasts as long as the view it was made in (AC5).
 */
export const selectedDay = signal<string | null>(null);
/** What the screen-reader status region says. Written by the keyboard only. */
export const announcement = signal('');

const HINT_ID = 'trends-charts-hint';
const HINT = 'Left and right arrows read one day at a time. The table view lists every day.';

function clearSelection() {
  selectedDay.value = null;
  announcement.value = '';
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
  const [custom, setCustomIds] = useState<string[]>(readCustom);
  const [picking, setPicking] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const charts = useRef<HTMLDivElement>(null);
  // Set by a pointer press so the focus it causes is not mistaken for Tab arrival.
  // On touch the browser moves focus after pointerup, so it is cleared by the
  // focus itself, a click, a cancel, or any key press (Tab arrives after a keydown).
  const pointerFocus = useRef(false);

  // A selection lives only as long as the view it was made in: leaving the
  // screen clears it, and so does a tap or click outside the charts.
  useEffect(() => {
    clearSelection();
    const anyKey = () => { pointerFocus.current = false; };
    document.addEventListener('keydown', anyKey, true);
    const outside = (e: Event) => {
      if (selectedDay.value !== null && !charts.current?.contains(e.target as Node)) clearSelection();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', anyKey, true);
      clearSelection();
    };
  }, []);
  // A control that changes what the days are clears the day. Average does not.
  const clearing = <T,>(set: (v: T) => void) => (v: T) => {
    clearSelection();
    set(v);
  };

  useEffect(() => {
    if (!token) return;
    const idle = [dailyHealth, bodyMeasurements, dailySummary].some((s) => s.value.state === 'idle');
    if (idle) void loadHealth(token);
  }, [token]);

  const picked: TrendGroup = TREND_GROUPS.find((g) => g.id === groupId) ?? TREND_GROUPS[0];
  const isCustom = picked.id === CUSTOM_GROUP_ID;
  const group: TrendGroup = isCustom ? customGroup(custom) : picked;
  const setCustom = (ids: string[]) => {
    clearSelection();
    setCustomIds(ids);
    writeCustom(ids);
  };
  const closePicker = () => {
    setPicking(false);
    editButton.current?.focus();
  };
  // Only the tabs this group reads count: a Body group is neither held up by
  // DailyHealth nor spared by a BodyMeasurements failure. A custom set reads
  // exactly the union of its metrics' tabs, and none when nothing is picked.
  const sources = [...new Set(group.metrics.map((m) => m.source ?? 'dailyHealth'))];
  const tabs = { dailyHealth, bodyMeasurements, dailySummary };
  const states = sources.map((s) => tabs[s].value.state);
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
  } else if (isCustom && group.metrics.length === 0) {
    content = <p class="trends-custom-empty">Pick up to 4 metrics to see them here.</p>;
  } else {
    const pointSets = group.metrics.map((m) => m.points());
    const { from, to } = rangeBounds(range, today, earliestDate(pointSets));
    // The band clause stays only while some card actually draws a band.
    const hasBand = groupHasBand(group.metrics, pointSets, from, to, avgDays, today);
    const nothingEver = pointSets.every((p) => p.length === 0);
    const dates = datesBetween(from, to);
    // Keyboard moves select and announce; pointer moves only select (AC4).
    const moveTo = (date: string) => {
      selectedDay.value = date;
      announcement.value = announceText(
        date, today,
        group.metrics.flatMap((metric) => {
          const series = metricSeries(metric, from, to, avgDays, today);
          return series.points.length ? [{ metric, series }] : [];
        }),
        avgDays,
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const at = selectedDay.value === null ? -1 : dates.indexOf(selectedDay.value);
      let next: number;
      if (e.key === 'ArrowLeft') next = at < 0 ? dates.length - 1 : Math.max(0, at - 1);
      else if (e.key === 'ArrowRight') next = at < 0 ? dates.length - 1 : Math.min(dates.length - 1, at + 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = dates.length - 1;
      else if (e.key === 'Escape') {
        e.preventDefault();
        clearSelection();
        return;
      } else return;
      e.preventDefault();
      moveTo(dates[next]);
    };
    content = (
      <>
        <p class="trends-caption">{captionText(avgDays, hasBand)}</p>
        {view === 'Table' && !nothingEver ? (
          <TrendTable group={group} from={from} to={to} range={range} avgDays={avgDays} today={today} />
        ) : (
          <div
            class="trend-charts"
            ref={charts}
            tabIndex={0}
            role="group"
            aria-label={`${group.label} charts`}
            aria-describedby={HINT_ID}
            onPointerDown={() => { pointerFocus.current = true; }}
            onClick={() => { pointerFocus.current = false; }}
            onPointerCancel={() => { pointerFocus.current = false; }}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') clearSelection(); }}
            onFocus={() => {
              // Arriving by Tab selects today and says so; a press does not.
              const press = pointerFocus.current;
              pointerFocus.current = false;
              if (!press && selectedDay.value === null) moveTo(to);
            }}
            onBlur={clearSelection}
            onKeyDown={onKeyDown}
          >
            <p class="sr-only" id={HINT_ID}>{HINT}</p>
            <TrendCharts group={group} from={from} to={to} range={range} avgDays={avgDays} today={today}
              selectedDate={selectedDay.value} onSelect={(d) => { selectedDay.value = d; }} />
          </div>
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
        <GroupSwitcher groups={TREND_GROUPS} value={group.id} onChange={clearing(setGroupId)} />
        <div class="trends-controls">
          <Segmented label="Range" id="range" options={RANGES} value={range} onChange={clearing(setRange)} tight />
          <Segmented label="Average" id="average" options={AVERAGES} value={average} onChange={setAverage} />
          <Segmented label="View" id="view" options={VIEWS} value={view} onChange={clearing(setView)} />
        </div>
        {isCustom && (
          <div class="trends-custom-head">
            <button type="button" class="btn btn-secondary trends-custom-edit" ref={editButton} onClick={() => setPicking(true)}>
              Edit metrics
            </button>
          </div>
        )}
        {content}
        <p class="sr-only" role="status" id="trends-announce">{announcement.value}</p>
        {picking && <CustomMetricsPicker selected={custom} onChange={setCustom} onClose={closePicker} />}
      </div>
    </div>
  );
}
