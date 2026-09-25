// The raw COROS archive in the bot account's Drive (#152, sync plan §5).
//
//   Thrive COROS/activities/<YYYY>/<MM>/<activityId>.json   one per activity
//   Thrive COROS/health/<YYYY>/<MM>/<YYYY-MM-DD>.json      one per local run date
//   Thrive COROS/fit/<YYYY>/<MM>/<activityId>.fit          one per activity (#154)
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
 * A FIT file's tags (#154). Deliberately not `activity_id`: Drive matches
 * every file that has the queried properties, so a FIT tagged
 * `{ source, activity_id }` would also answer the activity JSON's query, and
 * that lookup would then refuse with "2 files match".
 */
export const fitProps = (activityId) => ({ source: 'coros', kind: 'fit', fit_activity_id: String(activityId) });

/**
 * A list entry with its position in the list removed. `text` begins "3. ",
 * and that number moves whenever a newer activity lands, so it is not part of
 * what the entry says about this activity.
 */
const entryIdentity = (entry) =>
  JSON.stringify(entry ? { ...entry, text: String(entry.text ?? '').replace(/^\d+\. /, '') } : null);

/**
 * Whether an activity's list entry changed while its detail did not (#166).
 * A rename in COROS shows only in the list, and the name is normalized from
 * the archived entry, so the entry has to be refreshed on its own.
 */
const listEntryChanged = (current, record) =>
  record.list_entry !== undefined && entryIdentity(current?.list_entry) !== entryIdentity(record.list_entry);

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
   * Creates the file, or updates it in place when `payload_hash` changed or,
   * for an activity, its list entry did (a rename). `normalized` belongs to
   * #166: a new file starts at null, and an update carries the existing value
   * over untouched.
   *
   * @returns {Promise<{ status: 'created' | 'updated' | 'unchanged', fileId: string }>}
   */
  async function upsert({ props, name, segments, record }) {
    const existing = await drive.findOne(props);
    if (existing) {
      const current = await drive.readJson(existing.id);
      if (current?.payload_hash === record.payload_hash && !listEntryChanged(current, record)) {
        return { status: 'unchanged', fileId: existing.id };
      }
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

    /**
     * One archived activity with its Drive file ID (the row's `raw_ref`), or
     * null if no run has landed it. #166 normalizes from this.
     */
    async readActivity(activityId) {
      const file = await drive.findOne(activityProps(String(activityId)));
      if (!file) return null;
      return { fileId: file.id, data: await drive.readJson(file.id) };
    },

    /**
     * Record what the sheet now holds for this activity (#166 AC4), so the
     * next run's merge compares against the truth. Nothing else in the file
     * changes: `payload`, its hash and `fetched_at` are the archive's, and
     * re-reading first keeps an ingest update from being overwritten.
     */
    async writeNormalized(fileId, normalized) {
      const current = await drive.readJson(fileId);
      await drive.updateJson(fileId, { ...current, normalized });
    },

    /**
     * Record the activity's FIT state (#154) in its archive file. This is the
     * sync's own memory of what it asked COROS for, so a FIT is never
     * requested twice and one that keeps failing stops being asked for.
     * Every other field is left as it is, like writeNormalized, and an ingest
     * update carries `fit` over the same way it carries `normalized`.
     */
    async writeFit(fileId, fit) {
      const current = await drive.readJson(fileId);
      await drive.updateJson(fileId, { ...current, fit });
    },

    /** The activity's FIT file in Drive, or null. Found by tag, never by name. */
    findFit(activityId) {
      return drive.findOne(fitProps(activityId));
    },

    /**
     * Store an activity's FIT bytes, foldered by its local start date like its
     * JSON. Never parsed: `docs/data-architecture.md` §4 keeps FIT out of
     * normalization. Returns the Drive file ID, which is the row's `fit_ref`.
     */
    async storeFit({ activityId, localDate, bytes }) {
      const id = String(activityId);
      const [yyyy, mm] = localDate.split('-');
      const parentId = await folderFor(['fit', yyyy, mm]);
      return drive.createBinary({ name: `${id}.fit`, parentId, props: fitProps(id), bytes });
    },

    /**
     * The run date's health bundle as archived, with its Drive file ID (the
     * rows' `raw_ref`), or null if no run has landed one. #165 normalizes from
     * this rather than from memory, so a re-parse and a run read the same text.
     */
    async readHealth(runDate) {
      const file = await drive.findOne(healthProps(runDate));
      if (!file) return null;
      return { fileId: file.id, data: await drive.readJson(file.id) };
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
