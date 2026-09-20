import { useState } from 'preact/hooks';
import type { WorkoutType } from '../../api/types';
import { useAuth } from '../../auth/auth-context';
import { startSimpleWorkout } from '../../state/actions';
import { navigate } from '../../router/router';
import { toLocalDateStr } from '../activities/activities-helpers';
import { minutesToSeconds } from '../../api/duration';
import { EffortToggle } from '../shared/effort-toggle';
import type { Effort } from '../../api/types';
import { CardioFields } from '../shared/cardio-fields';
import { SubTypeToggle, subTypeOptions } from '../shared/sub-type-toggle';
import type { CardioValues } from '../shared/cardio-fields';
import { milesToMeters, feetToMeters, bpmToStored } from '../../api/units';

interface Props {
  workoutType: WorkoutType;
  onBack: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  stretch: 'Stretch',
  bike: 'Bike',
  hike: 'Hike',
  run: 'Run',
  walk: 'Walk',
};

export function SimpleWorkout({ workoutType, onBack }: Props) {
  const { token } = useAuth();
  const now = new Date();

  const todayStr = toLocalDateStr(now);
  const [name, setName] = useState(TYPE_LABELS[workoutType] || workoutType);
  const [date, setDate] = useState(todayStr);
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const [effort, setEffort] = useState<Effort | ''>('');
  // Unset, and it stays unset unless the user picks one (#129 AC5).
  const [subType, setSubType] = useState('');
  const [cardio, setCardio] = useState<CardioValues>({ distance: '', ascent: '', descent: '', avgHr: '' });
  const patchCardio = (patch: Partial<CardioValues>) => setCardio((c) => ({ ...c, ...patch }));

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    const safeDate = (date && !isNaN(Date.parse(date))) ? date : todayStr;
    try {
      await startSimpleWorkout({
        type: workoutType,
        name: name.trim() || TYPE_LABELS[workoutType] || workoutType,
        notes: notes.trim(),
        elapsed_seconds: minutesToSeconds(duration),
        effort,
        distance_m: milesToMeters(cardio.distance),
        ascent_m: feetToMeters(cardio.ascent),
        descent_m: feetToMeters(cardio.descent),
        avg_hr: bpmToStored(cardio.avgHr),
        sub_type: subType,
        date: safeDate,
      }, token);
      navigate('/');
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="screen simple-workout-form">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={() => {
            const dirty = notes || duration || effort || subType
              || cardio.distance || cardio.ascent || cardio.descent || cardio.avgHr;
            if (dirty && !confirm('Discard changes? Your edits will not be saved.')) return;
            onBack();
          }}
          aria-label="Back"
        >
          ← Back
        </button>
        <button
          class="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div class="form-group">
        <label class="form-label">Name</label>
        <input
          class="form-input"
          type="text"
          placeholder={`e.g. ${TYPE_LABELS[workoutType] || 'Workout'}`}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <label class="form-label" htmlFor="simple-date">Date</label>
        <input
          id="simple-date"
          class="form-input"
          type="date"
          value={date}
          max={todayStr}
          onInput={(e) => setDate((e.target as HTMLInputElement).value)}
          onBlur={() => { if (!date) setDate(todayStr); }}
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
      {subTypeOptions(workoutType).length > 0 && (
        <div class="form-group">
          <label class="form-label">Type (optional)</label>
          <SubTypeToggle
            workoutType={workoutType}
            value={subType}
            onChange={setSubType}
            label="Activity type"
          />
        </div>
      )}

      <CardioFields
        workoutType={workoutType}
        subType={subType}
        values={cardio}
        onChange={patchCardio}
        idPrefix="new"
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
    </div>
  );
}
