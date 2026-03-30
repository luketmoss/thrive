import { useState, useMemo, useEffect } from 'preact/hooks';
import { exercises as exercisesSignal, sets, workouts, allTags } from '../../state/store';
import { addExercise, editExercise, removeExercise } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { ExerciseForm } from './exercise-form';
import { LabelBadge } from '../shared/label-badge';
import { getLastTimeDataFrom, formatLastTimeDate } from '../workout/last-time-data';
import type { ExerciseWithRow, SetWithRow, WorkoutWithRow } from '../../api/types';

/** Build a map of exerciseId → most recent workout date string. */
export function buildLastPerformedMap(
  allSets: SetWithRow[],
  allWorkouts: WorkoutWithRow[],
): Map<string, string> {
  const workoutDateMap = new Map<string, string>();
  for (const w of allWorkouts) {
    workoutDateMap.set(w.id, w.date);
  }

  // For each exercise, find the most recent workout date
  const result = new Map<string, string>();
  for (const s of allSets) {
    const date = workoutDateMap.get(s.workout_id) || '';
    if (!date) continue;
    const current = result.get(s.exercise_id) || '';
    if (date > current) {
      result.set(s.exercise_id, date);
    }
  }
  return result;
}

/** Format a date as short display: "Mar 10, 2026" */
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function effortClass(effort: string): string {
  if (!effort) return '';
  return `effort-${effort.toLowerCase()}`;
}

export function ExercisesScreen() {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editingExercise, setEditingExercise] = useState<ExerciseWithRow | null>(null);
  const [creatingExercise, setCreatingExercise] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  };

  const filtered = exercisesSignal.value
    .filter(ex => {
      const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.every(tag =>
          ex.tags.split(',').map(t => t.trim()).includes(tag),
        );
      return matchesSearch && matchesTags;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // AC1/AC5: Compute last-performed date map once
  const lastPerformedMap = useMemo(
    () => buildLastPerformedMap(sets.value, workouts.value),
    [sets.value, workouts.value],
  );

  // AC2: Escape key closes expanded panel
  useEffect(() => {
    if (!expandedId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedId(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandedId]);

  const handleToggle = (exId: string) => {
    setExpandedId(prev => (prev === exId ? null : exId));
  };

  const handleCreate = async (data: { name: string; tags: string; notes: string }) => {
    if (!token) return;
    await addExercise(data, token);
    setCreatingExercise(false);
  };

  const handleEdit = async (data: { name: string; tags: string; notes: string }) => {
    if (!token || !editingExercise) return;
    const updated: ExerciseWithRow = {
      ...editingExercise,
      name: data.name,
      tags: data.tags,
      notes: data.notes,
    };
    await editExercise(updated, token);
    setEditingExercise(null);
  };

  const handleDelete = async () => {
    if (!token || !editingExercise) return;
    if (!window.confirm(`Delete "${editingExercise.name}"? This cannot be undone.`)) return;
    await removeExercise(editingExercise, token);
    setEditingExercise(null);
  };

  if (creatingExercise) {
    return (
      <div class="screen exercises-screen">
        <header class="screen-header">
          <h1>New Exercise</h1>
        </header>
        <div class="screen-body">
          <ExerciseForm
            onSubmit={handleCreate}
            onCancel={() => setCreatingExercise(false)}
            submitLabel="Create"
          />
        </div>
      </div>
    );
  }

  if (editingExercise) {
    return (
      <div class="screen exercises-screen">
        <header class="screen-header">
          <h1>Edit Exercise</h1>
        </header>
        <div class="screen-body">
          <ExerciseForm
            initial={{
              name: editingExercise.name,
              tags: editingExercise.tags,
              notes: editingExercise.notes,
            }}
            onSubmit={handleEdit}
            onCancel={() => setEditingExercise(null)}
            submitLabel="Save"
          />
          <button
            type="button"
            class="btn btn-danger"
            style="min-height: 48px; margin-top: 16px; width: 100%;"
            onClick={handleDelete}
          >
            Delete Exercise
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="screen exercises-screen">
      <header class="screen-header">
        <h1>Exercises</h1>
      </header>
      <div class="screen-body">
        <input
          class="form-input search-input"
          type="text"
          placeholder="Search exercises..."
          value={search}
          onInput={e => setSearch((e.target as HTMLInputElement).value)}
        />

        {allTags.value.length > 0 && (
          <div class="tag-filter-row">
            {allTags.value.map(tag => (
              <LabelBadge
                key={tag}
                name={tag}
                active={selectedTags.includes(tag)}
                onClick={() => toggleTag(tag)}
              />
            ))}
          </div>
        )}

        {exercisesSignal.value.length === 0 ? (
          <div class="empty-state">
            <p>No exercises yet.</p>
            <p>Tap + to add your first exercise.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div class="empty-state">
            <p>No matching exercises</p>
          </div>
        ) : (
          <div class="exercises-full-list" style="padding-bottom: 88px;">
            {filtered.map(ex => {
              const isExpanded = expandedId === ex.id;
              const lastDate = lastPerformedMap.get(ex.id);
              const lastTimeData = isExpanded
                ? getLastTimeDataFrom(ex.id, '', sets.value, workouts.value)
                : null;

              return (
                <div
                  key={ex.id}
                  class="exercise-list-item"
                >
                  <div
                    class="exercise-list-item-header"
                    role="button"
                    aria-expanded={isExpanded}
                    tabIndex={0}
                    onClick={() => handleToggle(ex.id)}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggle(ex.id);
                      }
                    }}
                  >
                    <div class="exercise-list-item-info">
                      <span class="exercise-list-item-name">{ex.name}</span>
                      {lastDate && (
                        <span class="exercise-list-item-last-date">
                          Last: {formatShortDate(lastDate)}
                        </span>
                      )}
                      {ex.tags && (
                        <div class="exercise-list-item-tags">
                          {ex.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                            <LabelBadge key={tag} name={tag} />
                          ))}
                        </div>
                      )}
                    </div>
                    <span class={`exercise-detail-chevron${isExpanded ? ' expanded' : ''}`}>▸</span>
                  </div>

                  {isExpanded && (
                    <div class="exercise-list-item-panel">
                      {lastTimeData ? (
                        <>
                          <div class="last-time-date">
                            {formatLastTimeDate(lastTimeData.workoutDate)}
                          </div>
                          <div class="exercise-detail-sets">
                            <div class="exercise-detail-sets-header">
                              <span>Set</span>
                              <span>Weight</span>
                              <span>Reps</span>
                              <span>Effort</span>
                            </div>
                            {lastTimeData.sets.map(s => (
                              <div key={s.set_number} class="exercise-detail-set-row">
                                <span class="set-num">{s.set_number}</span>
                                <span>{s.weight ? `${s.weight} lbs` : '—'}</span>
                                <span>{s.reps || '—'}</span>
                                <span class={effortClass(s.effort)}>{s.effort || '—'}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p class="last-time-empty-text">No previous data</p>
                      )}
                      <button
                        type="button"
                        class="btn btn-secondary exercise-list-item-edit-btn"
                        onClick={(e: Event) => {
                          e.stopPropagation();
                          setEditingExercise(ex);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <button
        class="fab"
        aria-label="New exercise"
        onClick={() => setCreatingExercise(true)}
      >
        +
      </button>
    </div>
  );
}
