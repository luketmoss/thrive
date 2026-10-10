import { useState, useEffect, useRef } from 'preact/hooks';
import { templates } from '../../state/store';
import { addTemplate, editTemplate, removeTemplate } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { AddExerciseModal } from '../exercises/add-exercise-modal';
import { ExerciseCompactCard } from '../shared/exercise-compact-card';
import { newRowKey, swapAt, useReorderFocus, type MoveDirection } from '../shared/reorder-focus';
import { SectionPicker } from '../shared/section-picker';
import type { ExerciseWithRow } from '../../api/types';

export interface TemplateExerciseSlot {
  exercise_id: string;
  exercise_name: string;
  section: string;
  sets: string;
  reps: string;
}

interface Props {
  templateId?: string;
}

export function TemplateEditor({ templateId }: Props) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<TemplateExerciseSlot[]>([]);
  // Client-only row identities, parallel to `exercises` (#328).
  const [rowKeys, setRowKeys] = useState<string[]>([]);
  const reorder = useReorderFocus();
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [saving, setSaving] = useState(false);

  // Track initial state for dirty checking
  const initialState = useRef({ name: '', exercises: '' });

  // Populate state in edit mode
  useEffect(() => {
    if (!templateId) {
      initialState.current = { name: '', exercises: '' };
      return;
    }
    const tpl = templates.value.find((t) => t.id === templateId);
    if (tpl) {
      const mapped = tpl.exercises.map((r) => ({
        exercise_id: r.exercise_id,
        exercise_name: r.exercise_name,
        section: r.section as string,
        sets: r.sets,
        reps: r.reps,
      }));
      setName(tpl.name);
      setExercises(mapped);
      setRowKeys(mapped.map(() => newRowKey()));
      initialState.current = { name: tpl.name, exercises: JSON.stringify(mapped) };
    }
  }, [templateId]);

  const handleExerciseSelected = (ex: ExerciseWithRow) => {
    const slot: TemplateExerciseSlot = {
      exercise_id: ex.id,
      exercise_name: ex.name,
      section: 'primary',
      sets: '1',
      reps: '',
    };
    setExercises((prev) => [...prev, slot]);
    setRowKeys((prev) => [...prev, newRowKey()]);
    setShowExercisePicker(false);
    setEditingIndex(exercises.length); // open config for newly added
  };

  const updateExercise = (index: number, updated: Partial<TemplateExerciseSlot>) => {
    setExercises((prev) =>
      prev.map((ex, i) => (i === index ? { ...ex, ...updated } : ex)),
    );
  };

  const move = (index: number, dir: MoveDirection) => {
    const to = dir === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= exercises.length) return;
    setExercises((prev) => swapAt(prev, index, to));
    setRowKeys((prev) => swapAt(prev, index, to));
    if (editingIndex === index) setEditingIndex(to);
    else if (editingIndex === to) setEditingIndex(index);
    reorder.moved(rowKeys[index], dir, exercises[index].exercise_name, to + 1, exercises.length);
  };

  const removeExercise = (index: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    setRowKeys((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(-1);
    else if (editingIndex > index) setEditingIndex(editingIndex - 1);
  };

  const handleSave = async () => {
    if (!token || !name.trim() || exercises.length === 0) return;
    setSaving(true);
    try {
      const inputs = exercises.map((ex) => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        section: ex.section,
        sets: ex.sets || '1',
        reps: ex.reps,
      }));

      if (templateId) {
        const tpl = templates.value.find((t) => t.id === templateId);
        const existingRows = tpl?.exercises ?? [];
        await editTemplate(templateId, name.trim(), inputs, existingRows, token);
        navigate(`/templates/${templateId}`);
      } else {
        await addTemplate(name.trim(), inputs, token);
        navigate('/templates');
      }
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !templateId) return;
    if (!confirm('Delete this template? This cannot be undone.')) return;
    const tpl = templates.value.find((t) => t.id === templateId);
    if (!tpl) return;
    setSaving(true);
    try {
      await removeTemplate(templateId, tpl.exercises, token);
      navigate('/templates');
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  const isDirty = () => {
    if (name !== initialState.current.name) return true;
    if (JSON.stringify(exercises) !== initialState.current.exercises) return true;
    return false;
  };

  const handleDiscard = () => {
    if (isDirty() && !confirm('Discard changes? Your edits will not be saved.')) return;
    if (templateId) {
      navigate(`/templates/${templateId}`);
    } else {
      navigate('/templates');
    }
  };

  return (
    <div class="screen template-editor">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={handleDiscard}
          aria-label="Back"
        >
          ← Back
        </button>
        <button
          class="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !name.trim() || exercises.length === 0}
        >
          {saving ? 'Saving...' : 'Save Template'}
        </button>
      </div>

      <div class="form-group">
        <label class="form-label">Template Name</label>
        <input
          class="form-input"
          type="text"
          placeholder="e.g. Upper Push A"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="compact-card-list" ref={reorder.listRef}>
        {exercises.length === 0 && (
          <div class="empty-state">
            <p>No exercises yet</p>
            <p>Add exercises to build your template</p>
          </div>
        )}

        {exercises.map((ex, i) => (
          <div key={rowKeys[i] ?? `pos-${i}`} data-row-key={rowKeys[i]}>
            <ExerciseCompactCard
              section={ex.section}
              exerciseName={ex.exercise_name}
              sets={ex.sets}
              reps={ex.reps}
              editable
              index={i}
              total={exercises.length}
              onMoveUp={() => move(i, 'up')}
              onMoveDown={() => move(i, 'down')}
              onClick={() => setEditingIndex(editingIndex === i ? -1 : i)}
              expanded={editingIndex === i}
              onRemove={() => removeExercise(i)}
            />

            {editingIndex === i && (
              <div class="template-exercise-config">
                <SectionPicker
                  value={ex.section}
                  onChange={(section) => updateExercise(i, { section })}
                />

                <div class="config-row" style={{ marginTop: 'var(--space-sm)' }}>
                  <div class="form-group" style={{ flex: 1 }}>
                    <label class="form-label">Sets</label>
                    <input
                      class="form-input"
                      type="number"
                      min="1"
                      max="20"
                      placeholder="e.g. 3"
                      value={ex.sets}
                      onInput={(e) =>
                        updateExercise(i, { sets: (e.target as HTMLInputElement).value })
                      }
                    />
                  </div>
                  <div class="form-group" style={{ flex: 1 }}>
                    <label class="form-label">Reps</label>
                    <input
                      class="form-input"
                      type="number"
                      min="0"
                      placeholder="e.g. 10"
                      value={ex.reps}
                      onInput={(e) =>
                        updateExercise(i, { reps: (e.target as HTMLInputElement).value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        class="btn btn-secondary"
        style={{ width: '100%', marginTop: 'var(--space-md)' }}
        onClick={() => setShowExercisePicker(true)}
      >
        + Add Exercise
      </button>

      {templateId && (
        <>
          <button
            class="btn btn-ghost"
            style={{ width: '100%', marginTop: 'var(--space-md)' }}
            onClick={handleDiscard}
          >
            Discard Changes
          </button>
          <button
            class="btn btn-danger"
            style={{ width: '100%', marginTop: 'var(--space-sm)' }}
            onClick={handleDelete}
            disabled={saving}
          >
            Delete Template
          </button>
        </>
      )}

      {/* Mounted empty with the screen so the first move is announced (#328). */}
      <div role="status" aria-live="polite" class="sr-only">
        {reorder.announcement}
      </div>

      {showExercisePicker && (
        <AddExerciseModal
          onSelect={handleExerciseSelected}
          onClose={() => setShowExercisePicker(false)}
        />
      )}
    </div>
  );
}
