import { useState } from 'preact/hooks';
import { navigate } from '../../router/router';
import { filteredWorkouts, activeWorkouts, plannedWorkouts, completedWorkouts, sets, exercises } from '../../state/store';
import { ActivitiesFilters } from './activities-filters';
import {
  groupWorkoutsByDate,
  getWorkoutTags,
  getWeekStreak,
  getWeekWorkoutCount,
  getWeekTotalMinutes,
  getLastWeekWorkoutCount,
  getLastWeekTotalMinutes,
  getMonthWorkoutCount,
  getMonthTotalMinutes,
  getWeekCardioWorkouts,
  getWeekCardioDistance,
  getWeekCardioAscent,
  coverageSuffix,
  cardioNoun,
  toLocalDateStr,
  formatPlannedDate,
  isOverdue,
  pluralExercise,
  workoutCardAriaLabel,
} from './activities-helpers';
import { LabelBadge } from '../shared/label-badge';
import { ProvenanceMark } from '../shared/provenance-mark';
import { provenanceMark } from '../../api/provenance';
import { formatDuration, formatEstimate } from '../../api/duration';
import { formatDistance, formatElevation, metersToMiles, metersToFeet } from '../../api/units';

/** Type-color map for inset box-shadow accent (light theme). */
const TYPE_COLORS: Record<string, { light: string; dark: string }> = {
  weight:  { light: '#c53030', dark: '#fca5a5' },
  stretch: { light: '#2e7d32', dark: '#86efac' },
  bike:    { light: '#1565c0', dark: '#93c5fd' },
  hike:    { light: '#5d4037', dark: '#d7ccc8' },
};

function pluralWorkout(n: number): string {
  return `${n} ${n === 1 ? 'workout' : 'workouts'}`;
}

/**
 * Spoken form of a scheduled-date label. Relative words read naturally in
 * lower case mid-sentence; absolute dates keep their capitalisation.
 */
function spokenDate(label: string): string {
  return ['Today', 'Tomorrow', 'Yesterday'].includes(label) ? label.toLowerCase() : label;
}

