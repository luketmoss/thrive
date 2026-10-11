// #237 — the Day screen: one date at a time, addressed by `#/day/YYYY-MM-DD`
// (`#/` for today), with its header, week strip and panels.
//
// Moving between days replaces the history entry (`replaceRoute`), so Back
// leaves the screen rather than stepping back through every day seen. The
// screen stays mounted across dates; the panels are keyed by date and mount
// fresh for each one. Health and the journal are loaded on show and on the page becoming
// visible, throttled, and never on a move.

import { useEffect, useRef, useState } from 'preact/hooks';
import { useAuth } from '../../auth/auth-context';
import { currentRoute, navigate, replaceRoute } from '../../router/router';
import { workouts } from '../../state/store';
import { healthRefresh, journalRefresh, syncLogsRefresh, workoutsRefresh } from '../../state/actions';
import { refreshHeld, workoutsRefreshPending } from '../../state/refresh-hold';
import { onPageVisible } from '../../state/page-visible';
import { addDays, dayHref, dayStateOf } from '../../day/dates';
import { moveAnnouncement } from '../../day/format';
import { today as todaySignal, watchToday } from '../../day/today';
import { DayHeader } from './day-header';
import { WeekStrip } from './week-strip';
import { SLOTS, slotsFor } from './slots';
import { useSwipe } from './use-swipe';
import { useSyncNow } from '../settings/sync-now';
import { DaySyncLine } from './day-sync-line';

/** True when a key press belongs to a text field, not the screen. */
function inTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
}

export function DayScreen() {
  const { token, user } = useAuth();
  const today = todaySignal.value;
  const date = currentRoute.value.params.date ?? today;
  const state = dayStateOf(date, today);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const todayButtonRef = useRef<HTMLButtonElement>(null);
  const focusHeading = useRef(false);
  const [announcement, setAnnouncement] = useState('');

  // "Today" is kept current while the screen shows (every minute, and on visible).
  useEffect(() => watchToday(), []);

  // Health: on show, and on visible while showing; `healthRefresh` throttles.
  useEffect(() => {
    if (!token) return;
    void healthRefresh.run(token);
    return onPageVisible(() => void healthRefresh.run(token));
  }, [token]);

  // Journal (#240): the same triggers, its own throttle. Never on a move.
  useEffect(() => {
    if (!token) return;
    void journalRefresh.run(token);
    return onPageVisible(() => void journalRefresh.run(token));
  }, [token]);

  // Sync logs (#409): the same triggers and guard, for the "Synced <age>" line.
  useEffect(() => {
    if (!token) return;
    void syncLogsRefresh.run(token);
    return onPageVisible(() => void syncLogsRefresh.run(token));
  }, [token]);

  // Sync now (#315, #409): the same hook Settings uses. When a request closes,
  // re-read what the sync wrote: health and the sync logs now, Workouts/Sets
  // under the hold app.tsx applies on the page becoming visible (an edit route,
  // or a non-empty offline save queue): held, it is flagged, and app.tsx's own
  // effect runs it once when the hold lifts.
  const sync = useSyncNow(token, user?.email ?? '', () => {
    if (!token) return;
    void healthRefresh.run(token);
    syncLogsRefresh.invalidate();
    void syncLogsRefresh.run(token);
    workoutsRefresh.invalidate();
    if (refreshHeld()) workoutsRefreshPending.value = true;
    else void workoutsRefresh.run(token);
  });

  // Announce each move the user made, but not the first load or a midnight
  // rollover (today changing under `#/`, where the date follows it).
  const last = useRef({ date, today });
  useEffect(() => {
    const prev = last.current;
    last.current = { date, today };
    if (prev.date === date) return;
    const rollover = prev.today !== today && prev.date === prev.today && date === today;
    if (!rollover) setAnnouncement(moveAnnouncement(date, today));
  }, [date, today]);

  // When the Today button disappears because it was used, focus the h1.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  });

  function moveTo(target: string) {
    if (target === date) return;
    if (target === today && todayButtonRef.current && document.activeElement === todayButtonRef.current) {
      focusHeading.current = true;
    }
    replaceRoute(dayHref(target, today));
  }

  const move = useRef(moveTo);
  move.current = moveTo;
  const current = useRef({ date, today });
  current.current = { date, today };

  // ← / → a day, `t` today. Not in a text field, not with Ctrl/Alt/Meta, not on repeat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      if (inTextEntry(e.target)) return;
      const { date: d, today: t } = current.current;
      if (e.key === 'ArrowLeft') move.current(addDays(d, -1));
      else if (e.key === 'ArrowRight') move.current(addDays(d, 1));
      else if (e.key === 't') move.current(t);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const swipe = useSwipe({
    ignore: '.week-strip, .day-sync',
    onSwipe: (dir) => moveTo(addDays(date, dir === 'left' ? 1 : -1)),
  });

  return (
    <div class="screen day-screen" {...swipe}>
      <DayHeader
        date={date}
        today={today}
        onPrevious={() => moveTo(addDays(date, -1))}
        onNext={() => moveTo(addDays(date, 1))}
        onToday={() => moveTo(today)}
        headingRef={headingRef}
        todayButtonRef={todayButtonRef}
      >
        <DaySyncLine sync={sync} />
      </DayHeader>
      <WeekStrip date={date} today={today} workouts={workouts.value} onSelect={moveTo} />
      <div class="day-panels">
        {slotsFor(state).map((name) => {
          const Slot = SLOTS[name];
          return <Slot key={`${name}:${date}`} date={date} state={state} today={today} />;
        })}
      </div>
      <p class="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <button class="fab" data-focus-key="start-workout" onClick={() => navigate('/workout/new')} aria-label="Start workout">
        +
      </button>
    </div>
  );
}
