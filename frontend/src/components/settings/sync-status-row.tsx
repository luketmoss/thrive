import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { syncLog, withingsSyncLog, type SyncLogState } from '../../state/store';
import { loadSyncLog, loadWithingsSyncLog } from '../../state/actions';
import {
  summarizeSyncLog, formatAge, statusWords, syncTone,
  COROS_STALE_AFTER_HOURS, WITHINGS_STALE_AFTER_HOURS,
} from '../../api/sync-status';
import { formatLocalStamp } from '../../api/provenance';

const MINUTE = 60 * 1000;

interface SyncStatusRowProps {
  /** Unique id for the row's own label, so the status region can be named by it (aria-labelledby, #210). */
  id: string;
  label: string;
  token: string | null;
  log: SyncLogState;
  staleAfterHours: number;
  loadFn: (token: string) => Promise<void>;
}

/**
 * One vendor's "last synced" line (#157, #210, sync plan §10 layer 2): a
 * read of that vendor's own log tab, shown with its age, going visibly stale
 * on its own watchdog threshold. It makes the user the monitor, so every
 * state is in words, never colour alone, and error_detail/notes are never
 * shown. Rendered twice — once per vendor — each with its own log, threshold
 * and load, so one vendor's read failing never blanks the other's row.
 */
export function SyncStatusRow({ id, label, token, log, staleAfterHours, loadFn }: SyncStatusRowProps) {
  // A one-minute tick, so "just now" does not sit there for an hour.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), MINUTE);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (token) void loadFn(token);
  }, [token, loadFn]);

  let body: ComponentChildren;

  if (log.state === 'idle' || log.state === 'loading') {
    body = <span class="sync-status-line">Checking…</span>;
  } else if (log.state === 'not-set-up') {
    // Expected before the tab's migration has run (#200) — neutral, not a failure (AC3).
    body = <span class="sync-status-line">Not set up yet</span>;
  } else if (log.state === 'error') {
    body = <span class="sync-status-line sync-tone-warning">Couldn't read the sync log</span>;
  } else {
    const s = summarizeSyncLog(log.entries, now, staleAfterHours);
    if (s.kind === 'empty') {
      body = <span class="sync-status-line">No sync runs recorded yet</span>;
    } else if (s.kind === 'unreadable') {
      body = <span class="sync-status-line sync-tone-warning">Couldn't read the sync log</span>;
    } else {
      const tone = syncTone(s);
      const words = [s.stale ? 'Sync may have stopped' : '', statusWords(s.newest.status)].filter(Boolean);
      const stamp = formatLocalStamp(s.newest.started_at);
      body = (
        <>
          <span class="sync-status-line">
            {formatAge(s.ageMs)}
            {stamp && <span class="sync-status-stamp"> · {stamp}</span>}
          </span>
          {words.length > 0 && (
            <span class={`sync-status-line sync-status-words sync-tone-${tone}`}>{words.join(' · ')}</span>
          )}
          {s.newest.status !== 'ok' && (
            <span class="sync-status-line sync-status-last-ok">
              {s.lastOk
                ? `Last successful run ${formatAge(s.lastOk.ageMs)}`
                : 'No successful run in the log'}
            </span>
          )}
        </>
      );
    }
  }

  return (
    <div class="settings-row sync-status-row">
      <span id={id}>{label}</span>
      <span class="sync-status" role="status" aria-labelledby={id}>
        {body}
      </span>
    </div>
  );
}

/** COROS's row: `SyncLog`, stale past 16 h. */
export function CorosSyncStatusRow({ token }: { token: string | null }) {
  return (
    <SyncStatusRow
      id="sync-status-coros"
      label="COROS last synced"
      token={token}
      log={syncLog.value}
      staleAfterHours={COROS_STALE_AFTER_HOURS}
      loadFn={loadSyncLog}
    />
  );
}

/** Withings's row: `WithingsSyncLog`, stale past 14 h (#200, #210). */
export function WithingsSyncStatusRow({ token }: { token: string | null }) {
  return (
    <SyncStatusRow
      id="sync-status-withings"
      label="Withings last synced"
      token={token}
      log={withingsSyncLog.value}
      staleAfterHours={WITHINGS_STALE_AFTER_HOURS}
      loadFn={loadWithingsSyncLog}
    />
  );
}
