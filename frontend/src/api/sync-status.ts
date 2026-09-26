// The Settings screen's "Last synced" line (#157, sync plan §10 layer 2): the
// user-facing half of the dead-man's switch. Pure, so every state is testable
// without a clock or a sheet.

import type { SyncLogEntry } from './sync-log-api';

/**
 * The same threshold as the COROS watchdog (`sync/src/deadman.mjs`), so the
 * phone and the failure email agree on what "stopped" means. Runs are four a
 * day with gaps of 4-9 h; one dropped run leaves at most ~15 h and heals
 * itself.
 */
export const COROS_STALE_AFTER_HOURS = 16;

/**
 * The Withings watchdog's threshold (`sync/deadman.mjs`, #200) — a shorter
 * window than COROS's because the Withings sync runs on its own schedule.
 * Passed into `summarizeSyncLog` alongside `WithingsSyncLog`'s entries so
 * neither vendor's staleness can hide behind the other's threshold.
 */
export const WITHINGS_STALE_AFTER_HOURS = 14;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export type SyncStatus =
  | { kind: 'empty' }
  | { kind: 'unreadable' }
  | {
      kind: 'run';
      newest: SyncLogEntry;
      /** ms since the newest run started, of any status — "is the job alive". */
      ageMs: number;
      stale: boolean;
      /** Set only when the newest run is not ok: "how old is my data". */
      lastOk: { entry: SyncLogEntry; ageMs: number } | null;
    };

function startedMs(e: SyncLogEntry): number {
  const t = Date.parse(e.started_at);
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Newest first by started_at, never by row position: a tab sorted by hand
 * must not make an old run look like the latest (as `getSyncLog` does).
 */
export function newestFirst<T extends SyncLogEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => startedMs(b) - startedMs(a));
}

/**
 * `staleAfterHours` is the caller's vendor threshold (`COROS_STALE_AFTER_HOURS`
 * or `WITHINGS_STALE_AFTER_HOURS`), so one vendor's watchdog window never
 * silently governs the other's row (#210).
 */
export function summarizeSyncLog(entries: SyncLogEntry[], now: Date, staleAfterHours: number): SyncStatus {
  if (entries.length === 0) return { kind: 'empty' };
  const sorted = newestFirst(entries).filter((e) => startedMs(e) > -Infinity);
  if (sorted.length === 0) return { kind: 'unreadable' };

  const newest = sorted[0];
  // A clock a little behind the sheet's must not show a negative age.
  const age = (e: SyncLogEntry) => Math.max(0, now.getTime() - startedMs(e));
  const ageMs = age(newest);
  let lastOk: { entry: SyncLogEntry; ageMs: number } | null = null;
  if (newest.status !== 'ok') {
    const ok = sorted.find((e) => e.status === 'ok');
    lastOk = ok ? { entry: ok, ageMs: age(ok) } : null;
  }
  return { kind: 'run', newest, ageMs, stale: ageMs > staleAfterHours * HOUR, lastOk };
}

/** "just now", "42 min ago", "5 h ago", "3 d ago". */
export function formatAge(ms: number): string {
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)} h ago`;
  return `${Math.floor(ms / (24 * HOUR))} d ago`;
}

/** The status words for the newest run; '' for ok. Never error_detail. */
export function statusWords(status: string): string {
  switch (status) {
    case 'ok': return '';
    case 'failed': return 'Last run failed';
    case 'partial': return 'Last run finished with errors';
    default: return 'Last run status unknown';
  }
}

export type SyncTone = 'neutral' | 'warning' | 'danger';

/** Stale or failed is danger, partial is warning, a fresh ok run is neutral. */
export function syncTone(s: SyncStatus): SyncTone {
  if (s.kind !== 'run') return 'neutral';
  if (s.stale || s.newest.status === 'failed') return 'danger';
  if (s.newest.status !== 'ok') return 'warning';
  return 'neutral';
}
