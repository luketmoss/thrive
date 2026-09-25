import { useEffect, useState } from 'preact/hooks';
import { syncLog } from '../../state/store';
import { loadSyncLog } from '../../state/actions';
import { summarizeSyncLog, formatAge, statusWords, syncTone } from '../../api/sync-status';
import { formatLocalStamp } from '../../api/provenance';

const MINUTE = 60 * 1000;

/**
 * The "Last synced" line (#157, sync plan §10 layer 2): one read of SyncLog,
 * shown with its age, going visibly stale when the job stops. It makes the
 * user the monitor, so every state is in words, never colour alone, and
 * error_detail/notes are never shown.
 */
export function SyncStatusRow({ token }: { token: string | null }) {
  // A one-minute tick, so "just now" does not sit there for an hour.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (token) void loadSyncLog(token);
  }, [token]);

  const log = syncLog.value;
  let body;

  if (log.state === 'idle' || log.state === 'loading') {
    body = <span class="sync-status-line">Checking…</span>;
  } else if (log.state === 'error') {
    body = <span class="sync-status-line sync-tone-warning">Couldn't read the sync log</span>;
  } else {
    const s = summarizeSyncLog(log.entries, now);
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
      <span>Last synced</span>
      <span class="sync-status" role="status">
        {body}
      </span>
    </div>
  );
}
