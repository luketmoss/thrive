// #238 — the Day screen's Training panel: what was done, what is planned and,
// on a past day, what was planned and never happened. Reads the `workouts` and
// `sets` signals the app already holds; it makes no read of its own.
//
// #347: today also carries every planned workout whose date has passed, above
// today's own, each with Move to today, Reschedule and Start now. That is a
// separate step here (`overdueForToday`), never part of `trainingOrder`, which
// the Calendar's day summary shares.

import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { workouts, sets, activeWorkoutId, showToast } from '../../state/store';
import { rescheduleWorkout, startPlannedWorkout } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import type { WorkoutWithRow } from '../../api/types';
import { formatDistance, formatElevation, formatHeartRate } from '../../api/units';
import { formatDuration, formatEstimate } from '../../api/duration';
import { formatPlannedDate } from '../activities/activities-helpers';
import { Panel, PanelNote, type DayPanelProps } from './panel';

const isPlanned = (w: WorkoutWithRow) => w.status === 'planned';

/** By `time` ascending; no time last. Stable, so equal times keep sheet order. */
function byTime(list: readonly WorkoutWithRow[]): WorkoutWithRow[] {
  return list
    .map((w, i) => ({ w, i }))
    .sort((a, b) => {
      const ta = a.w.time;
      const tb = b.w.time;
      if (ta && tb) return ta < tb ? -1 : ta > tb ? 1 : a.i - b.i;
      if (ta) return -1;
      if (tb) return 1;
      return a.i - b.i;
    })
    .map((x) => x.w);
}

export type TrainingKind = 'done' | 'planned' | 'overdue';

/**
 * A day's workouts in the panel's order (#238), shared with the Calendar's
 * day summary (#241): a past day reads what happened first, then what was
 * planned and missed; today and later read what is planned, then what is done.
 * Done ones are by time, planned ones in sheet order.
 */
export function trainingOrder(day: readonly WorkoutWithRow[], state: DayPanelProps['state']): Array<{ w: WorkoutWithRow; kind: TrainingKind }> {
  const planned = day.filter(isPlanned);
  const done = byTime(day.filter((w) => !isPlanned(w)));
  return state === 'past'
    ? [...done.map((w) => ({ w, kind: 'done' as const })), ...planned.map((w) => ({ w, kind: 'overdue' as const }))]
    : [...planned.map((w) => ({ w, kind: 'planned' as const })), ...done.map((w) => ({ w, kind: 'done' as const }))];
}

/**
 * The planned workouts carried onto today (#347 AC1): `status` `planned` and a
 * date before `today`, oldest date first, equal dates in sheet order. Pure; a
 * separate step from `trainingOrder`, which it never changes.
 */
export function overdueForToday(all: readonly WorkoutWithRow[], today: string): WorkoutWithRow[] {
  return all
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => isPlanned(w) && !!w.date && w.date < today)
    .sort((a, b) => (a.w.date < b.w.date ? -1 : a.w.date > b.w.date ? 1 : a.i - b.i))
    .map((x) => x.w);
}

/** A workout row, a link to `href` when there is an id to open. */
function CardShell({ id, href, className, children }: {
  id: string;
  href: string;
  className: string;
  children: preact.ComponentChildren;
}) {
  return id
    ? <a class={className} href={href} data-workout-id={id}>{children}</a>
    : <div class={className}>{children}</div>;
}

function DoneCard({ w }: { w: WorkoutWithRow }) {
  const duration = (w.moving_seconds && formatDuration(w.moving_seconds)) || formatDuration(w.elapsed_seconds);
  const distance = formatDistance(w.distance_m);
  const ascent = formatElevation(w.ascent_m);
  const descent = formatElevation(w.descent_m);
  const hr = formatHeartRate(w.avg_hr);
  const meta = [
    w.time,
    distance,
    duration,
    ascent && `↑ ${ascent}`,
    descent && `↓ ${descent}`,
    hr,
  ].filter(Boolean);
  return (
    <CardShell id={w.id} href={`#/history/${w.id}`} className={`workout-card training-card workout-card-${w.type}`}>
      <div class="workout-card-center">
        <span class="workout-name">{w.name || w.type}</span>
        {meta.length > 0 && <span class="workout-meta">{meta.join(' · ')}</span>}
      </div>
      <span class="workout-card-badges">
        <span class={`type-badge badge-${w.type} training-type`}>
          {w.sub_type ? `${w.type} · ${w.sub_type}` : w.type}
        </span>
        {w.status === 'active' && <span class="type-badge badge-active">Active</span>}
        {w.effort && (
          <span class={`workout-effort workout-effort-${w.effort.toLowerCase()}`}>{w.effort}</span>
        )}
      </span>
    </CardShell>
  );
}

