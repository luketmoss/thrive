import { useState, useEffect } from 'preact/hooks';
import { templates } from '../../state/store';
import { addTemplate, editTemplate, removeTemplate } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { AddExerciseModal } from '../exercises/add-exercise-modal';
import { TemplateExerciseRow } from './template-exercise-row';
import type { TemplateExerciseSlot } from './template-exercise-row';
import type { ExerciseWithRow } from '../../api/types';

const SECTIONS = ['warmup', 'primary', 'SS1', 'SS2', 'SS3', 'burnout', 'cooldown'] as const;

interface Props {
  templateId?: string;
}

export function TemplateEditor({ templateId }: Props) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<TemplateExerciseSlot[]>([]);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [saving, setSaving] = useState(false);

  // Populate state in edit mode
  useEffect(() => {
    if (!templateId) return;
    const tpl = templates.value.find((t) => t.id === templateId);
    if (tpl) {
      setName(tpl.name);
      setExercises(
        tpl.exercises.map((r) => ({
          exercise_id: r.exercise_id,
          exercise_name: r.exercise_name,
          section: r.section as string,
          sets: r.sets,
          reps: r.reps,
          rest_seconds: r.rest_seconds,
          group_rest_seconds: r.group_rest_seconds,
        })),
      );
    }
  }, [templateId]);

  const handleExerciseSelected = (ex: ExerciseWithRow) => {
    const slot: TemplateExerciseSlot = {
      exercise_id: ex.id,
      exercise_name: ex.name,
      section: 'primary',
      sets: '3',
      reps: '10',
      rest_seconds: '',
      group_rest_seconds: '',
    };
    setExercises((prev) => [...prev, slot]);
    setShowExercisePicker(false);
    setEditingIndex(exercises.length); // open config for newly added
  };

  const updateExercise = (index: number, updated: Partial<TemplateExerciseSlot>) => {
    setExercises((prev) =>
      prev.map((ex, i) => (i === index ? { ...ex, ...updated } : ex)),
    );
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setExercises((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
    if (editingIndex === index) setEditingIndex(index - 1);
    else if (editingIndex === index - 1) setEditingIndex(index);
  };

  const moveDown = (index: number) => {
    if (index >= exercises.length - 1) return;
    setExercises((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    if (editingIndex === index) setEditingIndex(index + 1);
    else if (editingIndex === index + 1) setEditingIndex(index);
  };

  const removeExercise = (index: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
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
        sets: ex.sets,
        reps: ex.reps,
        rest_seconds: ex.rest_seconds,
        group_rest_seconds: ex.group_rest_seconds,
      }));

      if (templateId) {
        // Edit mode: get existing rows for deletion
        const tpl = templates.value.find((t) => t.id === templateId);
        const existingRows = tpl?.exercises ?? [];
        await editTemplate(templateId, name.trim(), inputs, existingRows, token);
      } else {
        await addTemplate(name.trim(), inputs, token);
      }
      navigate('/templates');
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !templateId) return;
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

  const showGroupRest = (section: string) =>
    section === 'primary' || section.startsWith('SS');

  return (
    <div class="screen template-editor">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={() => navigate('/templates')}
          aria-label="Back"
        >
          ← Back
        </button>
        <button
          class="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !name.trim() || exercises.length === 0}
        >
          {saving ? 'Saving...' : 'Save'}
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

      <div class="template-exercise-list">
        {exercises.length === 0 && (
          <div class="empty-state">
            <p>No exercises yet</p>
            <p>Add exercises to build your template</p>
          </div>
        )}

        {exercises.map((ex, i) => (
          <div key={`${ex.exercise_id}-${i}`}>
            <TemplateExerciseRow
              exercise={ex}
              index={i}
              total={exercises.length}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
              onEdit={() => setEditingIndex(editingIndex === i ? -1 : i)}
              onRemove={() => removeExercise(i)}
            />

            {editingIndex === i && (
              <div class="template-exercise-config">
                <div class="form-group">
                  <label class="form-label">Section</label>
                  <select
                    class="form-select section-select"
                    value={ex.section}
                    onChange={(e) =>
                      updateExercise(i, { section: (e.target as HTMLSelectElement).value })
                    }
                  >
                    {SECTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div class="config-row">
                  <div class="form-group" style={{ flex: 1 }}>
                    <label class="form-label">Sets</label>
                    <input
                      class="form-input"
                      type="text"
                      placeholder="e.g. 3 or 4-5"
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
                      type="text"
                      placeholder="e.g. 10 or 8-12"
                      value={ex.reps}
                      onInput={(e) =>
                        updateExercise(i, { reps: (e.target as HTMLInputElement).value })
                      }
                    />
                  </div>
                </div>

                <div class="config-row">
                  <div class="form-group" style={{ flex: 1 }}>
                    <label class="form-label">Rest (s)</label>
                    <input
                      class="form-input"
                      type="text"
                      placeholder="e.g. 90"
                      value={ex.rest_seconds}
                      onInput={(e) =>
                        updateExercise(i, { rest_seconds: (e.target as HTMLInputElement).value })
                      }
                    />
                  </div>
                  {showGroupRest(ex.section) && (
                    <div class="form-group" style={{ flex: 1 }}>
                      <label class="form-label">Group Rest (s)</label>
                      <input
                        class="form-input"
                        type="text"
                        placeholder="e.g. 120"
                        value={ex.group_rest_seconds}
                        onInput={(e) =>
                          updateExercise(i, { group_rest_seconds: (e.target as HTMLInputElement).value })
                        }
                      />
                    </div>
                  )}
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
        <button
          class="btn btn-danger"
          style={{ width: '100%', marginTop: 'var(--space-md)' }}
          onClick={handleDelete}
          disabled={saving}
        >
          Delete Template
        </button>
      )}

      {showExercisePicker && (
        <AddExerciseModal
          onSelect={handleExerciseSelected}
          onClose={() => setShowExercisePicker(false)}
        />
      )}
    </div>
  );
}
