import { useState } from 'preact/hooks';
import { navigate } from '../../router/router';
import { filteredWorkouts, sets, exercises, workouts } from '../../state/store';
import { ActivitiesFilters } from './activities-filters';
import { groupWorkoutsByDate, getWorkoutTags, getWeekStreak, getWeekWorkoutCount, getWeekTotalMinutes, toLocalDateStr } from './activities-helpers';
import { LabelBadge } from '../shared/label-badge';

/** Type-color map for inset box-shadow accent (light theme). */
const TYPE_COLORS: Record<string, { light: string; dark: string }> = {
  weight:  { light: '#c53030', dark: '#fca5a5' },
  stretch: { light: '#2e7d32', dark: '#86efac' },
  bike:    { light: '#1565c0', dark: '#93c5fd' },
  hike:    { light: '#5d4037', dark: '#d7ccc8' },
};

export function ActivitiesScreen() {
  const [showFilters, setShowFilters] = useState(false);

  const todayStr = toLocalDateStr(new Date());
  const groups = groupWorkoutsByDate(filteredWorkouts.value, todayStr);
  const weekDays = getWeekStreak(workouts.value, todayStr);
  const weekCount = getWeekWorkoutCount(workouts.value, todayStr);
  const weekMinutes = getWeekTotalMinutes(workouts.value, todayStr);
  const countText = `${weekCount} ${weekCount === 1 ? 'workout' : 'workouts'} this week`;
  const ariaLabel = weekMinutes > 0 ? `${countText}, ${weekMinutes} min` : countText;

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

      <div
        class="week-streak-bar"
        aria-label={ariaLabel}
      >
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
        <p class="week-streak-count">
          {countText}{weekMinutes > 0 ? ` · ${weekMinutes} min` : ''}
        </p>
      </div>

      {showFilters && <ActivitiesFilters />}

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
                    <div
                      key={w.id}
                      class={`workout-card workout-card-${w.type}`}
                      style={typeColor ? { '--type-accent': typeColor.light, '--type-accent-dark': typeColor.dark } as any : undefined}
                      onClick={() => navigate(`/history/${w.id}`)}
                    >
                      <div class="workout-card-left">
                        <span class="workout-date">{w.date}</span>
                        {w.time && <span class="workout-time">{w.time}</span>}
                      </div>
                      <div class="workout-card-center">
                        <span class="workout-name">{w.name || w.type}</span>
                        <span class="workout-meta">
                          {w.duration_min ? `${w.duration_min} min` : ''}
                          {w.duration_min && exerciseCount > 0 ? ' · ' : ''}
                          {exerciseCount > 0 ? `${exerciseCount} exercise${exerciseCount !== 1 ? 's' : ''}` : ''}
                        </span>
                        {tags.length > 0 && (
                          <div class="workout-card-tags">
                            {tags.map((tag) => (
                              <LabelBadge key={tag} name={tag} />
                            ))}
                          </div>
                        )}
                      </div>
                      <span class={`type-badge badge-${w.type}`}>{w.type}</span>
                    </div>
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
