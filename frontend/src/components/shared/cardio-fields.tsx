import type { WorkoutType, Workout } from '../../api/types';
import { ELEVATION_STEP_FT, metersToMilesInput, metersToFeetInput } from '../../api/units';

/** Imperial strings as typed. Conversion to meters happens on save. */
export interface CardioValues {
  distance: string;
  ascent: string;
  descent: string;
  avgHr: string;
}

export type CardioField = keyof CardioValues;

/** Declaration order, which is also the order they render in. */
const ALL_FIELDS: CardioField[] = ['distance', 'ascent', 'descent', 'avgHr'];

interface Props {
  workoutType: WorkoutType;
  /** `Workouts!R`. '' means unspecified, which is a normal state (#129 AC5). */
  subType: string;
  values: CardioValues;
  onChange: (patch: Partial<CardioValues>) => void;
  /** Namespaces the input ids so two forms on one page can't collide. */
  idPrefix: string;
}

/** Seeds the form from stored meters. An unset field seeds blank, never "0". */
export function storedToCardio(w: Pick<Workout, 'distance_m' | 'ascent_m' | 'descent_m' | 'avg_hr'> | undefined): CardioValues {
  return {
    distance: metersToMilesInput(w?.distance_m ?? ''),
    ascent: metersToFeetInput(w?.ascent_m ?? ''),
    descent: metersToFeetInput(w?.descent_m ?? ''),
    avgHr: w?.avg_hr ?? '',
  };
}

/** Venue modifiers that mean "no terrain to climb" (#129). */
const INDOOR = new Set(['indoor']);

/**
 * Which cardio fields a `(type, sub_type)` pair *earns* — before the
 * never-hide-a-value rule in `visibleCardioFields` is applied on top.
 *
 * This is the one place the taxonomy is encoded. `sub_type` is deliberately a
 * free string rather than a union: the whole point of splitting type from
 * venue (see `docs/data-architecture.md` §4) is that a new terrain needs no
 * code change, so an unrecognised value falls through to the outdoor set.
 */
export function cardioFieldsFor(type: WorkoutType, subType: string): Set<CardioField> {
  const indoor = INDOOR.has(subType);

  switch (type) {
    case 'hike':
      // Descent is only worth recording where it is the other half of a
      // there-and-back — on a loop ride it just mirrors ascent.
      return new Set<CardioField>(['distance', 'ascent', 'descent', 'avgHr']);
    case 'bike':
    case 'run':
    case 'walk':
      return indoor
        ? new Set<CardioField>(['distance', 'avgHr'])
        : new Set<CardioField>(['distance', 'ascent', 'avgHr']);
    default:
      return new Set<CardioField>();
  }
}

/** Whether the cardio fieldset appears at all for this `(type, sub_type)`. */
export function hasCardioFields(type: WorkoutType, subType = ''): boolean {
  return cardioFieldsFor(type, subType).size > 0;
}

/**
 * The fields to render, in order.
 *
 * A field the pair has not earned still renders **if it already holds a
 * value** (#129 AC4). Hiding a filled field would leave a number stored that
 * the user can neither see nor clear — the same invariant that keeps `''`
 * distinct from `0` everywhere else in the activity columns. Switching venue
 * therefore never destroys anything typed; it only stops *asking*.
 */
export function visibleCardioFields(
  type: WorkoutType,
  subType: string,
  values: CardioValues,
): CardioField[] {
  const earned = cardioFieldsFor(type, subType);
  if (earned.size === 0) return [];
  return ALL_FIELDS.filter((f) => earned.has(f) || values[f] !== '');
}

/** Fieldset legend per type. Replaces the bike/hike ternary this outgrew. */
const LEGENDS: Partial<Record<WorkoutType, string>> = {
  bike: 'Ride details',
  hike: 'Hike details',
  run: 'Run details',
  walk: 'Walk details',
};

const FIELD_META: Record<CardioField, { label: string; placeholder: string; decimal: boolean }> = {
  distance: { label: 'Distance (miles)', placeholder: 'e.g. 12.4', decimal: true },
  ascent: { label: 'Ascent (feet)', placeholder: 'e.g. 1500', decimal: false },
  descent: { label: 'Descent (feet)', placeholder: 'e.g. 1500', decimal: false },
  avgHr: { label: 'Avg HR (bpm)', placeholder: 'e.g. 136', decimal: false },
};

/**
 * Cardio attributes for the distance activities (#103, extended by #129).
 *
 * Field order is by how often each is filled, so the common case needs the
 * least scrolling.
 *
 * Units live in the labels, not the placeholders — a placeholder disappears on
 * the first keystroke (WCAG 3.3.2), and here the stored unit differs from the
 * entered one, so the label has to carry it.
 */
export function CardioFields({ workoutType, subType, values, onChange, idPrefix }: Props) {
  // Two separate questions: does this pair have a cardio fieldset at all, and
  // then which of its fields are on screen right now.
  if (!hasCardioFields(workoutType, subType)) return null;
  const visible = visibleCardioFields(workoutType, subType, values);

  const field = (key: CardioField) => {
    const { label, placeholder, decimal } = FIELD_META[key];
    const id = `${idPrefix}-${key}`;
    return (
      <div class="form-group" key={key}>
        <label class="form-label" htmlFor={id}>{label}</label>
        <input
          id={id}
          class="form-input"
          type="number"
          // Distance must be `decimal`: on iOS Safari `numeric` renders a
          // digits-only keypad and "12.4" becomes physically untypeable.
          inputMode={decimal ? 'decimal' : 'numeric'}
          step={decimal ? '0.1' : '1'}
          placeholder={placeholder}
          value={values[key]}
          onInput={(e) => onChange({ [key]: (e.target as HTMLInputElement).value })}
        />
      </div>
    );
  };

  return (
    <fieldset class="cardio-fields">
      <legend class="cardio-fields-legend">
        {LEGENDS[workoutType] ?? 'Activity details'}
      </legend>

      {/* The field set changes when venue changes. Announce it politely
          rather than moving focus — the user is mid-form and focus belongs
          wherever they put it (#129 AC4). */}
      <p class="sr-only" role="status">
        {visible.map((f) => FIELD_META[f].label).join(', ')}
      </p>

      {visible.map(field)}

      {visible.includes('ascent') || visible.includes('descent') ? (
        <p class="cardio-fields-note">
          Elevation is recorded to the nearest {ELEVATION_STEP_FT} feet.
        </p>
      ) : null}
    </fieldset>
  );
}
