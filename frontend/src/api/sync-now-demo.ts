// Demo mode's simulated Sync now (#315): a request that walks every state on a
// fake clock (1 real second = 1 fake minute), writing nothing. It builds the
// same request and log rows the sheet would hold, so the real `requestView`
// renders them. `?demo=true&syncnow=` picks a scenario.

import type { SyncRequest, SyncRequestVendor } from './sync-requests-api';
import type { SyncLogEntry } from './sync-log-api';

export const DEMO_SYNC_NOW_SCENARIOS = ['ok', 'cooldown', 'silent', 'failed', 'append-failed'] as const;
export type DemoSyncNowScenario = typeof DEMO_SYNC_NOW_SCENARIOS[number];

/** Fake minutes per real second. */
export const DEMO_MINUTES_PER_SECOND = 1;

export function demoSyncNowScenario(): DemoSyncNowScenario {
  const raw = new URLSearchParams(window.location.search).get('syncnow') ?? '';
  return (DEMO_SYNC_NOW_SCENARIOS as readonly string[]).includes(raw) ? raw as DemoSyncNowScenario : 'ok';
}

const MIN = 60_000;

/**
 * One vendor's request and its log rows `elapsedMin` fake minutes after the
 * press at `pressedAt`. Poller-written closes land on its 5-minute ticks.
 */
export function demoVendorRequest(
  vendor: SyncRequestVendor,
  scenario: DemoSyncNowScenario,
  pressedAt: Date,
  elapsedMin: number,
): { req: SyncRequest; log: SyncLogEntry[] } {
  const at = (m: number) => new Date(pressedAt.getTime() + m * MIN).toISOString();
  const runId = vendor === 'coros' ? '9000001' : '9000002';
  const req: SyncRequest = {
    request_id: `sr_demo000${vendor === 'coros' ? 1 : 2}`, vendor, requested_at: at(0), requested_by: '',
    status: 'requested', workflow_run_id: '', dispatched_at: '', finished_at: '', detail: '',
  };
  const log: SyncLogEntry[] = [];
  const start = (m: number) => {
    if (elapsedMin >= m) Object.assign(req, { status: 'started', workflow_run_id: runId, dispatched_at: at(m) });
  };
  const close = (m: number, status: string, detail: string) => {
    if (elapsedMin >= m) Object.assign(req, { status, detail, finished_at: at(m) });
  };
  const logRow = (m: number, status: string) => {
    if (elapsedMin < m) return;
    log.push({
      run_id: `workflow_dispatch-${runId}-1`, started_at: at(m - 1), finished_at: at(m), window_start: '', window_end: '',
      n_seen: '0', n_new: '0', n_updated: '0', n_enriched: '0', n_fit_fetched: '0', n_errors: '0',
      status, error_detail: '', notes: '',
    });
  };

  if (scenario === 'ok') {
    start(1);
    logRow(vendor === 'coros' ? 3 : 2, 'ok');
  } else if (scenario === 'cooldown') {
    if (vendor === 'coros') {
      close(5, 'skipped', 'Not started: a COROS sync started a few minutes ago. Ask again in a few minutes.');
    } else {
      start(1);
      logRow(2, 'ok');
    }
  } else if (scenario === 'silent') {
    // COROS is never picked up and Withings never logs: both reach their ceilings.
    if (vendor === 'withings') start(1);
  } else if (scenario === 'failed') {
    if (vendor === 'coros') {
      close(5, 'failed', 'Not started: no GitHub token is set. Store one as the script property GITHUB_DISPATCH_TOKEN.');
    } else {
      start(1);
      close(5, 'cancelled', 'GitHub cancelled the run, usually because a scheduled sync took its place.');
    }
  }
  return { req, log };
}
