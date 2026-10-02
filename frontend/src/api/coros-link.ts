// #260: a COROS activity's page on the COROS web portal.
//
// The portal opens an activity only when it is given both its `labelId` (our
// `source_activity_id`) and its sport code (`sport_type`, Workouts!AB). The
// user verified the shape on 2026-10-02, logged in:
// `https://t.coros.com/activity-detail?labelId=<id>&sportType=204` opens the
// activity; the same URL without `sportType` does not.
//
// The URL carries the two public IDs and nothing else: no token, Drive ref,
// `raw_ref`, key or Thrive data.

import type { Workout } from './types';
import { provenanceOf } from './provenance';

/** The COROS web portal. One constant, so a regional host is a one-line change. */
export const COROS_PORTAL_HOST = 'https://t.coros.com';

type LinkFields = Pick<Workout, 'source' | 'source_activity_id' | 'sport_type' | 'status'>;

const DIGITS = /^\d+$/;

/**
 * The activity's portal URL, or null when there is nothing to link to: not a
 * COROS row (manual, `garmin_import`), a planned workout, or an ID or sport
 * code that is blank or not all digits (a demo ID, a row not yet backfilled).
 */
export function corosActivityUrl(w: LinkFields): string | null {
  if (w.status === 'planned') return null;
  const provenance = provenanceOf(w);
  const coros = (provenance === 'synced' && w.source === 'coros') || provenance === 'enriched';
  if (!coros) return null;
  if (!DIGITS.test(w.source_activity_id) || !DIGITS.test(w.sport_type)) return null;
  return `${COROS_PORTAL_HOST}/activity-detail?labelId=${w.source_activity_id}&sportType=${w.sport_type}`;
}
