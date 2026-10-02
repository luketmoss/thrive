// The exercise picker, shared by the template editor, workout builder, workout
// planner and workout tracker. #319: a keyboard- and screen-reader-operable
// dialog. Rows and "+ Create New Exercise" are plain buttons (not a listbox:
// each row commits at once and there is no selection state), and the modal owns
// its focus through `useModalFocus`. Every caller keeps its "+ Add Exercise"
// opener mounted, so restoring focus here covers all four.

import { Fragment } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { exercises as exercisesSignal, allTags } from '../../state/store';
import { addExercise } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { ExerciseForm } from './exercise-form';
import { LabelBadge } from '../shared/label-badge';
import { useModalFocus } from '../shared/use-modal-focus';
import type { ExerciseWithRow } from '../../api/types';

interface AddExerciseModalProps {
  onSelect: (exercise: ExerciseWithRow) => void;
  onClose: () => void;
}

const TITLE_ID = 'add-exercise-title';

export function AddExerciseModal({ onSelect, onClose }: AddExerciseModalProps) {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useModalFocus(dialogRef, onClose, { initialFocus: '.search-input' });

  // Switching views moves focus with it: the form's Name field, or back to search.
  useEffect(() => {
    if (showCreateForm) {
      dialogRef.current?.querySelector<HTMLInputElement>('form input')?.focus();
    } else {
      searchRef.current?.focus();
    }
  }, [showCreateForm]);

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
      <div
        class="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        ref={dialogRef}
      >
        <div class="modal-header">
          <h2 id={TITLE_ID}>{showCreateForm ? 'New Exercise' : 'Select Exercise'}</h2>
          <button type="button" class="modal-close" onClick={onClose} aria-label="Close">
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
              ref={searchRef}
              class="form-input search-input"
              type="text"
              placeholder="Search exercises..."
              aria-label="Search exercises"
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            />

            {allTags.value.length > 0 && (
              <div class="tag-filter-row" role="group" aria-label="Filter by tag">
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
              {/* Always mounted, so the empty message is announced when it appears. */}
              <div class="exercise-list-status" role="status">
                {filtered.length === 0 && <div class="exercise-list-empty">No matching exercises</div>}
              </div>
              {filtered.map((ex) => {
                const tags = ex.tags.split(',').map((t) => t.trim()).filter(Boolean);
                const nameId = `add-exercise-${ex.id}-name`;
                const tagsId = `add-exercise-${ex.id}-tags`;
                return (
                  <button
                    key={ex.id}
                    type="button"
                    class="exercise-list-item"
                    aria-labelledby={nameId}
                    aria-describedby={tags.length > 0 ? tagsId : undefined}
                    onClick={() => onSelect(ex)}
                  >
                    <span id={nameId} class="exercise-list-item-name">{ex.name}</span>
                    {tags.length > 0 && (
                      <span id={tagsId} class="exercise-list-item-tags">
                        {tags.map((tag, i) => (
                          <Fragment key={tag}>
                            {i > 0 && <span class="sr-only">, </span>}
                            <LabelBadge name={tag} />
                          </Fragment>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button type="button" class="create-new-row" onClick={() => setShowCreateForm(true)}>
              + Create New Exercise
            </button>
          </>
        )}
      </div>
    </div>
  );
}
