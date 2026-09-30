// #237 AC3 — the viewed date's Monday–Sunday week, with workout marks.
//
// Marks come from the workouts already in memory, never a read: a filled dot
// for each workout that is not `planned`, then a ring for each planned one,
// three at most. A planned workout on a past day stays a ring.

import type { WorkoutWithRow } from '../../api/types';
import { addDays, weekOf } from '../../day/dates';
import { dayOfMonth, fullDate, stripDayLabel, weekdayLetter } from '../../day/format';
import { useSwipe } from './use-swipe';

export const MAX_MARKS = 3;

export interface DayMarks {
  done: number;
  planned: number;
}

/** Done and planned counts for each of `dates`, from the workouts in memory. */
export function marksFor(dates: readonly string[], all: readonly WorkoutWithRow[]): Record<string, DayMarks> {
  const out: Record<string, DayMarks> = {};
  for (const d of dates) out[d] = { done: 0, planned: 0 };
  for (const w of all) {
    const m = out[w.date];
    if (!m) continue;
    if (w.status === 'planned') m.planned++;
    else m.done++;
  }
  return out;
}

/** The marks drawn for one day: dots first, then rings, three in all. */
export function markKinds({ done, planned }: DayMarks): Array<'dot' | 'ring'> {
  const kinds: Array<'dot' | 'ring'> = [];
  for (let i = 0; i < done; i++) kinds.push('dot');
  for (let i = 0; i < planned; i++) kinds.push('ring');
  return kinds.slice(0, MAX_MARKS);
}

interface WeekStripProps {
  date: string;
  today: string;
  workouts: readonly WorkoutWithRow[];
  onSelect: (date: string) => void;
}

export function WeekStrip({ date, today, workouts, onSelect }: WeekStripProps) {
  const week = weekOf(date);
  const marks = marksFor(week, workouts);
  const swipe = useSwipe({
    // Swiping left brings the next week in, like the day content does a day.
    onSwipe: (dir) => onSelect(addDays(date, dir === 'left' ? 7 : -7)),
  });

  return (
    <div class="week-strip" role="group" aria-label={`Week of ${fullDate(week[0])}`} {...swipe}>
      {week.map((d, i) => {
        const viewed = d === date;
        const isToday = d === today;
        const m = marks[d];
        const cls = ['week-day', viewed && 'week-day-viewed', isToday && 'week-day-today'].filter(Boolean).join(' ');
        return (
          // Keyed by position, not date: the button a user is on stays the
          // same element when the week changes, so focus stays with it.
          <button
            key={i}
            type="button"
            class={cls}
            aria-pressed={viewed ? 'true' : 'false'}
            aria-current={isToday ? 'date' : undefined}
            aria-label={stripDayLabel(d, m.done, m.planned)}
            onClick={() => onSelect(d)}
          >
            <span class="week-day-letter" aria-hidden="true">{weekdayLetter(d)}</span>
            <span class="week-day-num" aria-hidden="true">{dayOfMonth(d)}</span>
            <span class="week-day-marks" aria-hidden="true">
              {markKinds(m).map((k, j) => (
                <span key={j} class={`week-mark week-mark-${k}`} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
