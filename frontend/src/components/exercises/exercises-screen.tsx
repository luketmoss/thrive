import { useState } from 'preact/hooks';
import { exercises as exercisesSignal, allTags } from '../../state/store';
import { editExercise, removeExercise } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { ExerciseForm } from './exercise-form';
import type { ExerciseWithRow } from '../../api/types';

export function ExercisesScreen() {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editingExercise, setEditingExercise] = useState<ExerciseWithRow | null>(null);

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
        selectedTags.some(tag =>
          ex.tags.split(',').map(t => t.trim()).includes(tag),
        );
      return matchesSearch && matchesTags;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

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
              <button
                key={tag}
                type="button"
                class={`tag-badge${selectedTags.includes(tag) ? ' active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {exercisesSignal.value.length === 0 ? (
          <div class="empty-state">
            <p>No exercises yet.</p>
            <p>Add one while building a template.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div class="empty-state">
            <p>No matching exercises</p>
          </div>
        ) : (
          <div class="exercises-full-list">
            {filtered.map(ex => (
              <div
                key={ex.id}
                class="exercise-list-item"
                onClick={() => setEditingExercise(ex)}
              >
                <span class="exercise-list-item-name">{ex.name}</span>
                {ex.tags && (
                  <div class="exercise-list-item-tags">
                    {ex.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                      <span key={tag} class="tag-badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
