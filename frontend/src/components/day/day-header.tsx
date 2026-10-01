// #237 AC2 — the Day screen's header: weekday, date, relative pill, sun line.

import type { Ref } from 'preact';
import { relativeLabel } from '../../day/dates';
import { fullDate, weekdayName } from '../../day/format';
import { sunLine } from '../../day/sun';
import { navigate } from '../../router/router';
import { calendarHref, monthOf } from '../../calendar/dates';

interface DayHeaderProps {
  date: string;
  today: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  headingRef: Ref<HTMLHeadingElement>;
  todayButtonRef: Ref<HTMLButtonElement>;
}

/** A month page: drawn in currentColor, so it takes the button's own colour. */
function CalendarIcon() {
  return (
    <svg class="day-calendar-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M3 8.5h14M7 2.5v4M13 2.5v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

export function DayHeader({ date, today, onPrevious, onNext, onToday, headingRef, todayButtonRef }: DayHeaderProps) {
  const isToday = date === today;
  const sun = sunLine(date);
  const full = fullDate(date);
  return (
    <header class="day-header">
      <div class="day-header-row">
        <h1 class="day-title" tabIndex={-1} ref={headingRef}>
          {weekdayName(date)}
          <span class="sr-only">, {full}</span>
        </h1>
        <div class="day-nav">
          {!isToday && (
            <button type="button" class="day-today-btn" ref={todayButtonRef} onClick={onToday}>
              Today
            </button>
          )}
          <button type="button" class="day-arrow" aria-label="Previous day" onClick={onPrevious}>
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" class="day-arrow" aria-label="Next day" onClick={onNext}>
            <span aria-hidden="true">›</span>
          </button>
          {/* #241 AC1: last, so it never moves when Today comes or goes. Pushes. */}
          <button
            type="button"
            class="day-arrow day-calendar-btn"
            aria-label="Calendar"
            onClick={() => navigate(calendarHref(monthOf(date), today))}
          >
            <CalendarIcon />
          </button>
        </div>
      </div>
      <p class="day-date">
        <span>{full}</span>
        <span class={`day-pill${isToday ? ' day-pill-today' : ''}`}>{relativeLabel(date, today)}</span>
      </p>
      <p class="day-sun">
        <span>Sunrise {sun.sunrise}</span>
        {' · '}
        <span>Sunset {sun.sunset}</span>
        {' · '}
        <span>
          {sun.daylight} of daylight {sun.change}
        </span>
      </p>
    </header>
  );
}
