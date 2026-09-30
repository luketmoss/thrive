// #237 AC2 — the Day screen's header: weekday, date, relative pill, sun line.

import type { Ref } from 'preact';
import { relativeLabel } from '../../day/dates';
import { fullDate, weekdayName } from '../../day/format';
import { sunLine } from '../../day/sun';

interface DayHeaderProps {
  date: string;
  today: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  headingRef: Ref<HTMLHeadingElement>;
  todayButtonRef: Ref<HTMLButtonElement>;
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
