import { sheetsGet, sheetsAppend, withReauth } from './sheets';
import { isDemo } from './demo-data';

// SyncRequests row mapping (#314). One row per vendor per "Sync now" press:
// the SPA appends A-E with status `requested`, and the Apps Script poller
// (`pollSyncRequests`, apps-script/src/sync-requests.js) writes every later
// value in E-I. #315 adds the SPA's append (A-E only) and the read; the layout
// and the mapper stay free of network code.
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

/** `sr_` + 8 hex, as `w_` ids. */
export function newSyncRequestId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return 'sr_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ask for a sync (#315): one row per vendor, A:E only, status `requested`.
 * The poller owns F:I. In demo mode nothing is written. Returns the rows
 * appended, so a test can see exactly what went to the sheet.
 */
export async function appendSyncRequests(
  vendors: readonly SyncRequestVendor[],
  email: string,
  token: string,
  now: Date = new Date(),
): Promise<string[][]> {
  const values = vendors.map((v) => [newSyncRequestId(), v, now.toISOString(), email, 'requested']);
  if (values.length === 0 || isDemo()) return values;
  await withReauth(token, (t) => sheetsAppend('SyncRequests!A:E', values, t));
  return values;
}

/** Every request row, in sheet order. Demo mode has none (its requests are simulated). */
export async function fetchSyncRequests(token: string): Promise<SyncRequestWithRow[]> {
  if (isDemo()) return [];
  return withReauth(token, async (t) => {
    const rows = await sheetsGet('SyncRequests!A2:I', t);
    return rows.map((row, i) => rowToSyncRequest(row, i + 2)).filter((r) => r.request_id);
  });
}
