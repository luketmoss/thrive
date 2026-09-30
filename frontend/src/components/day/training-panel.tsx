// #238 — the Day screen's Training panel: what was done, what is planned and,
// on a past day, what was planned and never happened. Reads the `workouts` and
// `sets` signals the app already holds; it makes no read of its own.

import { workouts, sets } from '../../state/store';
import type { WorkoutWithRow } from '../../api/types';
import { formatDistance, formatElevation, formatHeartRate } from '../../api/units';
import { formatDuration, formatEstimate } from '../../api/duration';
import { Panel, PanelNote, type DayPanelProps } from './panel';

const isPlanned = (w: WorkoutWithRow) => w.status === 'planned';

/** By `time` ascending; no time last. Stable, so equal times keep sheet order. */
function byTime(list: WorkoutWithRow[]): WorkoutWithRow[] {
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

/** A workout row, a link to `href` when there is an id to open. */
function CardShell({ id, href, className, children }: {
  id: string;
  href: string;
  className: string;
  children: preact.ComponentChildren;
}) {
  return id
    ? <a class={className} href={href}>{children}</a>
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

function PlannedCard({ w, overdue }: { w: WorkoutWithRow; overdue: boolean }) {
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
    <CardShell id={w.id} href={`#/history/${w.id}/edit`} className="workout-card training-card workout-card-planned">
      <div class="workout-card-center">
        <span class="workout-name">{w.name || w.type}</span>
        {meta && <span class="workout-meta">{meta}</span>}
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

export function TrainingPanel({ date, state }: DayPanelProps) {
  const day = workouts.value.filter((w) => w.date === date);
  const planned = day.filter(isPlanned);
  const done = byTime(day.filter((w) => !isPlanned(w)));
  const planHref = `#/workout/new?plan=${date}`;
  const canPlan = state !== 'past';

  if (day.length === 0) {
    return (
      <Panel title="Training">
        <PanelNote>{state === 'past' ? 'No activities.' : state === 'today' ? 'Nothing planned today.' : 'Nothing planned.'}</PanelNote>
        {canPlan && <a class="btn btn-secondary training-plan-btn" href={planHref}>Plan in Thrive</a>}
      </Panel>
    );
  }

  // A past day reads what happened first; today and later read what is ahead.
  const cards = state === 'past'
    ? [...done.map((w) => <DoneCard key={w.id || `row${w.sheetRow}`} w={w} />),
       ...planned.map((w) => <PlannedCard key={w.id || `row${w.sheetRow}`} w={w} overdue />)]
    : [...planned.map((w) => <PlannedCard key={w.id || `row${w.sheetRow}`} w={w} overdue={false} />),
       ...done.map((w) => <DoneCard key={w.id || `row${w.sheetRow}`} w={w} />)];

  return (
    <Panel title="Training" action={canPlan ? <a class="training-plan-link" href={planHref}>Plan</a> : undefined}>
      <div class="training-list">{cards}</div>
    </Panel>
  );
}
