import { useRef } from 'preact/hooks';
import { REPS_INPUT_PROPS, isHeldReps, isWholeReps } from '../workout/planned-reps';

interface Props {
  /** The input's id, for the caller's `<label for>`. */
  id: string;
  /**
   * The value as held: blank, whole-number reps, or held text (`4-6`,
   * `AMRAP`) shown read-only beside an empty input. Never reformatted here.
   */
  value: string;
  /** Called only with blank or whole-number reps, never with held text. */
  onChange: (value: string) => void;
  /** Exercise name, for Clear's accessible name. */
  exerciseName: string;
  /** Set number, for a per-set row: `inline` layout and "Clear set 2 reps …". */
  setNumber?: number;
  /** Shown when nothing is held; default `e.g. 10`, none on a per-set row. */
  placeholder?: string;
  /** Extra description read before "Whole number only." (the Varies hint). */
  hint?: string;
}

/**
 * A planned-Reps field (#376): whole numbers only. A stored value that is not
 * one is held: shown as read-only text beside an empty input, with a Clear,
 * and left untouched until the user types a number over it or presses Clear.
 * An edit that would leave anything other than blank or whole-number reps is
 * refused by restoring the input's previous value.
 */
export function RepsField({ id, value, onChange, exerciseName, setNumber, placeholder, hint }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const held = isHeldReps(value);
  const display = held ? '' : value;
  const descId = `${id}-desc`;
  const inline = setNumber !== undefined;
  const what = inline ? `set ${setNumber} reps` : 'reps';
  const shownPlaceholder = held ? '' : placeholder ?? (inline ? '' : 'e.g. 10');

  const handleInput = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const next = el.value;
    if (next === display) return;
    if (next === '' || isWholeReps(next)) {
      onChange(next);
      return;
    }
    el.value = display;
  };

  const clear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  const input = (
    <input
      ref={inputRef}
      id={id}
      class="form-input"
      {...REPS_INPUT_PROPS}
      placeholder={shownPlaceholder || undefined}
      aria-describedby={descId}
      value={display}
      onInput={handleInput}
    />
  );

  const clearButton = held && (
    <button
      type="button"
      class="btn btn-secondary reps-field-clear"
      aria-label={`Clear ${what} ${value}, ${exerciseName}`}
      onClick={clear}
    >
      Clear
    </button>
  );

  const rest = '. Whole number only: type one to replace it, or press Clear.';

  if (inline) {
    return (
      <span class="reps-field reps-field-inline">
        {input}
        {held ? (
          <span id={descId} class="reps-field-held">
            <span class="sr-only">Planned </span>{value}<span class="sr-only">{rest}</span>
          </span>
        ) : (
          <span id={descId} class="sr-only">{hint ? `${hint} ` : ''}Whole number only.</span>
        )}
        {clearButton}
      </span>
    );
  }

  return (
    <div class="reps-field">
      {input}
      {held ? (
        <div class="reps-field-held-line">
          <span id={descId} class="reps-field-held">
            Planned: {value}<span class="sr-only">{rest}</span>
          </span>
          {clearButton}
        </div>
      ) : (
        <span id={descId} class="sr-only">{hint ? `${hint} ` : ''}Whole number only.</span>
      )}
    </div>
  );
}
