import { useState } from 'preact/hooks';
import { navigate } from '../../router/router';
import { filteredWorkouts, sets } from '../../state/store';
import { ActivitiesFilters } from './activities-filters';

export function ActivitiesScreen() {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div class="screen activities-screen">
      <header class="screen-header">
        <div class="activities-header-row">
          <h1>Workouts</h1>
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

      {showFilters && <ActivitiesFilters />}

      <div class="screen-body">
        {filteredWorkouts.value.length === 0 ? (
          <div class="empty-state">
            <p>No workouts yet</p>
            <p>Tap + to start your first workout</p>
          </div>
        ) : (
          <div class="workout-list">
            {filteredWorkouts.value.map((w) => {
              const workoutSets = sets.value.filter((s) => s.workout_id === w.id);
              const exerciseCount = new Set(workoutSets.map((s) => `${s.exercise_id}__${s.exercise_order}`)).size;

              return (
                <div
                  key={w.id}
                  class="workout-card"
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
                  </div>
                  <span class={`type-badge badge-${w.type}`}>{w.type}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button class="fab" onClick={() => navigate('/workout/new')} aria-label="Start workout">
        +
      </button>
    </div>
  );
}
