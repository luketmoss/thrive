// FIT files within COROS's allowance (#154, sync plan §4, implementing #149).
//
// COROS allows 50 FIT files per fixed 24-hour window that opens at the first
// request (#133). Downloads and download-URL requests share it. The budget is
// derived, never stored: 50 minus `n_fit_fetched` summed over the SyncLog rows
// of the last 24 hours. A rolling 24 hours always covers COROS's fixed window,
// so it can only under-spend. A run that fails part-way still writes its row,
// requests included; only a job killed from outside Node loses its row, and
// its requests with it.
//
// The FIT comes from `downloadActivityFitFiles`, as a base64 blob inside the
// MCP result. `queryActivityFitFileDownloadUrls` would hand over an
// unauthenticated S3 URL (sync plan §2); COROS's own description calls it the
// fallback for clients that cannot take binary. Using the blob means that
// secret never exists in this process.
//
// Nothing here parses a FIT. The bytes are checked for being one whole FIT
// file (header, declared size, CRC) and stored as they came.
// `docs/data-architecture.md` §4 keeps FIT out of normalization, so a FIT the
// budget delayed never changes a row's values later.

import { DriveAuthError } from './errors.mjs';
import { redact } from './redact.mjs';

export const FIT_TOOL = 'downloadActivityFitFiles';

/** COROS's allowance: files per fixed 24-hour window (sync plan §2). */
export const FIT_ALLOWANCE = 50;
export const FIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The most SyncLog rows the API returns at once (getSyncLog's limit). */
export const SYNC_LOG_READ_LIMIT = 100;

/**
 * Failed requests for one activity before the sync stops asking. Each one
 * spends allowance, so a FIT COROS cannot serve would otherwise cost one
 * request every run, four times a day, for as long as the activity is in the
 * window.
 */
export const FIT_MAX_ATTEMPTS = 3;

/** A result that is not one whole FIT file for the activity asked about. */
export class FitFormatError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'FitFormatError';
  }
}

// --- the budget -----------------------------------------------------------

/**
 * The run's FIT budget from SyncLog rows, newest first as getSyncLog returns
 * them. Every row that started within the 24 hours before `startedAt` counts,
 * and so does one whose `started_at` cannot be read: not counting it could
 * over-spend.
 *
 * @returns {{ known: true, used: number, remaining: number } | { known: false, reason: string }}
 */
export function fitBudget(rows, startedAt, { allowance = FIT_ALLOWANCE, limit = SYNC_LOG_READ_LIMIT } = {}) {
  const start = Date.parse(startedAt);
  let used = 0;
  let inWindow = 0;
  for (const row of rows) {
    const t = Date.parse(row.started_at);
    if (Number.isFinite(t) && t <= start - FIT_WINDOW_MS) continue;
    const n = Number(row.n_fit_fetched || 0);
    if (!Number.isInteger(n) || n < 0) {
      return { known: false, reason: `SyncLog row ${row.run_id} has n_fit_fetched "${row.n_fit_fetched}"` };
    }
    used += n;
    inWindow += 1;
  }
  if (rows.length >= limit && inWindow === rows.length) {
    return { known: false, reason: `all ${rows.length} SyncLog rows read are from the last 24 hours, so older ones may be missing` };
  }
  return { known: true, used, remaining: Math.max(0, allowance - used) };
}

// --- the bytes ------------------------------------------------------------

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

