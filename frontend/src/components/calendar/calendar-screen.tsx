// #241 — the Calendar screen: a month grid reached from the Day header,
// addressed by `#/calendar[/YYYY-MM]`. Each day shows its workout marks and
// whether it has a journal entry; the grid can be shaded by one health
// metric; tapping a day shows a read-only summary with a link into its Day.
//
// Moving between months replaces the history entry (`replaceRoute`), as the
// Day screen does between days. It reads only signals already in memory,
// loading health and the journal on show through their own throttles.

import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useAuth } from '../../auth/auth-context';
import { currentRoute, goBack, replaceRoute } from '../../router/router';
import { dailyHealth, journalEntries, workouts } from '../../state/store';
import { healthRefresh, journalRefresh, loadHealth } from '../../state/actions';
import type { WorkoutWithRow } from '../../api/types';
import { formatDuration } from '../../api/duration';
import { dayHref, dayStateOf } from '../../day/dates';
import { dayOfMonth, weekdayMonthDay } from '../../day/format';
import { today as todaySignal, watchToday } from '../../day/today';
import { addMonths, calendarHref, gridRange, monthOf, monthTitle, parseCalendarPath } from '../../calendar/dates';
import { markKinds, marksFor } from '../../calendar/marks';
import {
  formatValue, metricWords, readShade, shadeChoices, shadeMonth, writeShade,
  type ShadeChoice, type ShadeKey,
} from '../../calendar/shade';
import { seriesOf } from '../day/health-rows';
import { trainingOrder } from '../day/training-panel';
import { PanelStatus } from '../day/panel';
import { useSwipe } from '../day/use-swipe';

const NOTE_PREVIEW = 60;

/** The day selected when a month opens: today if it is in the month, else the 1st. */
export function initialSelection(month: string, today: string): string {
  return monthOf(today) === month ? today : `${month}-01`;
}

/** A note's first 60 characters, whitespace collapsed, with "…" when longer. */
export function notePreview(note: string): string {
  const flat = note.replace(/\s+/g, ' ').trim();
  return flat.length > NOTE_PREVIEW ? `${flat.slice(0, NOTE_PREVIEW).trimEnd()}…` : flat;
}

/** "bike · mountain", or the type alone. */
const typeWords = (w: WorkoutWithRow) => (w.sub_type ? `${w.type} · ${w.sub_type}` : w.type);

/**
 * A cell's accessible name: the date, then activity, journal and (when
 * shading is on) the metric in words, so nothing is said by colour alone.
 * "Saturday, September 12, Mountain Bike, 1 planned, journal entry, resting HR 52 bpm".
 */