export function ActivitiesScreen() {
  const [showFilters, setShowFilters] = useState(false);

  const todayStr = toLocalDateStr(new Date());
  const groups = groupWorkoutsByDate(filteredWorkouts.value, todayStr);
  const planned = plannedWorkouts.value;
  // All stats use only completed workouts (planned workouts haven't happened yet)
  const completed = completedWorkouts.value;
  const weekDays = getWeekStreak(completed, todayStr);
  const weekCount = getWeekWorkoutCount(completed, todayStr);
  const weekMinutes = getWeekTotalMinutes(completed, todayStr);
  const lastWeekCount = getLastWeekWorkoutCount(completed, todayStr);
  const lastWeekMinutes = getLastWeekTotalMinutes(completed, todayStr);
  const monthCount = getMonthWorkoutCount(completed, todayStr);
  const monthMinutes = getMonthTotalMinutes(completed, todayStr);

  // #105 — this week only; last week and this month keep their existing cells.
  const weekCardio = getWeekCardioWorkouts(completed, todayStr);
  const cardioCount = weekCardio.length;
  const cardioUnit = cardioNoun(weekCardio);
  const weekDistance = getWeekCardioDistance(completed, todayStr);
  const weekAscent = getWeekCardioAscent(completed, todayStr);

  // AC5: the visual cells are aria-hidden and the bar carries one label, so
  // anything added to the markup alone is silently invisible to screen
  // readers. Every figure below appears in both.
  const statsAriaLabel = [
    `${pluralWorkout(weekCount)} this week, ${weekMinutes} minutes.`,
    `${pluralWorkout(lastWeekCount)} last week, ${lastWeekMinutes} minutes.`,
    `${pluralWorkout(monthCount)} this month, ${monthMinutes} minutes.`,
    cardioCount > 0 && weekDistance.total > 0
      ? `${metersToMiles(String(weekDistance.total))} miles across ${weekDistance.withData} of ${weekDistance.of} ${cardioUnit}.`
      : '',
    cardioCount > 0 && weekAscent.total > 0
      ? `${metersToFeet(String(weekAscent.total))?.toLocaleString('en-US')} feet of ascent across ${weekAscent.withData} of ${weekAscent.of} ${cardioUnit}.`
      : '',
  ].filter(Boolean).join(' ');

  return (
    <div class="screen activities-screen">
      <header class="screen-header">
        <div class="activities-header-row">
          <h1>Activities</h1>
          <button
            class="btn-icon"
            onClick={() => setShowFilters(!showFilters)}
            aria-label="Toggle filters"
            aria-expanded={showFilters}
          >
            {showFilters ? '✕' : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M1 2h16l-6 7.5V15l-4 2v-7.5L1 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div class="week-streak-bar">
        <div class="week-streak-dots" aria-hidden="true">
          {weekDays.map((d) => (
            <div
              key={d.date}
              class={`streak-dot${d.hasWorkout ? ' filled' : ''}${d.isToday ? ' today' : ''}`}
            />
          ))}
        </div>
        <div class="week-streak-labels" aria-hidden="true">
          {weekDays.map((d) => (
            <span key={d.date} class={`streak-label${d.isToday ? ' today' : ''}`}>{d.label}</span>
          ))}
        </div>
        <div
          class="stats-bar"
          aria-label={statsAriaLabel}
        >
          <div class="stats-bar-cell" aria-hidden="true">
            <span class="stats-bar-label">This week</span>
            <span class="stats-bar-value">{pluralWorkout(weekCount)} · {weekMinutes} min</span>
          </div>
          <div class="stats-bar-cell stats-bar-cell--center" aria-hidden="true">
            <span class="stats-bar-label">Last week</span>
            <span class="stats-bar-value">{pluralWorkout(lastWeekCount)} · {lastWeekMinutes} min</span>
          </div>
          <div class="stats-bar-cell stats-bar-cell--right" aria-hidden="true">
            <span class="stats-bar-label">This month</span>
            <span class="stats-bar-value">{pluralWorkout(monthCount)} · {monthMinutes} min</span>
          </div>
        </div>

        {/* #105 — full-width row: each stats-bar cell gets only ~103px at
            375px, and the existing value string already needs ~120px. */}
        {cardioCount > 0 && (weekDistance.total > 0 || weekAscent.total > 0) && (
          <div class="stats-row" aria-hidden="true">
            <span class="stats-bar-label">Cardio this week</span>
            <span class="stats-row-value">
              {weekDistance.total > 0 && (
                <span>{formatDistance(String(weekDistance.total))}{coverageSuffix(weekDistance, cardioUnit)}</span>
              )}
              {weekAscent.total > 0 && (
                <span>↑ {formatElevation(String(weekAscent.total))}{coverageSuffix(weekAscent, cardioUnit)}</span>
              )}
            </span>
          </div>
        )}
      </div>

      {showFilters && <ActivitiesFilters />}

      {/* In Progress section — tap to resume active workout */}
      {activeWorkouts.value.length > 0 && (
        <div class="planned-section">
          <div class="date-group-header first">In Progress</div>
          {activeWorkouts.value.map((w) => (
            <button
              type="button"
              key={w.id}
              class="workout-card workout-card-active"
              onClick={() => navigate(`/workout/${w.id}`)}
              aria-label={`${w.name || w.type}, in progress. Resume workout.`}
            >
              <div class="workout-card-center">
                <span class="workout-name">{w.name || w.type}</span>
                <span class="workout-meta">Tap to resume</span>
              </div>
              <span class="type-badge badge-active">Active</span>
            </button>
          ))}
        </div>
      )}

      {/* Planned workouts section — between streak bar and history */}
      {planned.length > 0 && (
        <div class="planned-section">
          <div class="date-group-header first">Planned</div>
          {planned.map((w) => {
            const workoutSets = sets.value.filter((s) => s.workout_id === w.id);
            const exerciseCount = new Set(workoutSets.map((s) => `${s.exercise_id}__${s.exercise_order}`)).size;
            const tags = getWorkoutTags(workoutSets, exercises.value);
            const dateLabel = formatPlannedDate(w.date, todayStr);
            const overdue = isOverdue(w.date, todayStr);
            const countLabel = exerciseCount > 0 ? pluralExercise(exerciseCount) : 'No exercises yet';
            // #145: omitted entirely when nobody estimated it.
            const estimate = formatEstimate(w.estimated_seconds);
            const ariaLabel = [
              w.name || w.type,
              overdue ? 'overdue' : 'planned',
              `${overdue ? 'was scheduled for' : 'scheduled for'} ${spokenDate(dateLabel)}`,
              countLabel,
              formatEstimate(w.estimated_seconds, true),
            ].filter(Boolean).join(', ');

            return (
              <button
                type="button"
                key={w.id}
                class="workout-card workout-card-planned"
                onClick={() => navigate(`/history/${w.id}`)}
                aria-label={ariaLabel}
              >
                <div class="workout-card-center">
                  <span class="workout-name">{w.name || w.type}</span>
                  <span class="workout-meta">
                    {countLabel}
                    {' · '}
                    <span class={`planned-date${dateLabel === 'Today' || dateLabel === 'Tomorrow' ? ' planned-date-imminent' : ''}`}>
                      {dateLabel}
                    </span>
                    {estimate && ` · ${estimate}`}
                  </span>
                  {tags.length > 0 && (
                    <div class="workout-card-tags">
                      {tags.map((tag) => (
                        <LabelBadge key={tag} name={tag} />
                      ))}
                    </div>
                  )}
                </div>
                <span class={`type-badge ${overdue ? 'badge-overdue' : 'badge-planned'}`}>
                  {overdue ? 'Overdue' : 'Planned'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div class="screen-body">
        {filteredWorkouts.value.length === 0 ? (
          <div class="empty-state">
            <p>No workouts yet</p>
            <p>Tap + to start your first workout</p>
          </div>
        ) : (
          <div class="workout-list">
            {groups.map((group, groupIdx) => (
              <div key={group.label}>
                <div class={`date-group-header${groupIdx === 0 ? ' first' : ''}`}>
                  {group.label}
                </div>
                {group.workouts.map((w) => {
                  const workoutSets = sets.value.filter((s) => s.workout_id === w.id);
                  const exerciseCount = new Set(workoutSets.map((s) => `${s.exercise_id}__${s.exercise_order}`)).size;
                  const typeColor = TYPE_COLORS[w.type];
                  const tags = w.type === 'weight' ? getWorkoutTags(workoutSets, exercises.value) : [];

                  return (
                    <button
                      type="button"
                      key={w.id}
                      class={`workout-card workout-card-${w.type}`}
                      style={typeColor ? { '--type-accent': typeColor.light, '--type-accent-dark': typeColor.dark } as any : undefined}
                      onClick={() => navigate(`/history/${w.id}`)}
                      aria-label={workoutCardAriaLabel(w, exerciseCount)}
                    >
                      <div class="workout-card-left">
                        <span class="workout-date">{w.date}</span>
                        {w.time && <span class="workout-time">{w.time}</span>}
                      </div>
                      <div class="workout-card-center">
                        <span class="workout-name">{w.name || w.type}</span>
                        <span class="workout-meta">
                          {formatDuration(w.elapsed_seconds)}
                          {w.elapsed_seconds && exerciseCount > 0 ? ' · ' : ''}
                          {exerciseCount > 0 ? `${exerciseCount} exercise${exerciseCount !== 1 ? 's' : ''}` : ''}
                          {/* #157: the separator sits outside the mark, so a
                              375px wrap breaks before the glyph, never inside. */}
                          {provenanceMark(w) && (w.elapsed_seconds || exerciseCount > 0) ? ' · ' : ''}
                          <ProvenanceMark workout={w} />
                        </span>
                        {tags.length > 0 && (
                          <div class="workout-card-tags">
                            {tags.map((tag) => (
                              <LabelBadge key={tag} name={tag} />
                            ))}
                          </div>
                        )}
                      </div>
                      {/* #113: the pill stacks under the badge. aria-hidden
                          because workoutCardAriaLabel already speaks the
                          effort — the card is one button with one label. */}
                      <span class="workout-card-badges">
                        <span class={`type-badge badge-${w.type}`}>{w.type}</span>
                        {w.effort && (
                          <span
                            class={`workout-effort workout-effort-${w.effort.toLowerCase()}`}
                            aria-hidden="true"
                          >
                            {w.effort}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <button class="fab" onClick={() => navigate('/workout/new')} aria-label="Start workout">
        +
      </button>
    </div>
  );
}
