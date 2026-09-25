import { useState } from 'preact/hooks';
import { workouts } from '../../state/store';
import { saveSimpleWorkoutEdits } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { EffortToggle } from '../shared/effort-toggle';
import type { Effort } from '../../api/types';
import { CardioFields } from '../shared/cardio-fields';
import { SubTypeToggle, subTypeOptions } from '../shared/sub-type-toggle';
import type { CardioValues } from '../shared/cardio-fields';
import { workoutToEditInputs, editInputsToPatch, hasEdits } from '../shared/edit-patch';

interface Props {
  workoutId: string;
}

export function EditWorkoutForm({ workoutId }: Props) {
  const { token } = useAuth();
  const workout = workouts.value.find((w) => w.id === workoutId);

  // What every input was pre-filled with, fixed at mount. A save writes only
  // the fields whose input now differs from it (#172).
  const [initial] = useState(() => workoutToEditInputs(workout));
  const [date, setDate] = useState(initial.date);
  const [name, setName] = useState(initial.name);
  const [duration, setDuration] = useState(initial.duration);
  const [notes, setNotes] = useState(initial.notes);
  const [effort, setEffort] = useState<Effort | ''>(initial.effort);
  const [subType, setSubType] = useState(initial.subType);
  const [cardio, setCardio] = useState<CardioValues>(() => ({
    distance: initial.distance, ascent: initial.ascent, descent: initial.descent, avgHr: initial.avgHr,
  }));
  const patchCardio = (patch: Partial<CardioValues>) => setCardio((c) => ({ ...c, ...patch }));
  const [saving, setSaving] = useState(false);

  if (!workout) {
    return (
      <div class="screen">
        <div class="empty-state">
          <p>Workout not found</p>
          <button class="btn btn-primary" onClick={() => navigate('/')}>Back to Activities</button>
        </div>
      </div>
    );
  }

  const current = { date, name, duration, notes, effort, subType, ...cardio };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await saveSimpleWorkoutEdits(workoutId, editInputsToPatch(initial, current), token);
      navigate(`/history/${workoutId}`);
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (hasEdits(initial, current)) {
      if (!confirm('Discard changes? Your edits will not be saved.')) return;
    }
    navigate(`/history/${workoutId}`);
  };

  return (
    <div class="screen simple-workout-form">
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
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <h2 class="detail-title" style={{ marginBottom: 'var(--space-md)' }}>
        Edit: {workout.name || workout.type}
      </h2>

      <div class="form-group">
        <label class="form-label" htmlFor="edit-name">Name</label>
        <input
          id="edit-name"
          class="form-input"
          type="text"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label class="form-label" htmlFor="edit-date">Date</label>
        <input
          id="edit-date"
          class="form-input"
          type="date"
          value={date}
          onInput={(e) => setDate((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label class="form-label" htmlFor="edit-duration">Duration (minutes)</label>
        <input
          id="edit-duration"
          class="form-input"
          type="number"
          inputMode="numeric"
          placeholder="e.g. 30"
          value={duration}
          onInput={(e) => setDuration((e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Directly above the fields it governs — venue decides which of them
          are asked for, so the two belong together (#129 AC2). */}
      {subTypeOptions(workout.type).length > 0 && (
        <div class="form-group">
          <label class="form-label">Type (optional)</label>
          <SubTypeToggle
            workoutType={workout.type}
            value={subType}
            onChange={setSubType}
            label="Activity type"
          />
        </div>
      )}

      <CardioFields
        workoutType={workout.type}
        subType={subType}
        values={cardio}
        onChange={patchCardio}
        idPrefix="edit"
      />

      <div class="form-group">
        <label class="form-label">Session Effort (optional)</label>
        <EffortToggle
          value={effort}
          onChange={setEffort}
          size="session"
          label="Session effort"
        />
      </div>

      <div class="form-group">
        <label class="form-label" htmlFor="edit-notes">Notes</label>
        <textarea
          id="edit-notes"
          class="form-textarea"
          placeholder="How did it go?"
          rows={5}
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        />
      </div>

      <button
        class="btn btn-danger"
        style={{ width: '100%', marginTop: 'var(--space-lg)' }}
        onClick={handleDiscard}
      >
        Discard Changes
      </button>
    </div>
  );
}
