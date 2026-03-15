import { useState, useEffect } from 'preact/hooks';
import { SetRow } from './set-row';
import { LastTimePanel } from './last-time-panel';
import { ALL_SECTIONS } from './section-management';
import type { TrackerSet } from './set-row';
import type { Effort, SetWithRow } from '../../api/types';

export interface TrackerExercise {
  exercise_id: string;
  exercise_name: string;
  section: string;
  exercise_order: number;
  sets: TrackerSet[];
  quickFillWeight: string;
  quickFillReps: string;
  quickFillEffort: Effort | '';
}

interface Props {
  exercise: TrackerExercise;
  currentWorkoutId: string;
  onUpdateSet: (setNumber: number, updates: Partial<TrackerSet>) => void;
  onAddSet: () => void;
  onRemoveSet: (setNumber: number) => void;
  onQuickFillWeight: (weight: string) => void;
  onQuickFillReps: (reps: string) => void;
  onQuickFillEffort: (effort: Effort | '') => void;
  onCopyDown: (lastTimeSets: SetWithRow[]) => void;
  onChangeSection: (newSection: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveExercise: () => void;
  isFirst: boolean;
  isLast: boolean;
  totalExercises: number;
}

function sectionBadgeClass(section: string): string {
  if (section.startsWith('SS')) return 'section-badge section-ss';
  return `section-badge section-${section}`;
}

function sectionPillClass(section: string, active: boolean): string {
  const base = 'section-picker-pill';
  if (!active) return base;
  if (section.startsWith('SS')) return `${base} section-picker-pill-active section-ss`;
  return `${base} section-picker-pill-active section-${section}`;
}

export function ExerciseRow({
  exercise,
  currentWorkoutId,
  onUpdateSet,
  onAddSet,
  onRemoveSet,
  onQuickFillWeight,
  onQuickFillReps,
  onQuickFillEffort,
  onCopyDown,
  onChangeSection,
  onMoveUp,
  onMoveDown,
  onRemoveExercise,
  isFirst,
  isLast,
  totalExercises,
}: Props) {
  const isWarmup = exercise.section === 'warmup';
  const [showLastTime, setShowLastTime] = useState(false);
  const [flashSets, setFlashSets] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [showWarmupConfirm, setShowWarmupConfirm] = useState(false);

  // Escape closes section picker / warmup confirm
  useEffect(() => {
    if (!showSectionPicker && !showWarmupConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSectionPicker(false);
        setShowWarmupConfirm(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showSectionPicker, showWarmupConfirm]);

  // Escape key closes the last-time panel
  useEffect(() => {
    if (!showLastTime) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowLastTime(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showLastTime]);

  const handleSectionBadgeClick = () => {
    if (showSectionPicker) {
      setShowSectionPicker(false);
      setShowWarmupConfirm(false);
    } else {
      setShowSectionPicker(true);
      setShowWarmupConfirm(false);
    }
  };

  const handlePillClick = (section: string) => {
    if (section === exercise.section) {
      // Already selected — collapse picker
      setShowSectionPicker(false);
      return;
    }
    if (section === 'warmup' && !isWarmup) {
      // Show warmup confirmation
      setShowWarmupConfirm(true);
      setShowSectionPicker(false);
      return;
    }
    onChangeSection(section);
    setShowSectionPicker(false);
    setShowWarmupConfirm(false);
  };

  const handleConfirmWarmup = () => {
    onChangeSection('warmup');
    setShowWarmupConfirm(false);
  };

  const showToolbar = totalExercises > 1;

  const sectionPickerRow = showSectionPicker && (
    <div class="section-picker-row" role="group" aria-label="Select section">
      {ALL_SECTIONS.map((s) => (
        <button
          key={s}
          type="button"
          class={sectionPillClass(s, s === exercise.section)}
          onClick={() => handlePillClick(s)}
          aria-pressed={s === exercise.section ? 'true' : 'false'}
        >
          {s}
        </button>
      ))}
    </div>
  );

  const warmupConfirmRow = showWarmupConfirm && (
    <div class="warmup-confirm-row">
      <p class="warmup-confirm-text">
        Warmup exercises are list-only — set data will be removed.
      </p>
      <div class="warmup-confirm-actions">
        <button
          type="button"
          class="btn btn-danger"
          onClick={handleConfirmWarmup}
        >
          Switch to Warmup
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          onClick={() => setShowWarmupConfirm(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const toolbarRow = showToolbar && (
    <div class="exercise-toolbar-row">
      <button
        type="button"
        class="exercise-toolbar-btn"
        onClick={onMoveUp}
        disabled={isFirst}
        aria-label={`Move ${exercise.exercise_name} up`}
      >
        ▲
      </button>
      <button
        type="button"
        class="exercise-toolbar-btn"
        onClick={onMoveDown}
        disabled={isLast}
        aria-label={`Move ${exercise.exercise_name} down`}
      >
        ▼
      </button>
      <button
        type="button"
        class="exercise-toolbar-btn exercise-toolbar-remove"
        onClick={onRemoveExercise}
        aria-label={`Remove ${exercise.exercise_name}`}
      >
        ✕
      </button>
    </div>
  );

  // Warmup exercises render as simplified name-only cards
  if (isWarmup) {
    return (
      <div
        class="tracker-exercise tracker-exercise-warmup"
        aria-label={`Warmup: ${exercise.exercise_name} (list only)`}
      >
        <div class="tracker-exercise-header">
          <button
            type="button"
            class={`${sectionBadgeClass(exercise.section)} section-badge-btn`}
            onClick={handleSectionBadgeClick}
            aria-label={`Change section (current: ${exercise.section})`}
            aria-expanded={showSectionPicker ? 'true' : 'false'}
          >
            {exercise.section}
          </button>
          <span class="tracker-exercise-name">{exercise.exercise_name}</span>
        </div>
        {sectionPickerRow}
        {warmupConfirmRow}
        {toolbarRow}
      </div>
    );
  }

  const isSS = exercise.section.startsWith('SS');
  const cardClass = `tracker-exercise${isSS ? ` section-ss-group ss-${exercise.section}` : ''}`;

  return (
    <div class={cardClass}>
      <div class="tracker-exercise-controls">
        <button
          type="button"
          class={`${sectionBadgeClass(exercise.section)} section-badge-btn`}
          onClick={handleSectionBadgeClick}
          aria-label={`Change section (current: ${exercise.section})`}
          aria-expanded={showSectionPicker ? 'true' : 'false'}
        >
          {exercise.section}
        </button>
        <div class="tracker-exercise-actions">
          <button
            type="button"
            class="last-time-toggle exercise-toolbar-btn"
            onClick={() => setShowLastTime(!showLastTime)}
            aria-label={`View previous performance for ${exercise.exercise_name}`}
            aria-expanded={showLastTime ? 'true' : 'false'}
          >
            <svg class="last-time-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          {showToolbar && (
            <>
              <button
                type="button"
                class="exercise-toolbar-btn"
                onClick={onMoveUp}
                disabled={isFirst}
                aria-label={`Move ${exercise.exercise_name} up`}
              >
                ▲
              </button>
              <button
                type="button"
                class="exercise-toolbar-btn"
                onClick={onMoveDown}
                disabled={isLast}
                aria-label={`Move ${exercise.exercise_name} down`}
              >
                ▼
              </button>
              <button
                type="button"
                class="exercise-toolbar-btn exercise-toolbar-remove"
                onClick={onRemoveExercise}
                aria-label={`Remove ${exercise.exercise_name}`}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      <div class="tracker-exercise-name-row">
        <span class="tracker-exercise-name">{exercise.exercise_name}</span>
      </div>

      {sectionPickerRow}
      {warmupConfirmRow}

      {showLastTime && (
        <LastTimePanel
          exerciseId={exercise.exercise_id}
          exerciseName={exercise.exercise_name}
          currentWorkoutId={currentWorkoutId}
          onCopyDown={(lastTimeSets) => {
            onCopyDown(lastTimeSets);
            setFlashSets(true);
            setTimeout(() => setFlashSets(false), 600);
          }}
        />
      )}

      <div class="quick-fill-row">
        <span class="quick-fill-spacer" aria-hidden="true" />
        <div class="set-inputs">
          <input
            id={`quick-fill-wt-${exercise.exercise_id}-${exercise.exercise_order}`}
            class="form-input set-weight-input"
            type="number"
            inputMode="decimal"
            placeholder="lbs"
            aria-label="Fill all sets weight (lbs)"
            value={exercise.quickFillWeight}
            onInput={(e) => onQuickFillWeight((e.target as HTMLInputElement).value)}
          />
          <span class="set-input-separator">×</span>
          <input
            id={`quick-fill-reps-${exercise.exercise_id}-${exercise.exercise_order}`}
            class="form-input set-reps-input"
            type="number"
            inputMode="numeric"
            placeholder="reps"
            aria-label="Fill all sets reps"
            value={exercise.quickFillReps}
            onInput={(e) => onQuickFillReps((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="effort-toggle">
          {(['Easy', 'Medium', 'Hard'] as Effort[]).map((e) => (
            <button
              key={e}
              class={`effort-btn effort-btn-${e.toLowerCase()}${exercise.quickFillEffort === e ? ' active' : ''}`}
              onClick={() => onQuickFillEffort(exercise.quickFillEffort === e ? '' : e)}
              aria-label={`Fill all sets: ${e}`}
              aria-pressed={exercise.quickFillEffort === e ? 'true' : 'false'}
            >
              {e === 'Easy' ? 'E' : e === 'Medium' ? 'M' : 'H'}
            </button>
          ))}
        </div>
        <span class="quick-fill-end-spacer" aria-hidden="true" />
      </div>

      <div class={`tracker-set-list${flashSets ? ' copy-down-flash' : ''}`}>
        {exercise.sets.map((set) => (
          <SetRow
            key={set.set_number}
            set={set}
            onUpdate={(updates) => onUpdateSet(set.set_number, updates)}
            onRemove={() => onRemoveSet(set.set_number)}
          />
        ))}
      </div>

      <button class="add-set-btn" onClick={onAddSet}>
        + Add Set
      </button>
    </div>
  );
}
