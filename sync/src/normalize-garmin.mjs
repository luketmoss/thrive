// Garmin Connect export -> Thrive `Workouts` fields (#159, sync plan §11).
//
// Source: the export's `*_summarizedActivities.json` objects, never the FIT
// files. Units there: times are epoch milliseconds, durations are ms,
// distance and elevation are centimetres. `startTimeLocal` is the wall clock
// encoded as if it were UTC, so date and time read straight from it;
// `startTimeGmt` is the true instant.
//
// Blank means Garmin did not say, never `0`: a zero moving time, distance,
// ascent, heart rate or calorie count is "not measured" and stays blank.
// Output has the field set of normalize-activity.mjs's ACTIVITY_FIELDS.

export const SOURCE = 'garmin_import';
export const FIRST_DATE = '2017-06-30';
export const LAST_DATE = '2026-09-19';

/** activityType -> Thrive type/sub_type. Not listed = not imported. */
export const TYPES = {
  strength_training: { type: 'weight', sub_type: '' },
  cycling: { type: 'bike', sub_type: '' },
  virtual_ride: { type: 'bike', sub_type: 'indoor' },
  indoor_cycling: { type: 'bike', sub_type: 'indoor' },
  walking: { type: 'walk', sub_type: '' },
  running: { type: 'run', sub_type: 'outdoor' },
  treadmill_running: { type: 'run', sub_type: 'indoor' },
  yoga: { type: 'stretch', sub_type: '' },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const whole = (n) => String(Math.round(n));
const positive = (n, scale = 1) => (isNum(n) && n > 0 ? whole(n / scale) : '');
const pad = (n) => String(n).padStart(2, '0');

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

/** `2026-09-15T07:30:00-06:00` from the local and GMT stamps. */
function startedAtUtc(localMs, gmtMs) {
  if (!isNum(gmtMs)) return '';
  const offsetMin = Math.round((localMs - gmtMs) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${iso(localMs)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The Garmin activity's local date, or '' when it has no start. */
export const localDateOf = (a) => (isNum(a?.startTimeLocal) ? iso(a.startTimeLocal).slice(0, 10) : '');

/**
 * @returns {{ kind: 'mapped', incoming: object } | { kind: 'skipped', reason: string }}
 */
export function mapActivity(a) {
  const mapping = Object.prototype.hasOwnProperty.call(TYPES, a?.activityType) ? TYPES[a.activityType] : null;
  if (!mapping) return { kind: 'skipped', reason: `type ${a?.activityType ?? '(none)'}` };
  if (!isNum(a.startTimeLocal)) return { kind: 'skipped', reason: 'no start time' };
  const date = iso(a.startTimeLocal).slice(0, 10);
  if (date < FIRST_DATE || date > LAST_DATE) return { kind: 'skipped', reason: 'out of range' };
  const name = String(a.name ?? '').trim();
  if (!name) return { kind: 'skipped', reason: 'no name' };

  const indoor = mapping.sub_type === 'indoor';
  const elapsed = isNum(a.elapsedDuration) ? a.elapsedDuration : a.duration;
  return {
    kind: 'mapped',
    incoming: {
      date,
      time: iso(a.startTimeLocal).slice(11, 16),
      type: mapping.type,
      sub_type: mapping.sub_type,
      name,
      elapsed_seconds: positive(elapsed, 1000),
      moving_seconds: positive(a.movingDuration, 1000),
      distance_m: positive(a.distance, 100),
      ascent_m: indoor ? '' : positive(a.elevationGain, 100),
      descent_m: '',
      avg_hr: positive(a.avgHr),
      calories: positive(a.calories),
      started_at_utc: startedAtUtc(a.startTimeLocal, a.startTimeGmt),
    },
  };
}

/** What a strength activity offers a hand-logged row (as sync-activities' strengthActivity). */
export const strengthOffer = (incoming) => ({
  date: incoming.date,
  time: incoming.time,
  elapsed_seconds: incoming.elapsed_seconds,
  moving_seconds: incoming.moving_seconds,
  avg_hr: incoming.avg_hr,
  calories: incoming.calories,
});
