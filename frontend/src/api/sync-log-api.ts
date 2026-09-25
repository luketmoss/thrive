// SyncLog domain API (#157) — read-only. One row per COROS sync run, appended
// by the sync through the Apps Script API (#156). The SPA reads it directly,
// as it reads every other tab, for the Settings screen's "Last synced" line.
//
// Row mapping mirrors SYNC_LOG_FIELDS in apps-script/src/types.js; change both
// together. The SPA never writes this tab.

import { sheetsGet, withReauth } from './sheets';
import { isDemo, demoSyncLog } from './demo-data';

export const SYNC_LOG_FIELDS = [
  'run_id',        // A
  'started_at',    // B  ISO instant, the run's single synced_at
  'finished_at',   // C
  'window_start',  // D
  'window_end',    // E
  'n_seen',        // F
  'n_new',         // G
  'n_updated',     // H
  'n_enriched',    // I
  'n_fit_fetched', // J
  'n_errors',      // K
  'status',        // L  ok | partial | failed
  'error_detail',  // M  never displayed (#157)
  'notes',         // N  never displayed (#157)
] as const;

export type SyncLogField = typeof SYNC_LOG_FIELDS[number];
export type SyncLogEntry = Record<SyncLogField, string>;
export interface SyncLogEntryWithRow extends SyncLogEntry { sheetRow: number; }

/** One sheet row as an entry, '' where a cell is missing (a short row). */
export function rowToSyncLog(row: unknown[], sheetRow: number): SyncLogEntryWithRow {
  const entry = { sheetRow } as SyncLogEntryWithRow;
  SYNC_LOG_FIELDS.forEach((field, i) => {
    const v = row[i];
    entry[field] = v === undefined || v === null ? '' : String(v).trim();
  });
  return entry;
}

/** Every SyncLog row with a run_id, in sheet order. */
export async function fetchSyncLog(token: string): Promise<SyncLogEntryWithRow[]> {
  if (isDemo()) return demoSyncLog(new Date());

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('SyncLog!A2:N', t);
    return rows
      .map((row, i) => rowToSyncLog(row, i + 2))
      .filter((e) => e.run_id);
  });
}