/**
 * A planned or overdue card. It opens the read-only detail view, where Start
 * Workout is (#347 AC7), not the editor.
 */
function PlannedCard({ w, overdue, plannedFor, className = '' }: {
  w: WorkoutWithRow;
  overdue: boolean;
  /** Today, on a card carried onto it: adds "Planned <formatPlannedDate>". */
  plannedFor?: string;
  className?: string;
}) {
  let counts = '';
  if (w.type === 'weight') {
    const own = sets.value.filter((s) => s.workout_id === w.id);
    const exercises = new Set(own.map((s) => `${s.exercise_id}__${s.exercise_order}`)).size;
    if (exercises > 0 && own.length > 0) {
      counts = `${exercises} exercise${exercises === 1 ? '' : 's'} · ${own.length} set${own.length === 1 ? '' : 's'}`;
    }
  }
  const meta = [counts, formatEstimate(w.estimated_seconds)].filter(Boolean).join(' · ');
  return (
    <CardShell id={w.id} href={`#/history/${w.id}`} className={`workout-card training-card workout-card-planned${className}`}>
      <div class="workout-card-center">
        <span class="workout-name">{w.name || w.type}</span>
        {meta && <span class="workout-meta">{meta}</span>}
        {plannedFor && (
          <span class="workout-meta planned-date training-planned-for">
            {`Planned ${formatPlannedDate(w.date, plannedFor)}`}
          </span>
        )}
      </div>
      <span class="workout-card-badges">
        <span class={`type-badge badge-${w.type} training-type`}>
          {w.sub_type ? `${w.type} · ${w.sub_type}` : w.type}
        </span>
        <span class={`type-badge ${overdue ? 'badge-overdue' : 'badge-planned'}`}>
          {overdue ? 'Overdue' : 'Planned'}
        </span>
      </span>
    </CardShell>
  );
}

type Busy = 'move' | 'save' | 'start' | null;

/** Where focus goes once a carried card's write has re-rendered the panel. */
interface FocusRequest {
  panel: Element | null;
  to: 'card' | 'heading';
  id: string;
}

/**
 * A planned workout carried onto today (#347 AC3–AC7, AC9): one visual unit
 * holding the card link and, below it and never inside it, the actions row or,
 * while rescheduling, the date row in its place.
 */
