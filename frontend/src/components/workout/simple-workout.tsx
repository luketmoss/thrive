import { useState, useId } from 'preact/hooks';
import type { WorkoutType } from '../../api/types';
import { useAuth } from '../../auth/auth-context';
import { startSimpleWorkout, finishSimpleWorkout, deleteWorkout } from '../../state/actions';
import { workouts } from '../../state/store';
import { navigate } from '../../router/router';
import { toLocalDateStr } from '../activities/activities-helpers';
import { minutesToSeconds, secondsToMinutesInput } from '../../api/duration';
import { EffortToggle } from '../shared/effort-toggle';
import type { Effort } from '../../api/types';
import { CardioFields } from '../shared/cardio-fields';
import { SubTypeToggle, subTypeOptions } from '../shared/sub-type-toggle';
import type { CardioValues } from '../shared/cardio-fields';
import { milesToMeters, feetToMeters, bpmToStored, metersToMilesInput, metersToFeetInput } from '../../api/units';

interface Props {
  workoutType: WorkoutType;
  /** Set when resuming a started planned workout: Save finishes that row (#360). */
  workoutId?: string;
  onBack: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  stretch: 'Stretch',
  bike: 'Bike',
  hike: 'Hike',
  run: 'Run',
  walk: 'Walk',
};

export function SimpleWorkout({ workoutType, workoutId, onBack }: Props) {
  const { token } = useAuth();
  const uid = useId();
  const nameId = `simple-name-${uid}`;
  const durationId = `simple-duration-${uid}`;
  const notesId = `simple-notes-${uid}`;
  const typeLabelId = `simple-type-label-${uid}`;
  const effortLabelId = `simple-effort-label-${uid}`;
  const now = new Date();

  const todayStr = toLocalDateStr(now);
  // Resuming: start from the stored row, blanks staying blank (#360 AC2).
  const existing = workoutId ? workouts.value.find((w) => w.id === workoutId) : undefined;
  const [initial] = useState(() => ({
    name: existing?.name || TYPE_LABELS[workoutType] || workoutType,
    date: existing?.date || todayStr,
    notes: existing?.notes ?? '',
    duration: existing ? secondsToMinutesInput(existing.elapsed_seconds) : '',
    effort: (existing?.effort ?? '') as Effort | '',
    // Unset, and it stays unset unless the user picks one (#129 AC5).
    subType: existing?.sub_type ?? '',
    cardio: {
      distance: existing ? metersToMilesInput(existing.distance_m) : '',
      ascent: existing ? metersToFeetInput(existing.ascent_m) : '',
      descent: existing ? metersToFeetInput(existing.descent_m) : '',
      avgHr: existing?.avg_hr ?? '',
    } as CardioValues,
  }));
  const [name, setName] = useState(initial.name);
  const [date, setDate] = useState(initial.date);
  const [notes, setNotes] = useState(initial.notes);
  const [duration, setDuration] = useState(initial.duration);
  const [effort, setEffort] = useState<Effort | ''>(initial.effort);
  const [subType, setSubType] = useState(initial.subType);
  const [cardio, setCardio] = useState<CardioValues>(initial.cardio);
  const patchCardio = (patch: Partial<CardioValues>) => setCardio((c) => ({ ...c, ...patch }));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    const safeDate = (date && !isNaN(Date.parse(date))) ? date : todayStr;
    try {
      const data = {
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
      };
      if (workoutId) {
        await finishSimpleWorkout(workoutId, data, token);
      } else {
        await startSimpleWorkout({ type: workoutType, ...data }, token);
      }
      navigate('/activities');
    } catch {
      // Error toast shown by action
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !workoutId || busy) return;
    if (!confirm('Delete this workout? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deleteWorkout(workoutId, token);
      navigate('/activities');
    } catch {
      // Error toast shown by action
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="screen simple-workout-form">
      <div class="template-editor-header">
        <button
          class="template-editor-back"
          onClick={() => {
            const dirty = name !== initial.name || date !== initial.date
              || notes !== initial.notes || duration !== initial.duration
              || effort !== initial.effort || subType !== initial.subType
              || cardio.distance !== initial.cardio.distance || cardio.ascent !== initial.cardio.ascent
              || cardio.descent !== initial.cardio.descent || cardio.avgHr !== initial.cardio.avgHr;
            if (dirty && !confirm('Discard changes? Your edits will not be saved.')) return;
            // A resumed workout has no type picker to go back to.
            if (workoutId) navigate('/activities');
            else onBack();
          }}
          aria-label="Back"
        >
          ← Back
        </button>
        <button
          class="btn btn-primary"
          onClick={handleSave}
          disabled={busy}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div class="form-group">
        <label class="form-label" htmlFor={nameId}>Name</label>
        <input
          id={nameId}
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
        <label class="form-label" htmlFor={durationId}>Duration (minutes)</label>
        <input
          id={durationId}
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
          <span class="form-label" id={typeLabelId}>Type (optional)</span>
          <SubTypeToggle
            workoutType={workoutType}
            value={subType}
            onChange={setSubType}
            label="Activity type"
            labelledBy={typeLabelId}
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
        <span class="form-label" id={effortLabelId}>Session Effort (optional)</span>
        <EffortToggle
          value={effort}
          onChange={setEffort}
          size="session"
          label="Session effort"
          labelledBy={effortLabelId}
        />
      </div>

      <div class="form-group">
        <label class="form-label" htmlFor={notesId}>Notes</label>
        <textarea
          id={notesId}
          class="form-textarea"
          placeholder="How did it go?"
          rows={5}
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        />
      </div>

      {workoutId && (
        <div class="form-group">
          <button
            class="btn btn-danger simple-workout-delete"
            onClick={handleDelete}
            disabled={busy}
            aria-label="Delete workout"
          >
            {deleting ? 'Deleting...' : 'Delete workout'}
          </button>
        </div>
      )}
    </div>
  );
}
