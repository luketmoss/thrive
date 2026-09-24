// The raw COROS archive in the bot account's Drive (#152, sync plan §5).
//
//   Thrive COROS/activities/<YYYY>/<MM>/<activityId>.json   one per activity
//   Thrive COROS/health/<YYYY>/<MM>/<YYYY-MM-DD>.json      one per local run date
//
// Every file and folder is found again by its `appProperties`, never by name,
// so a moved or renamed file is updated rather than duplicated. A file is only
// ever updated in place: its Drive ID is the future `Workouts!raw_ref`.
//
// Nothing here parses a payload. It stores COROS's text exactly as served,
// because that text is the only way to re-parse after COROS changes it.

import { createHash } from 'node:crypto';
import { APP_PROPERTY_FOLDER_KIND, APP_PROPERTY_ROOT, DRIVE_ROOT_FOLDER } from './config.mjs';

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The hash of a health bundle: every call's tool, args and payload, in order. */
export const bundleHash = (calls) =>
  sha256(JSON.stringify(calls.map(({ tool, args, payload }) => [tool, args, payload])));

export const activityProps = (activityId) => ({ source: 'coros', activity_id: String(activityId) });
export const healthProps = (runDate) => ({ source: 'coros', kind: 'health', run_date: runDate });

/**
 * @param {ReturnType<import('./drive.mjs').createDrive>} drive
 * @param {{ now?: () => number }} [opts]
 */
export function createArchive(drive, { now = () => Date.now() } = {}) {
  const folders = new Map();

  /** The folder at `segments` under the root, creating any that are missing. */
  async function folderFor(segments) {
    let parentId = folders.get('');
    if (!parentId) {
      parentId = await drive.ensureFolder(DRIVE_ROOT_FOLDER, APP_PROPERTY_ROOT);
      folders.set('', parentId);
    }
    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join('/');
      let id = folders.get(path);
      if (!id) {
        id = await drive.ensureFolder(segments[i], { kind: APP_PROPERTY_FOLDER_KIND, path }, parentId);
        folders.set(path, id);
      }
      parentId = id;
    }
    return parentId;
  }

  /**
   * Creates the file, or updates it in place when `payload_hash` changed.
   * `normalized` belongs to #153: a new file starts at null, and an update
   * carries the existing value over untouched.
   *
   * @returns {Promise<{ status: 'created' | 'updated' | 'unchanged', fileId: string }>}
   */
  async function upsert({ props, name, segments, record }) {
    const existing = await drive.findOne(props);
    if (existing) {
      const current = await drive.readJson(existing.id);
      if (current?.payload_hash === record.payload_hash) return { status: 'unchanged', fileId: existing.id };
      await drive.updateJson(existing.id, {
        ...current,
        ...record,
        fetched_at: new Date(now()).toISOString(),
        normalized: current?.normalized ?? null,
      });
      return { status: 'updated', fileId: existing.id };
    }
    const parentId = await folderFor(segments);
    const fileId = await drive.createJson({
      name,
      parentId,
      props,
      data: { ...record, fetched_at: new Date(now()).toISOString(), normalized: null },
    });
    return { status: 'created', fileId };
  }

  return {
    /**
     * One activity's detail payload. `localDate` (the activity's local start
     * date) picks the folder; the file is keyed by vendor ID alone.
     */
    upsertActivity({ activityId, localDate, tool, args, listEntry, payload }) {
      const id = String(activityId);
      const [yyyy, mm] = localDate.split('-');
      return upsert({
        props: activityProps(id),
        name: `${id}.json`,
        segments: ['activities', yyyy, mm],
        record: {
          source: 'coros',
          activity_id: id,
          tool,
          args,
          list_entry: listEntry,
          payload,
          payload_hash: sha256(payload),
        },
      });
    },

    /** The run date's daily-health bundle: every health call, as served. */
    upsertHealth({ runDate, window, calls }) {
      const [yyyy, mm] = runDate.split('-');
      return upsert({
        props: healthProps(runDate),
        name: `${runDate}.json`,
        segments: ['health', yyyy, mm],
        record: {
          source: 'coros',
          kind: 'health',
          run_date: runDate,
          window,
          calls,
          payload_hash: bundleHash(calls),
        },
      });
    },
  };
}
