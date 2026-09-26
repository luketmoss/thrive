// The raw Withings archive in the bot account's Drive (#197).
//
//   Thrive Withings/measures/<YYYY>/<MM>/<grpid>.json   one per measure group
//
// Built on archive.mjs's `createArchiveStore`, as COROS's archive is, with its
// own root and tags. Every file is found by `{ source: 'withings', grpid }`,
// never by name, and only ever updated in place: its Drive ID is the future
// `BodyMeasurements!raw_ref`.
//
// Each file holds the group object as Withings returned it. Withings answers
// in JSON, so the parsed object loses nothing a re-parse would need, and one
// file per group keeps `raw_ref` pointing at exactly one reading. Unlike
// COROS's files there is no `normalized` field: Withings rows take no hand
// edits to merge with (#198).

import { createArchiveStore, sha256 } from './archive.mjs';
import {
  WITHINGS_APP_PROPERTY_FOLDER_KIND, WITHINGS_APP_PROPERTY_ROOT, WITHINGS_DRIVE_ROOT_FOLDER,
} from './config.mjs';
import { localDate } from './dates.mjs';

export const measureGroupProps = (grpid) => ({ source: 'withings', grpid: String(grpid) });

/** `sha256(JSON.stringify(group))`. Key order is Withings', stable across calls. */
export const groupHash = (group) => sha256(JSON.stringify(group));

/**
 * @param {ReturnType<import('./drive.mjs').createDrive>} drive
 * @param {{ now?: () => number }} [opts]
 */
export function createWithingsArchive(drive, { now = () => Date.now() } = {}) {
  const { upsert } = createArchiveStore(drive, {
    rootName: WITHINGS_DRIVE_ROOT_FOLDER,
    rootProps: WITHINGS_APP_PROPERTY_ROOT,
    folderKind: WITHINGS_APP_PROPERTY_FOLDER_KIND,
    now,
  });

  return {
    /**
     * One bulk read of every measure group already archived, keyed by
     * `grpid` (#199): a backfill's thousands of groups make a `findOne` per
     * group the dominant cost of the run, so it looks the whole archive up
     * once with `drive.findAll` (paged past the 10-file cap) instead. A
     * normal run's ~30-day window is a handful of groups, cheaper to look up
     * one at a time than to scan the whole archive, so this is opt-in.
     *
     * Matched by `appProperties.grpid`, the same tag `upsertGroup` finds a
     * file by, never by name — a file renamed in Drive is still found.
     *
     * @returns {Promise<Map<string, string>>} grpid to Drive file ID.
     */
    async preloadIndex() {
      const files = await drive.findAll({ source: 'withings' });
      const index = new Map();
      for (const f of files) {
        const grpid = f.appProperties?.grpid;
        if (grpid !== undefined) index.set(String(grpid), f.id);
      }
      return index;
    },

    /**
     * One measure group, foldered by its `date` (epoch seconds) as a local
     * date in America/Denver. Created, rewritten in place when its hash
     * changed, or left alone.
     *
     * @param {{ index?: Map<string, string> }} [opts] an index from
     *   `preloadIndex()`: when given, its lookup replaces the per-group
     *   `findOne` (#199).
     * @returns {Promise<{ status: 'created' | 'updated' | 'unchanged', fileId: string }>}
     */
    upsertGroup(group, { index } = {}) {
      if (group?.grpid === undefined || group?.grpid === null || !Number.isFinite(Number(group.date))) {
        throw new Error('a measure group without a grpid or date cannot be archived');
      }
      const grpid = String(group.grpid);
      const [yyyy, mm] = localDate(Number(group.date) * 1000).split('-');
      return upsert({
        props: measureGroupProps(grpid),
        name: `${grpid}.json`,
        segments: ['measures', yyyy, mm],
        record: { source: 'withings', grpid, payload: group, payload_hash: groupHash(group) },
        ...(index ? { knownFileId: index.get(grpid) ?? null } : {}),
      });
    },
  };
}
