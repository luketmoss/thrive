import { useState } from 'preact/hooks';
import { workouts } from '../../state/store';
import { saveSimpleWorkoutEdits } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { navigate } from '../../router/router';
import { secondsToMinutesInput, minutesToSeconds } from '../../api/duration';
import { EffortToggle } from '../shared/effort-toggle';
import type { Effort } from '../../api/types';
import { CardioFields, storedToCardio } from '../shared/cardio-fields';
import { SubTypeToggle, subTypeOptions } from '../shared/sub-type-toggle';
import type { CardioValues } from '../shared/cardio-fields';
import { milesToMeters, feetToMeters, bpmToStored, metersToMilesInput, metersToFeetInput } from '../../api/units';

interface Props {
  workoutId: string;
}

export function EditWorkoutForm({ workoutId }: Props) {
  const { token } = useAuth();
  const workout = workouts.value.find((w) => w.id === workoutId);

  const [date, setDate] = useState(workout?.date || '');
  const [name, setName] = useState(workout?.name || '');
  const [duration, setDuration] = useState(secondsToMinutesInput(workout?.elapsed_seconds ?? ''));
  const [notes, setNotes] = useState(workout?.notes || '');
  const [effort, setEffort] = useState<Effort | ''>(workout?.effort || '');
  const [subType, setSubType] = useState(workout?.sub_type || '');
  const [cardio, setCardio] = useState<CardioValues>(() => storedToCardio(workout));
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

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await saveSimpleWorkoutEdits(workoutId, {
        date, name: name.trim(), notes: notes.trim(),
        elapsed_seconds: minutesToSeconds(duration), effort,
        distance_m: milesToMeters(cardio.distance),
        ascent_m: feetToMeters(cardio.ascent),
        descent_m: feetToMeters(cardio.descent),
        avg_hr: bpmToStored(cardio.avgHr),
        sub_type: subType,
      }, token);
      navigate(`/history/${workoutId}`);
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (date !== workout.date || name !== workout.name || duration !== secondsToMinutesInput(workout.elapsed_seconds) || notes !== workout.notes || effort !== (workout.effort || '') || subType !== (workout.sub_type || '')
      || JSON.stringify(cardio) !== JSON.stringify(storedToCardio(workout))) {
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
        <label class="form-label">Name</label>
        <input
          class="form-input"
          type="text"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label class="form-label">Date</label>
        <input
          class="form-input"
          type="date"
          value={date}
          onInput={(e) => setDate((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label class="form-label">Duration (minutes)</label>
        <input
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
        <label class="form-label">Notes</label>
        <textarea
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
