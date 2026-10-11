// #409 — the Day view's sync line: "Synced <age>" with a Sync now control, and
// the request's state in place below it.
//
// Row 1 is always the age (left) and the control (right, same place and width
// idle or busy); request messages are extra rows below it and only ever grow
// downward, so the control never moves under the finger. The request rows are
// the one polite live region; the minute-by-minute age tick is outside it.
// "Sync" here is the COROS/Withings sync (#315), not the offline save queue.

import { useEffect, useRef, useState } from 'preact/hooks';
import { syncLog, withingsSyncLog, syncRequests, syncAsk, demoSyncPressedAt } from '../../state/store';
import { isDemo } from '../../api/demo-data';
import { collapseSyncStatus } from '../../api/sync-status';
import { newestRequest, type RequestView } from '../../api/sync-request-state';
import type { SyncRequestVendor } from '../../api/sync-requests-api';
import type { SyncNow } from '../settings/sync-now';

const MINUTE = 60_000;
/** A final message stays this long: the server's cooldown window, which is how long "Ask again after" matters. */
export const DAY_FINAL_FOR_MS = 10 * MINUTE;

const VENDOR_NAMES: Record<SyncRequestVendor, string> = { coros: 'COROS', withings: 'Withings' };

export interface DayRequestEntry {
  /** Null when both vendors say the same thing (e.g. "Asking for a sync…"). */
  vendor: string | null;
  view: RequestView;
}

/**
 * The request rows to show: each vendor's `useSyncNow` line verbatim, prefixed
 * with the vendor name (one entry when both are identical). An open request
 * always shows; a final message goes away `DAY_FINAL_FOR_MS` after it was
 * finished (`finalAt(vendor)` is when, ms, or null when unknown: it then stays).
 */
export function dayRequestEntries(
  lines: SyncNow['lines'],
  now: number,
  finalAt: (vendor: SyncRequestVendor) => number | null,
): DayRequestEntry[] {
  const shown: { vendor: SyncRequestVendor; view: RequestView }[] = [];
  for (const vendor of ['coros', 'withings'] as const) {
    const view = lines[vendor];
    if (!view) continue;
    if (!view.open) {
      const at = finalAt(vendor);
      if (at !== null && now - at >= DAY_FINAL_FOR_MS) continue;
    }
    shown.push({ vendor, view });
  }
  if (shown.length === 2 && shown[0].view.text === shown[1].view.text && shown[0].view.tone === shown[1].view.tone) {
    return [{ vendor: null, view: shown[0].view }];
  }
  return shown.map(({ vendor, view }) => ({ vendor: VENDOR_NAMES[vendor], view }));
}

function SyncIcon() {
  return (
    <svg class="day-sync-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M16 7.5A6.5 6.5 0 0 0 4.2 6M4 12.5A6.5 6.5 0 0 0 15.8 14M4 3v3.5h3.5M16 17v-3.5h-3.5"
        fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
      />
    </svg>
  );
}

export function DaySyncLine({ sync }: { sync: SyncNow }) {
  // A one-minute tick, so "just now" does not sit there for an hour.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(tick);
  }, []);

  const status = collapseSyncStatus(syncLog.value, withingsSyncLog.value, new Date(now));

  // A failed ask has no request row to date it by: note when this screen first saw it.
  const ask = syncAsk.value;
  const askFailedAt = useRef<number | null>(null);
  if (ask !== 'failed') askFailedAt.current = null;
  else if (askFailedAt.current === null) askFailedAt.current = Date.now();

  const demo = isDemo();
  const pressedAt = demoSyncPressedAt.value;
  const finalAt = (vendor: SyncRequestVendor): number | null => {
    if (ask === 'failed') return askFailedAt.current;
    if (demo) return pressedAt;
    const req = newestRequest(syncRequests.value, vendor);
    if (!req) return null;
    const t = Date.parse(req.finished_at) || Date.parse(req.requested_at);
    return Number.isNaN(t) ? null : t;
  };
  const entries = dayRequestEntries(sync.lines, now, finalAt);

  const busy = sync.bothOpen || sync.asking;
  return (
    <div class="day-sync">
      <div class="day-sync-row">
        <div class="day-sync-text">
          <p class={`day-sync-age${status.tone === 'neutral' ? '' : ` sync-tone-${status.tone}`}`}>{status.text}</p>
          {status.notes.map((n) => (
            <p key={n.vendor} class={`day-sync-note sync-tone-${n.tone}`}>{n.text}</p>
          ))}
        </div>
        <button
          type="button"
          class={`day-sync-btn${busy ? ' day-sync-busy' : ''}`}
          aria-disabled={busy ? 'true' : undefined}
          onClick={() => { if (!busy) sync.press(); }}
        >
          <SyncIcon />
          <span>{busy ? 'Syncing…' : 'Sync now'}</span>
        </button>
      </div>
      <div class="day-sync-requests" role="status" aria-live="polite">
        {entries.map((e) => (
          <p key={e.vendor ?? 'both'} class={`day-sync-request${e.view.tone === 'neutral' ? '' : ` sync-tone-${e.view.tone}`}`}>
            {e.vendor ? `${e.vendor}: ` : ''}{e.view.text}
          </p>
        ))}
      </div>
    </div>
  );
}
