import { useEffect, useRef, useState } from 'preact/hooks';
import {
  syncLog, withingsSyncLog, syncRequests, syncAsk, demoSyncPressedAt,
  type SyncLogState,
} from '../../state/store';
import {
  loadSyncLog, loadWithingsSyncLog, loadSyncRequests, requestSyncNow, healthRefresh,
} from '../../state/actions';
import { onPageVisible } from '../../state/page-visible';
import { isDemo } from '../../api/demo-data';
import { SYNC_REQUEST_VENDORS, type SyncRequestVendor } from '../../api/sync-requests-api';
import { requestView, newestRequest, isRecent, type RequestView } from '../../api/sync-request-state';
import { demoVendorRequest, demoSyncNowScenario, DEMO_MINUTES_PER_SECOND } from '../../api/sync-now-demo';

/** How often an open request is re-read (3 Sheets reads each time; quota is 60 a minute). */
export const POLL_MS = 15_000;
const DEMO_TICK_MS = 500;

export type VendorViews = Record<SyncRequestVendor, RequestView | null>;
const ASK_FAILED_TEXT = "Couldn't ask for a sync. Check your connection and try again.";

function entriesOf(log: SyncLogState) {
  return log.state === 'loaded' ? log.entries : [];
}

/**
 * Everything Sync now needs (#315): the two vendor lines, whether any request
 * is open, and the press. Polls the sheet only while a request is open and the
 * page is visible. In demo mode the same views come from a simulated request on
 * a fake clock, and nothing is read or written.
 */
export function useSyncNow(token: string | null, email: string) {
  const [now, setNow] = useState(() => new Date());
  const demo = isDemo();
  const pressedAt = demoSyncPressedAt.value;
  const ask = syncAsk.value;

  const views: VendorViews = { coros: null, withings: null };
  if (demo) {
    if (pressedAt !== null) {
      const scenario = demoSyncNowScenario();
      const elapsedMin = ((now.getTime() - pressedAt) / 1000) * DEMO_MINUTES_PER_SECOND;
      const fakeNow = new Date(pressedAt + elapsedMin * 60_000);
      for (const v of SYNC_REQUEST_VENDORS) {
        const { req, log } = demoVendorRequest(v, scenario, new Date(pressedAt), elapsedMin);
        views[v] = requestView(req, log, fakeNow);
      }
    }
  } else {
    const logs = { coros: entriesOf(syncLog.value), withings: entriesOf(withingsSyncLog.value) };
    for (const v of SYNC_REQUEST_VENDORS) {
      const req = newestRequest(syncRequests.value, v);
      views[v] = req ? requestView(req, logs[v], now) : null;
      // Shown if open, or made within the last hour (so a reload keeps it).
      if (req && views[v] && !views[v]!.open && !isRecent(req, now)) views[v] = null;
    }
  }

  const open: Record<SyncRequestVendor, boolean> = {
    coros: !!views.coros?.open, withings: !!views.withings?.open,
  };
  const anyOpen = open.coros || open.withings || ask === 'asking';

  // Read the rows once on opening Settings.
  useEffect(() => {
    if (token && !demo) void loadSyncRequests(token);
  }, [token, demo]);

  // Poll only while a request is open: every 15 s and on the page becoming visible.
  useEffect(() => {
    if (!anyOpen) return;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      setNow(new Date());
      if (token && !demo) {
        void loadSyncRequests(token);
        void loadSyncLog(token);
        void loadWithingsSyncLog(token);
      }
    };
    const timer = setInterval(tick, demo ? DEMO_TICK_MS : POLL_MS);
    const off = onPageVisible(tick);
    return () => { clearInterval(timer); off(); };
  }, [anyOpen, token, demo]);

  // Day's next read must not be swallowed by its 60 s limit after a requested run (AC4).
  const wasOpen = useRef(false);
  const openNow = open.coros || open.withings;
  useEffect(() => {
    if (wasOpen.current && !openNow) healthRefresh.invalidate();
    wasOpen.current = openNow;
  }, [openNow]);

  const bothOpen = open.coros && open.withings;
  const press = () => {
    if (bothOpen || ask === 'asking' || !token && !demo) return;
    const vendors = SYNC_REQUEST_VENDORS.filter((v) => !open[v]);
    setNow(new Date());
    void requestSyncNow(token ?? '', email, vendors);
  };

  const askLine: RequestView | null =
    ask === 'asking' ? { open: true, tone: 'neutral', text: 'Asking for a sync…' }
    : ask === 'failed' ? { open: false, tone: 'danger', text: ASK_FAILED_TEXT }
    : null;
  const lines: VendorViews = {
    coros: askLine ?? views.coros,
    withings: askLine ?? views.withings,
  };

  return { lines, bothOpen, asking: ask === 'asking', press };
}

export type SyncNow = ReturnType<typeof useSyncNow>;

/** The button, above the two vendor rows so the rows growing never moves it. */
export function SyncNowButton({ sync }: { sync: SyncNow }) {
  const busy = sync.bothOpen || sync.asking;
  return (
    <button
      type="button"
      class="btn btn-primary sync-now-btn"
      aria-disabled={busy ? 'true' : undefined}
      onClick={() => { if (!busy) sync.press(); }}
    >
      {sync.asking ? 'Asking…' : sync.bothOpen ? 'Sync under way' : 'Sync now'}
    </button>
  );
}