/** The FIT SDK's CRC-16 over `bytes`. */
export function fitCrc(bytes, crc = 0) {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

/**
 * Throws FitFormatError unless `bytes` is one or more whole FIT files end to
 * end (a chained FIT is legal): each with a 12- or 14-byte header saying
 * `.FIT`, exactly its declared data size, a correct header CRC when it has
 * one, and a correct file CRC. A truncated or garbled download fails here
 * rather than landing in Drive as a file nobody can read.
 */
export function checkFit(bytes) {
  if (!bytes.length) throw new FitFormatError('empty FIT file');
  let offset = 0;
  while (offset < bytes.length) {
    const headerSize = bytes[offset];
    if ((headerSize !== 12 && headerSize !== 14) || offset + headerSize > bytes.length) {
      throw new FitFormatError(`not a FIT file: header size ${headerSize} at byte ${offset}`);
    }
    const header = bytes.subarray(offset, offset + headerSize);
    if (header.subarray(8, 12).toString('latin1') !== '.FIT') {
      throw new FitFormatError(`not a FIT file: no ".FIT" signature at byte ${offset}`);
    }
    if (headerSize === 14) {
      const headerCrc = header.readUInt16LE(12);
      if (headerCrc !== 0 && headerCrc !== fitCrc(header.subarray(0, 12))) {
        throw new FitFormatError(`FIT header CRC mismatch at byte ${offset}`);
      }
    }
    const end = offset + headerSize + header.readUInt32LE(4) + 2;
    if (end > bytes.length) {
      throw new FitFormatError(`truncated FIT file: ${bytes.length} bytes, header declares ${end}`);
    }
    const segment = bytes.subarray(offset, end);
    if (fitCrc(segment.subarray(0, segment.length - 2)) !== segment.readUInt16LE(segment.length - 2)) {
      throw new FitFormatError(`FIT file CRC mismatch (${segment.length} bytes)`);
    }
    offset = end;
  }
}

/**
 * The FIT bytes in a `downloadActivityFitFiles` result for one activity:
 * exactly one binary resource, named for that activity, holding a whole FIT.
 * Text items are COROS's advice to the reader and are ignored, never kept.
 */
export function fitFromResult(result, activityId) {
  if (result?.isError) throw new FitFormatError(`${FIT_TOOL} returned an error result`);
  const blobs = (result?.content ?? []).filter((c) => c?.type === 'resource' && typeof c.resource?.blob === 'string');
  if (blobs.length !== 1) {
    throw new FitFormatError(`${FIT_TOOL} returned ${blobs.length} FIT files, expected 1`);
  }
  const { uri } = blobs[0].resource;
  if (typeof uri !== 'string' || !uri.endsWith(`/${activityId}.fit`)) {
    throw new FitFormatError(`${FIT_TOOL} returned a file for a different activity`);
  }
  const bytes = Buffer.from(blobs[0].resource.blob, 'base64');
  checkFit(bytes);
  return bytes;
}

// --- the step -------------------------------------------------------------

/** What the row holds for an archive `fit` record: sync-owned V and W. */
export function fitSheetFields(record) {
  if (record?.status === 'stored') return { fit_ref: record.file_id, fit_fetched_at: record.fetched_at };
  if (record?.status === 'unavailable') return { fit_ref: '', fit_fetched_at: record.fetched_at };
  return { fit_ref: '', fit_fetched_at: '' };
}

const settled = (record) => record?.status === 'stored' || record?.status === 'unavailable';

/**
 * The run's FIT step. `ensure` is called once per activity that gets a row,
 * oldest first, and answers the row's `fit_ref` / `fit_fetched_at`.
 *
 * - A FIT on record (or given up on) costs nothing and is re-sent as is.
 * - A FIT in Drive that the archive does not record (a run that died between
 *   the upload and the record) is adopted without a request.
 * - Otherwise, with budget left, one request, no retry. It counts against the
 *   budget whatever happens, because COROS may have counted it.
 * - With none left, the activity waits for a later run: the backlog.
 *
 * The budget is read from SyncLog on the first activity that needs a
 * request, so a run with nothing to fetch reads nothing.
 *
 * @param {{ client: object, archive: object, api: object, startedAt: string,
 *   log?: (line: string) => void, budgetOverride?: number }} opts
 *   `budgetOverride` replaces what SyncLog says is left (`THRIVE_FIT_BUDGET`),
 *   for testing the cap without spending the real allowance. It can only
 *   lower the budget, never raise it.
 */
export function createFitStep({ client, archive, api, startedAt, log = console.log, budgetOverride }) {
  const counts = { requested: 0, stored: 0, adopted: 0, failed: 0, gaveUp: 0, waiting: 0 };
  const failures = [];
  let budget = null;

  const fail = (message) => {
    failures.push(message);
    log(`  FAILED ${message}`);
  };

  async function loadBudget() {
    if (budget) return budget;
    try {
      const rows = await api.getSyncLog(SYNC_LOG_READ_LIMIT);
      budget = fitBudget(rows ?? [], startedAt);
    } catch (err) {
      budget = { known: false, reason: `getSyncLog failed: ${redact(err.message || String(err))}` };
    }
    if (budget.known && Number.isInteger(budgetOverride) && budgetOverride >= 0 && budgetOverride < budget.remaining) {
      log(`  FIT budget: ${budget.remaining} left per SyncLog, lowered to ${budgetOverride} by THRIVE_FIT_BUDGET`);
      budget.remaining = budgetOverride;
    }
    if (budget.known) {
      log(`  FIT budget: ${budget.used} of ${FIT_ALLOWANCE} used in the last 24 h, ${budget.remaining} left`);
    } else {
      fail(`FIT budget unknown, so no FIT was requested this run: ${budget.reason}`);
    }
    return budget;
  }

  /**
   * @param {{ activityId: string, fileId: string, record: object | undefined,
   *   args: { labelId: string, sportType: number }, localDate: string }} activity
   * @returns {Promise<{ fit_ref: string, fit_fetched_at: string }>}
   */
  async function ensure({ activityId, fileId, record, args, localDate }) {
    if (settled(record)) return fitSheetFields(record);

    const existing = await archive.findFit(activityId);
    if (existing) {
      const adopted = {
        status: 'stored', file_id: existing.id, fetched_at: existing.modifiedTime ?? startedAt,
        attempts: record?.attempts ?? 0,
      };
      await archive.writeFit(fileId, adopted);
      counts.adopted += 1;
      log(`  activity ${activityId}: FIT already in Drive (${existing.id}), recorded without a request`);
      return fitSheetFields(adopted);
    }

    const b = await loadBudget();
    if (!b.known || b.remaining <= 0) {
      counts.waiting += 1;
      return fitSheetFields(record);
    }

    b.remaining -= 1;
    counts.requested += 1;
    const attempts = (record?.attempts ?? 0) + 1;
    let bytes;
    try {
      bytes = fitFromResult(await client.callTool({ name: FIT_TOOL, arguments: args }), activityId);
    } catch (err) {
      // COROS could not give us the file. This is what the attempt cap is for.
      counts.failed += 1;
      const reason = redact(err.message || String(err));
      const gaveUp = attempts >= FIT_MAX_ATTEMPTS;
      const next = gaveUp
        ? { status: 'unavailable', fetched_at: startedAt, attempts, last_error: reason }
        : { status: 'failed', attempts, last_attempt_at: startedAt, last_error: reason };
      if (gaveUp) counts.gaveUp += 1;
      try {
        await archive.writeFit(fileId, next);
      } catch (writeErr) {
        if (writeErr instanceof DriveAuthError) throw writeErr;
        fail(`activity ${activityId}: FIT attempt not recorded: ${redact(writeErr.message || String(writeErr))}`);
        return fitSheetFields(record);
      }
      fail(gaveUp
        ? `activity ${activityId}: FIT request failed ${attempts} times, so the sync has stopped asking for it: ${reason}`
        : `activity ${activityId}: FIT request ${attempts} of ${FIT_MAX_ATTEMPTS} failed; the next run tries again: ${reason}`);
      return fitSheetFields(next);
    }

    // The file is in hand. A Drive failure from here on is not COROS's, so it
    // does not use up an attempt; the request still counted.
    try {
      const fitId = await archive.storeFit({ activityId, localDate, bytes });
      const stored = { status: 'stored', file_id: fitId, fetched_at: startedAt, attempts, bytes: bytes.length };
      await archive.writeFit(fileId, stored);
      counts.stored += 1;
      log(`  activity ${activityId}: FIT stored (${bytes.length} bytes) as ${fitId}`);
      return fitSheetFields(stored);
    } catch (err) {
      if (err instanceof DriveAuthError) throw err;
      fail(`activity ${activityId}: FIT downloaded but not stored in Drive: ${redact(err.message || String(err))}`);
      return fitSheetFields(record);
    }
  }

  return {
    ensure,
    counts,
    failures,
    /** What is left: a number, 'unread' (nothing needed a request) or 'unknown'. */
    get remaining() {
      if (!budget) return 'unread';
      return budget.known ? budget.remaining : 'unknown';
    },
  };
}