export function cellLabel(
  date: string,
  day: readonly WorkoutWithRow[],
  hasNote: boolean,
  shade: ShadeChoice,
  value: number | undefined,
): string {
  const parts = [weekdayMonthDay(date)];
  for (const w of day) if (w.status !== 'planned') parts.push(w.name || w.type);
  const planned = day.filter((w) => w.status === 'planned').length;
  if (planned > 0) parts.push(`${planned} planned`);
  if (hasNote) parts.push('journal entry');
  if (shade.metric) parts.push(metricWords(shade, value));
  return parts.join(', ');
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function CalendarScreen() {
  const { token } = useAuth();
  const today = todaySignal.value;
  const month = parseCalendarPath(currentRoute.value.params.month, today).month;
  const { days } = gridRange(month);
  const inMonth = days.filter((d) => monthOf(d) === month);

  const choices = shadeChoices();
  const [shadeKey, setShadeKey] = useState<ShadeKey>(() => readShade(choices));
  const shade = choices.find((c) => c.key === shadeKey) ?? choices[0];

  // Selection is local: reset to today (or the 1st) whenever the month changes.
  const [sel, setSel] = useState({ month, date: initialSelection(month, today) });
  const selected = sel.month === month ? sel.date : initialSelection(month, today);

  const headingId = useId();
  const shadeRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const cells = useRef<Array<HTMLButtonElement | null>>([]);
  const focusDate = useRef<string | null>(null);

  // "Today" is kept current while the screen shows.
  useEffect(() => watchToday(), []);

  // Health and the journal: on show, each through its own 60 s throttle.
  useEffect(() => {
    if (!token) return;
    void healthRefresh.run(token);
    void journalRefresh.run(token);
  }, [token]);

  // After a move that changes the grid, put focus back on the cell asked for.
  useEffect(() => {
    const want = focusDate.current;
    if (!want) return;
    focusDate.current = null;
    cells.current[days.indexOf(want)]?.focus();
  });

  function showMonth(target: string) {
    replaceRoute(calendarHref(target, today));
  }

  function select(date: string) {
    const m = monthOf(date);
    setSel({ month: m, date });
    if (m !== month) {
      // A neighbouring month's day: move there and select it in its own grid.
      focusDate.current = date;
      showMonth(m);
    }
  }

  function chooseShade(key: ShadeKey) {
    setShadeKey(key);
    writeShade(key);
  }

  function onCellKey(e: KeyboardEvent, i: number) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    cells.current[i + step]?.focus();
  }

  const swipe = useSwipe({ onSwipe: (dir) => showMonth(addMonths(month, dir === 'left' ? 1 : -1)) });

  // What is in memory for the visible dates.
  const all = workouts.value;
  const marks = marksFor(days, all);
  const journal = journalEntries.value;
  const notes = new Map<string, string>();
  if (journal.state === 'loaded') for (const e of journal.entries) notes.set(e.date, e.note);

  const health = dailyHealth.value;

  // #297 — a retry the user asked for keeps the status mounted through
  // `loading`, so a retry that fails again updates the same container (and
  // the focus on it). Latched on Try again, so a first load or a throttled
  // refresh never shows "Loading…". Cleared once health leaves `loading`
  // (or lands `loaded`); `sawLoading` keeps the press itself, while health is
  // still `error`, from clearing it.
  const [retrying, setRetrying] = useState(false);
  const sawLoading = useRef(false);
  useEffect(() => {
    if (health.state === 'loading') sawLoading.current = true;
    else if (retrying && (sawLoading.current || health.state === 'loaded')) {
      sawLoading.current = false;
      setRetrying(false);
    }
  }, [health.state, retrying]);
  const statusOn = shade.metric !== null && (health.state === 'error' || (retrying && health.state === 'loading'));
  const series = shade.metric && health.state === 'loaded'
    ? seriesOf(health.rows, shade.metric.field)
    : new Map<string, number>();
  const shading = shadeMonth(inMonth, series);
  const shadingOn = shade.metric !== null && health.state === 'loaded';

  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div class="screen calendar-screen">
      <div class="template-editor-header calendar-back-row">
        <button
          type="button"
          class="template-editor-back calendar-back"
          aria-label="Back to Day"
          onClick={() => goBack(dayHref(today, today))}
        >
          ← Day
        </button>
      </div>

      <div class="calendar-month-row">
        <button type="button" class="day-arrow" aria-label="Previous month" onClick={() => showMonth(addMonths(month, -1))}>
          <span aria-hidden="true">‹</span>
        </button>
        <h1 class="calendar-title" id={headingId}>{monthTitle(month)}</h1>
        <button type="button" class="day-arrow" aria-label="Next month" onClick={() => showMonth(addMonths(month, 1))}>
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div class="calendar-shade">
        <span class="calendar-shade-label" aria-hidden="true">Shade by</span>
        <div class="sub-type-toggle calendar-shade-toggle" role="group" ref={shadeRef} aria-label="Shade days by">
          {choices.map((c) => (
            <button
              key={c.key}
              type="button"
              class={`sub-type-btn${c.key === shade.key ? ' active' : ''}`}
              aria-pressed={c.key === shade.key ? 'true' : 'false'}
              onClick={() => chooseShade(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {statusOn && (
          <PanelStatus status={health.state === 'error' ? 'error' : 'loading'} what="your health data" onRetry={() => { if (token) { sawLoading.current = false; setRetrying(true); void loadHealth(token); } }} returnFocusTo={() => shadeRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')} />
        )}
      </div>

      <div class="calendar-grid" role="grid" aria-labelledby={headingId} {...swipe}>
        <div class="calendar-row calendar-head" role="row">
          {WEEKDAYS.map((name) => (
            <div key={name} class="calendar-colhead" role="columnheader" aria-label={name}>
              <span aria-hidden="true">{name[0]}</span>
            </div>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} class="calendar-row" role="row">
            {week.map((d, j) => {
              const i = w * 7 + j;
              const outside = monthOf(d) !== month;
              const bin = shadingOn && !outside ? shading.bins[d] : undefined;
              const noData = shadingOn && !outside && bin === undefined;
              const isSelected = d === selected;
              const isToday = d === today;
              const hasNote = notes.has(d);
              const day = all.filter((x) => x.date === d);
              const cls = [
                'calendar-day',
                outside && 'calendar-day-outside',
                bin && `calendar-day-shade calendar-shade-${bin}`,
                noData && 'calendar-day-nodata',
                isToday && 'calendar-day-today',
                isSelected && 'calendar-day-selected',
              ].filter(Boolean).join(' ');
              return (
                // Keyed by position: the cell a user is on stays the same
                // element across a month change, so focus can stay with it.
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  class={cls}
                  ref={(el) => { cells.current[i] = el; }}
                  tabIndex={isSelected ? 0 : -1}
                  aria-selected={isSelected ? 'true' : 'false'}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={cellLabel(d, day, hasNote, shadingOn ? shade : choices[0], series.get(d))}
                  onClick={() => select(d)}
                  onKeyDown={(e) => onCellKey(e, i)}
                >
                  <span class="calendar-day-num" aria-hidden="true">{dayOfMonth(d)}</span>
                  {hasNote && <span class="calendar-note" aria-hidden="true" />}
                  <span class="calendar-marks" aria-hidden="true">
                    {markKinds(marks[d]).map((k, n) => (
                      <span key={n} class={`calendar-mark calendar-mark-${k}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <Legend shade={shade} on={shadingOn} low={shading.low} high={shading.high} />

      <DaySummary
        id={summaryId}
        date={selected}
        today={today}
        day={all.filter((x) => x.date === selected)}
        note={notes.get(selected)}
        shade={shade}
        value={shadingOn ? series.get(selected) : undefined}
      />
    </div>
  );
}

function Legend({ shade, on, low, high }: { shade: ShadeChoice; on: boolean; low: number | null; high: number | null }) {
  return (
    <div class="calendar-legend">
      <p class="calendar-legend-marks">
        <span class="calendar-key"><span class="calendar-mark calendar-mark-dot" aria-hidden="true" /> Done</span>
        <span class="calendar-key"><span class="calendar-mark calendar-mark-ring" aria-hidden="true" /> Planned</span>
        <span class="calendar-key"><span class="calendar-note calendar-note-key" aria-hidden="true" /> Journal entry</span>
      </p>
      {on && shade.metric && (
        <p class="calendar-scale">
          {low !== null && high !== null && (
            <span class="calendar-key">
              <span class="sr-only">{`${shade.label}, lowest to highest this month:`}</span>
              <span>{formatValue(shade.metric, low)}</span>
              <span class="calendar-swatches" aria-hidden="true">
                {[1, 2, 3, 4].map((b) => <span key={b} class={`calendar-swatch calendar-shade-${b}`} />)}
              </span>
              <span>{formatValue(shade.metric, high)}</span>
            </span>
          )}
          <span class="calendar-key">
            <span class="calendar-swatch calendar-swatch-nodata" aria-hidden="true" /> no data
          </span>
        </p>
      )}
    </div>
  );
}

interface DaySummaryProps {
  id: string;
  date: string;
  today: string;
  day: readonly WorkoutWithRow[];
  note: string | undefined;
  shade: ShadeChoice;
  value: number | undefined;
}

/** The selected day, read-only: workouts, a note preview, the shaded value, and a way into its Day. */
function DaySummary({ id, date, today, day, note, shade, value }: DaySummaryProps) {
  const state = dayStateOf(date, today);
  const lines = trainingOrder(day, state);
  const valueLine = shade.metric && value !== undefined ? metricWords(shade, value) : '';
  const empty = lines.length === 0 && note === undefined && !valueLine;
  return (
    <section class="day-panel calendar-summary" aria-labelledby={id}>
      <div class="day-panel-head calendar-summary-head">
        <h2 class="calendar-summary-title" id={id}>
          {weekdayMonthDay(date)}
          <span class="sr-only">{`, ${date.slice(0, 4)}`}</span>
        </h2>
        <a class="calendar-open-day" href={dayHref(date, today)}>
          Open day <span aria-hidden="true">›</span>
        </a>
      </div>
      {lines.length > 0 && (
        <ul class="calendar-summary-list">
          {lines.map(({ w, kind }) => (
            <li key={w.id || `row${w.sheetRow}`} class="calendar-summary-line">
              <span class={`type-badge badge-${w.type}`}>{typeWords(w)}</span>
              {kind === 'done' ? (
                <>
                  <span class="calendar-summary-text">
                    {(w.moving_seconds && formatDuration(w.moving_seconds)) || formatDuration(w.elapsed_seconds)}
                  </span>
                  {w.status === 'active' && <span class="type-badge badge-active">Active</span>}
                </>
              ) : (
                <>
                  <span class="calendar-summary-text">{w.name || w.type}</span>
                  <span class={`type-badge ${kind === 'overdue' ? 'badge-overdue' : 'badge-planned'}`}>
                    {kind === 'overdue' ? 'Overdue' : 'Planned'}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {note !== undefined && (
        <p class="calendar-summary-note">
          <span class="calendar-summary-label">Journal entry</span> {notePreview(note)}
        </p>
      )}
      {valueLine && <p class="calendar-summary-value">{valueLine}</p>}
      {empty && <p class="panel-note">Nothing recorded.</p>}
    </section>
  );
}
