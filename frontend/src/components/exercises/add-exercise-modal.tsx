import { useState } from 'preact/hooks';
import { exercises as exercisesSignal, allTags } from '../../state/store';
import { addExercise } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { ExerciseForm } from './exercise-form';
import { LabelBadge } from '../shared/label-badge';
import type { ExerciseWithRow } from '../../api/types';

interface AddExerciseModalProps {
  onSelect: (exercise: ExerciseWithRow) => void;
  onClose: () => void;
}

export function AddExerciseModal({ onSelect, onClose }: AddExerciseModalProps) {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const filtered = exercisesSignal.value
    .filter((ex) => {
      const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.some((tag) =>
          ex.tags
            .split(',')
            .map((t) => t.trim())
            .includes(tag),
        );
      return matchesSearch && matchesTags;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleBackgroundClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      onClose();
    }
  };

  const handleCreate = async (data: { name: string; tags: string; notes: string }) => {
    if (!token) return;
    const created = await addExercise(data, token);
    onSelect(created);
  };

  return (
    <div class="modal-overlay" onClick={handleBackgroundClick}>
      <div class="modal-content">
        <div class="modal-header">
          <h2>{showCreateForm ? 'New Exercise' : 'Select Exercise'}</h2>
          <button class="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {showCreateForm ? (
          <ExerciseForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateForm(false)}
            submitLabel="Create & Select"
          />
        ) : (
          <>
            <input
              class="form-input search-input"
              type="text"
              placeholder="Search exercises..."
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            />

            {allTags.value.length > 0 && (
              <div class="tag-filter-row">
                {allTags.value.map((tag) => (
                  <LabelBadge
                    key={tag}
                    name={tag}
                    active={selectedTags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                  />
                ))}
              </div>
            )}

            <div class="exercise-list">
              {filtered.length === 0 ? (
                <div class="exercise-list-empty">No matching exercises</div>
              ) : (
                filtered.map((ex) => (
                  <div
                    key={ex.id}
                    class="exercise-list-item"
                    onClick={() => onSelect(ex)}
                  >
                    <span class="exercise-list-item-name">{ex.name}</span>
                    {ex.tags && (
                      <div class="exercise-list-item-tags">
                        {ex.tags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                          <LabelBadge key={tag} name={tag} />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div class="create-new-row" onClick={() => setShowCreateForm(true)}>
              + Create New Exercise
            </div>
          </>
        )}
      </div>
    </div>
  );
}
