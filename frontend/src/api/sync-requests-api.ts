// SyncRequests row mapping (#314). One row per vendor per "Sync now" press:
// the SPA appends A-E with status `requested`, and the Apps Script poller
// (`pollSyncRequests`, apps-script/src/sync-requests.js) writes every later
// value in E-I. The append and the read arrive with #315; this file holds the
// layout only, and makes no network call.
//
// The three lists mirror SYNC_REQUEST_FIELDS, SYNC_REQUEST_STATUSES and
// SYNC_REQUEST_VENDORS in apps-script/src/types.js; change both together.
// sync-requests-api.test.ts fails if any of them drifts.

/** SyncRequests' A:I order. */
export const SYNC_REQUEST_FIELDS = [
  'request_id',      // A  sr_ + 8 hex, written by the SPA
  'vendor',          // B  coros | withings
  'requested_at',    // C  ISO 8601 instant, UTC
  'requested_by',    // D  the signed-in email; may be blank
  'status',          // E  SPA writes `requested`; the poller every later value
  'workflow_run_id', // F  GitHub's numeric run id; blank until dispatched
  'dispatched_at',   // G  ISO instant GitHub accepted the dispatch
  'finished_at',     // H  ISO instant the poller recorded a final status
  'detail',          // I  words; blank while requested / started
] as const;

/** `requested` and `started` are open; every other status is final. */
export const SYNC_REQUEST_STATUSES = [
  'requested', 'started', 'done', 'cancelled', 'failed', 'not_reported', 'skipped', 'expired',
] as const;

export const SYNC_REQUEST_VENDORS = ['coros', 'withings'] as const;

export type SyncRequestField = typeof SYNC_REQUEST_FIELDS[number];
export type SyncRequestStatus = typeof SYNC_REQUEST_STATUSES[number];
export type SyncRequestVendor = typeof SYNC_REQUEST_VENDORS[number];

/** A row as read: every field a string, '' where a cell is missing. */
export type SyncRequest = Record<SyncRequestField, string>;
export interface SyncRequestWithRow extends SyncRequest { sheetRow: number; }

/**
 * One sheet row as a request, '' for a missing cell (a short row). Values are
 * kept exactly as read, not trimmed: the poller matches `vendor` and `status`
 * exactly, and the SPA must see what the poller saw.
 */
export function rowToSyncRequest(row: readonly unknown[], sheetRow: number): SyncRequestWithRow {
  const req = { sheetRow } as SyncRequestWithRow;
  SYNC_REQUEST_FIELDS.forEach((field, i) => {
    const v = row[i];
    req[field] = v === undefined || v === null ? '' : String(v);
  });
  return req;
}
