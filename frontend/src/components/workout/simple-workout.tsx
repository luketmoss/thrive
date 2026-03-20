import { useState } from 'preact/hooks';
import type { WorkoutType } from '../../api/types';
import { useAuth } from '../../auth/auth-context';
import { startSimpleWorkout } from '../../state/actions';
import { navigate } from '../../router/router';
import { toLocalDateStr } from '../activities/activities-helpers';

interface Props {
  workoutType: WorkoutType;
  onBack: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  stretch: 'Stretch',
  bike: 'Bike',
  hike: 'Hike',
};

export function SimpleWorkout({ workoutType, onBack }: Props) {
  const { token } = useAuth();
  const now = new Date();

  const todayStr = toLocalDateStr(now);
  const [name, setName] = useState(TYPE_LABELS[workoutType] || workoutType);
  const [date, setDate] = useState(todayStr);
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
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
        duration_min: duration,
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
          onClick={onBack}
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
