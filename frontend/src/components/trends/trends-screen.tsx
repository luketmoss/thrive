// The Trends screen (#242): range, average and view controls, remembered on
// this device, over one group of metric cards or their table.
//
// Loads the health tabs once on entry if nothing has loaded them; every
// control then redraws from the rows already in memory, with no sheet read.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { useAuth } from '../../auth/auth-context';
import { loadHealth } from '../../state/actions';
import { dailyHealth, bodyMeasurements, dailySummary } from '../../state/store';
import { TREND_GROUPS, CUSTOM_GROUP_ID, customGroup, type TrendGroup, type TrendMetric } from './metrics';
import {
  RANGES, AVERAGES, VIEWS, type RangeKey, type AverageKey, type ViewKey,
  averageDays, earliestDate, metricSeries, rangeBounds, usablePoints, type MetricSeries,
} from './series';
import { announceText } from './readout';
import { RANGE_PREF, AVERAGE_PREF, VIEW_PREF, GROUP_PREF, readPref, writePref, readCustom, writeCustom, type Pref } from './prefs';
import { CustomMetricsPicker } from './custom-metrics-picker';
import { GroupSwitcher } from './group-switcher';
import { TrendCharts } from './trend-chart';
import { TrendTable } from './trend-table';
import { openDay } from './open-day';
import { isRestoringFocus, ROUTE_FOCUS_ATTR } from '../../router/route-focus';
import { useFocusHandoff } from '../focus-handoff';
import { today as todaySignal, watchToday } from '../../day/today';

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
const HINT = 'Left and right arrows read one day at a time. Enter opens it in the Day view. The table view lists every day.';

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
export function groupHasBand(metrics: readonly TrendMetric[], series: readonly MetricSeries[]): boolean {
  return metrics.some((m, i) => m.band && series[i].band !== null && series[i].points.length > 0);
}

/**
 * One container for the error and loading states (#290), so it is the same node
 * through error, loading, error again. Try again focuses it at the press (the
 * button is replaced by "Loading…" at once); when the data lands and it goes,
 * focus passes to the screen's heading, not the charts (focusing them selects a day).
 */
function TrendsState({ children }: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusHandoff(
    ref,
    (el) => el.closest('.trends-screen')?.querySelector<HTMLElement>('h1'),
    // The heading is not a control: no ring, as #256's route focus.
    (h) => {
      h.setAttribute(ROUTE_FOCUS_ATTR, '');
      h.addEventListener('blur', () => h.removeAttribute(ROUTE_FOCUS_ATTR), { once: true });
    },
  );
  return <div class="trends-state" tabIndex={-1} ref={ref}>{children}</div>;
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

  // One clock (#286): America/Denver's date, as the Day view reads it. Read once
  // per render, so the chart, table, link and Enter can never see two todays.
  const today = todaySignal.value;
  useEffect(() => watchToday(), []);
  // A rollover changes what the days are, so it clears the selection like any
  // control that does (#247 AC5). It does not re-fetch health.
  useEffect(() => { clearSelection(); }, [today]);

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
  // One object per custom set, so the series memo below can key on it.
  const group: TrendGroup = useMemo(() => (isCustom ? customGroup(custom) : picked), [picked, isCustom, custom]);
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
  const avgDays = averageDays(average);

  const ready = !states.includes('error') && states.every((s) => s === 'loaded')
    && !(isCustom && group.metrics.length === 0);
  // Each metric's series, built once per (group, range, average, today, rows of
  // the tabs it reads) and shared by the band check, the cards or table, the
  // readout and the keyboard announcement (#270). A selection changes none of
  // these, so it rebuilds nothing. The rows are keyed by reference: a reload
  // writes a new array, so a series is never stale.
  const rowsOf = (s: keyof typeof tabs) => {
    const v = tabs[s].value;
    return sources.includes(s) && v.state === 'loaded' ? v.rows : null;
  };
  const built = useMemo(() => {
    if (!ready) return null;
    const pointSets = group.metrics.map((m) => m.points());
    // All begins at the earliest day that is drawn: a metric that excludes today
    // does not count today's value (AC6).
    const earliest = earliestDate(pointSets.map((p, i) => usablePoints(group.metrics[i], p, today)));
    const { from, to } = rangeBounds(range, today, earliest);
    const series = group.metrics.map((m, i) => metricSeries(m, from, to, avgDays, today, pointSets[i]));
    return {
      from, to, series,
      recorded: pointSets.map((p) => p.length > 0),
      nothingEver: pointSets.every((p) => p.length === 0),
      hasBand: groupHasBand(group.metrics, series),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, group, range, avgDays, today, rowsOf('dailyHealth'), rowsOf('bodyMeasurements'), rowsOf('dailySummary')]);

  let content;
  if (states.includes('error')) {
    content = (
      <TrendsState>
        <div class="trends-error" role="alert">
          <p>Couldn't load your health data.</p>
          <button
            type="button"
            class="btn btn-secondary trends-retry"
            onClick={(e) => {
              // Before the button is replaced by "Loading…" (#290).
              (e.currentTarget as HTMLElement).closest<HTMLElement>('.trends-state')?.focus();
              if (token) void loadHealth(token);
            }}
          >
            Try again
          </button>
        </div>
      </TrendsState>
    );
  } else if (states.some((s) => s !== 'loaded')) {
    content = <TrendsState><p class="trends-loading" role="status">Loading…</p></TrendsState>;
  } else if (isCustom && group.metrics.length === 0) {
    content = <p class="trends-custom-empty">Pick up to 4 metrics to see them here.</p>;
  } else if (built) {
    const { to, series, recorded, nothingEver, hasBand } = built;
    const dates = series[0]?.dates ?? [];
    // Keyboard moves select and announce; pointer moves only select (AC4).
    const moveTo = (date: string) => {
      selectedDay.value = date;
      announcement.value = announceText(
        date, today,
        group.metrics.flatMap((metric, i) =>
          series[i].points.length ? [{ metric, series: series[i] }] : []),
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
      else if (e.key === 'Enter') {
        // Opens the selected day, as the readout's link does. Nothing selected: nothing.
        if (selectedDay.value === null) return;
        e.preventDefault();
        openDay(selectedDay.value, today);
        return;
      } else if (e.key === 'Escape') {
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
          <TrendTable group={group} series={series} range={range} avgDays={avgDays} today={today} />
        ) : (
          <div
            class="trend-charts"
            data-focus-key="trend-charts"
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
              // Arriving by Tab selects today and says so; a press does not,
              // nor does Back restoring focus here (#256 AC5).
              const press = pointerFocus.current;
              pointerFocus.current = false;
              if (!press && !isRestoringFocus() && selectedDay.value === null) moveTo(to);
            }}
            onBlur={(e) => {
              // Pressing "Open day" moves focus to the link inside; the day must outlast that.
              if (charts.current?.contains((e as FocusEvent).relatedTarget as Node | null)) return;
              clearSelection();
            }}
            onKeyDown={onKeyDown}
          >
            <p class="sr-only" id={HINT_ID}>{HINT}</p>
            <TrendCharts group={group} series={series} recorded={recorded} range={range} avgDays={avgDays} today={today}
              selectedDate={selectedDay.value} onSelect={(d) => { selectedDay.value = d; }} />
          </div>
        )}
      </>
    );
  }

  return (
    <div class="screen trends-screen">
      <header class="screen-header">
        <h1 tabIndex={-1}>Trends</h1>
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
