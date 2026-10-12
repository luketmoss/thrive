// The raw Garmin import archive in the bot account's Drive (#159).
//
//   Thrive Garmin/activities/<YYYY>/<MM>/<activityId>.json   one per activity
//
// Built on archive.mjs's `createArchiveStore` like the Withings archive, with
// its own root and tags. Each file holds the export's activity object as
// exported; its Drive ID is `Workouts!raw_ref`. Found by tags, never by name.

import { createArchiveStore, sha256 } from './archive.mjs';

export const GARMIN_DRIVE_ROOT_FOLDER = 'Thrive Garmin';
export const GARMIN_APP_PROPERTY_ROOT = { kind: 'thrive-garmin-root' };
export const GARMIN_APP_PROPERTY_FOLDER_KIND = 'thrive-garmin-folder';

export const garminActivityProps = (activityId) => ({ source: 'garmin_import', activity_id: String(activityId) });

/** @param {ReturnType<import('./drive.mjs').createDrive>} drive */
export function createGarminArchive(drive, { now = () => Date.now() } = {}) {
  const { upsert } = createArchiveStore(drive, {
    rootName: GARMIN_DRIVE_ROOT_FOLDER,
    rootProps: GARMIN_APP_PROPERTY_ROOT,
    folderKind: GARMIN_APP_PROPERTY_FOLDER_KIND,
    now,
  });
  return {
    /** @param {string} date local YYYY-MM-DD, which folders the file */
    upsertActivity(activity, date) {
      const id = String(activity.activityId);
      const [yyyy, mm] = date.split('-');
      return upsert({
        props: garminActivityProps(id),
        name: `${id}.json`,
        segments: ['activities', yyyy, mm],
        record: { source: 'garmin_import', activity_id: id, payload: activity, payload_hash: sha256(JSON.stringify(activity)) },
      });
    },
  };
}
