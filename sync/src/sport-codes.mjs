// COROS sport codes -> Thrive's `type` and `sub_type` (#166 AC1).
//
// The table is #166's, with venue codes from docs/data-architecture.md §4
// (verified in #133). Terrain comes from the code too: a gravel or mountain
// sport mode is something the user picked on the watch before recording, so
// it is a declaration, not a device inference (§4, amended by #166). Plain
// 200 says nothing about terrain, so its `sub_type` stays blank. Nothing is
// defaulted.

/** @typedef {{ type: string, sub_type: string } | { type: 'walk', sub_type: 'from-track' }} Mapping */

const RUN_OUTDOOR = { type: 'run', sub_type: 'outdoor' };
const BIKE = { type: 'bike', sub_type: '' };

/** @type {Record<number, Mapping>} */
export const SPORT_CODES = {
  100: RUN_OUTDOOR,                          // run
  101: { type: 'run', sub_type: 'indoor' },  // indoor run
  102: RUN_OUTDOOR,                          // trail run
  103: RUN_OUTDOOR,                          // track run
  104: { type: 'hike', sub_type: '' },       // hike
  200: BIKE,                                 // bike: terrain unknown, left blank
  201: { type: 'bike', sub_type: 'indoor' }, // indoor bike
  202: BIKE,                                 // e-bike
  203: { type: 'bike', sub_type: 'gravel' }, // gravel bike
  204: { type: 'bike', sub_type: 'mountain' }, // mountain bike
  205: { type: 'bike', sub_type: 'mountain' }, // mountain e-bike
  299: BIKE,                                 // helmet bike
  // Walk's code carries no venue. The normalizer settles it from the track.
  900: { type: 'walk', sub_type: 'from-track' },
};

/** Strength is archived, and left to #155's reconciliation. */
export const STRENGTH_CODE = 402;

/**
 * What the sync does with an activity of this code.
 *
 * @returns {{ kind: 'mapped', type: string, sub_type: string }
 *   | { kind: 'strength' } | { kind: 'unmapped' }}
 */
export function classifySport(code) {
  const n = Number(code);
  if (n === STRENGTH_CODE) return { kind: 'strength' };
  const m = Object.prototype.hasOwnProperty.call(SPORT_CODES, n) ? SPORT_CODES[n] : null;
  return m ? { kind: 'mapped', ...m } : { kind: 'unmapped' };
}