function OverdueCard({ w, today, onSettled }: {
  w: WorkoutWithRow;
  today: string;
  onSettled: (req: FocusRequest) => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState<Busy>(null);
  const [editing, setEditing] = useState(false);
  const [newDate, setNewDate] = useState(today);
  const dateRef = useRef<HTMLInputElement>(null);
  const rescheduleRef = useRef<HTMLButtonElement>(null);
  const returnToReschedule = useRef(false);
  const fieldId = useId();
  const name = w.name || w.type;

  useEffect(() => {
    if (editing) {
      dateRef.current?.focus();
    } else if (returnToReschedule.current) {
      returnToReschedule.current = false;
      rescheduleRef.current?.focus();
    }
  }, [editing]);

  const write = async (date: string, kind: 'move' | 'save', from: Element) => {
    if (!token || busy) return;
    const panel = from.closest('.day-panel');
    setBusy(kind);
    try {
      await rescheduleWorkout(w.id, date, token, today);
      // A future date leaves today's panel: focus its heading. Today, or a
      // past date (still overdue), keeps the workout here: focus its card.
      // A past date keeps this card mounted: close the row before focusing.
      setBusy(null);
      setEditing(false);
      onSettled({ panel, to: date > today ? 'heading' : 'card', id: w.id });
    } catch {
      // The action showed its toast; the card stays overdue where it was.
      setBusy(null);
    }
  };

  const start = async () => {
    if (!token || busy) return;
    if (activeWorkoutId.value) {
      showToast('Finish your current workout before starting a new one', 'error');
      return;
    }
    setBusy('start');
    try {
      const id = await startPlannedWorkout(w.id, token);
      navigate(`/workout/${id}`);
    } catch {
      // Error toast shown by the action.
      setBusy(null);
    }
  };

  const closeReschedule = () => {
    returnToReschedule.current = true;
    setEditing(false);
  };

  const moveLabel = busy === 'move' ? 'Moving…' : 'Move to today';
  const startLabel = busy === 'start' ? 'Starting…' : 'Start now';
  const disabled = busy !== null;
  const canSave = !!newDate && newDate !== w.date && !disabled;

  return (
    <div class="training-overdue">
      <PlannedCard w={w} overdue plannedFor={today} className=" training-overdue-link" />
      {editing ? (
        <div class="training-overdue-row training-reschedule">
          <label class="form-label training-reschedule-label" for={fieldId}>New date</label>
          <input
            ref={dateRef}
            id={fieldId}
            class="form-input training-reschedule-input"
            type="date"
            value={newDate}
            disabled={disabled}
            onInput={(e) => setNewDate((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (!disabled) closeReschedule();
              }
            }}
          />
          <div class="training-overdue-buttons">
            <button
              type="button"
              class="btn btn-secondary btn-sm training-action"
              disabled={!canSave}
              onClick={(e) => { if (canSave) write(newDate, newDate === today ? 'move' : 'save', e.currentTarget as Element); }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm training-action"
              disabled={disabled}
              onClick={closeReschedule}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div class="training-overdue-row training-overdue-buttons">
          <button
            type="button"
            class="btn btn-secondary btn-sm training-action"
            aria-label={`${moveLabel}: ${name}`}
            disabled={disabled}
            onClick={(e) => write(today, 'move', e.currentTarget as Element)}
          >
            {moveLabel}
          </button>
          <button
            ref={rescheduleRef}
            type="button"
            class="btn btn-secondary btn-sm training-action"
            aria-label={`Reschedule: ${name}`}
            disabled={disabled}
            onClick={() => { setNewDate(today); setEditing(true); }}
          >
            Reschedule
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm training-action"
            aria-label={`${startLabel}: ${name}`}
            disabled={disabled}
            onClick={start}
          >
            {startLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function TrainingPanel({ date, state, today }: DayPanelProps) {
  const day = workouts.value.filter((w) => w.date === date);
  // #347: a separate step, today only; `trainingOrder` is untouched.
  const carried = state === 'today' ? overdueForToday(workouts.value, today) : [];
  const planHref = `#/workout/new?plan=${date}`;
  const canPlan = state !== 'past';
  const [focus, setFocus] = useState<FocusRequest | null>(null);

  // After a carried card's write has re-rendered the panel: the workout's card
  // link, or the panel heading when the workout has left today.
  useEffect(() => {
    if (!focus) return;
    setFocus(null);
    const { panel, to, id } = focus;
    if (!panel || !panel.isConnected) return;
    const heading = panel.querySelector<HTMLElement>('.day-panel-title');
    const card = to === 'card'
      ? [...panel.querySelectorAll<HTMLElement>('a[data-workout-id]')].find((a) => a.dataset.workoutId === id)
      : undefined;
    (card ?? heading)?.focus();
  }, [focus]);

  if (day.length === 0 && carried.length === 0) {
    return (
      <Panel title="Training">
        <PanelNote>{state === 'past' ? 'No activities.' : state === 'today' ? 'Nothing planned today.' : 'Nothing planned.'}</PanelNote>
        {canPlan && <a class="btn btn-secondary training-plan-btn" href={planHref}>Plan in Thrive</a>}
      </Panel>
    );
  }

  // A carried row with no id renders as an ordinary overdue card: no link, no actions (AC7).
  const overdueCards = carried.map((w) => (w.id
    ? <OverdueCard key={`overdue-${w.id}`} w={w} today={today} onSettled={setFocus} />
    : <PlannedCard key={`overdue-row${w.sheetRow}`} w={w} overdue plannedFor={today} />));
  const cards = trainingOrder(day, state).map(({ w, kind }) => {
    const key = w.id || `row${w.sheetRow}`;
    return kind === 'done' ? <DoneCard key={key} w={w} /> : <PlannedCard key={key} w={w} overdue={kind === 'overdue'} />;
  });

  return (
    <Panel title="Training" action={canPlan ? <a class="training-plan-link" href={planHref}>Plan</a> : undefined}>
      <div class="training-list">{overdueCards}{cards}</div>
    </Panel>
  );
}
