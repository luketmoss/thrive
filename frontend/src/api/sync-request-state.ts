// What one vendor's Sync now request looks like to the user (#315). Pure:
// request row + that vendor's log rows + now, so every state and both ceilings
// are testable without a clock. The wording for the poller's final statuses is
// the poller's own `detail` (#314); the SPA only adds what it can know first.

import type { SyncRequest } from './sync-requests-api';
import type { SyncLogEntry } from './sync-log-api';
import { syncTime } from '../day/format';
import { todayInDenver } from '../day/dates';

const MINUTE = 60_000;
/** Not picked up after this long: say so, but it may still start (#232). */
export const NOT_PICKED_UP_AFTER_MIN = 5;
/** The poller's ceiling (#314): past this the SPA says so without waiting for it. */
export const CEILING_MIN = 20;

export type RequestTone = 'neutral' | 'warning' | 'danger';
export interface RequestView {
  /** True while a request is waiting or running: one more press is a no-op, and polling continues. */
  open: boolean;
  text: string;
  tone: RequestTone;
}

function clock(iso: string, now: Date): string {
  return syncTime(iso, todayInDenver(now));
}

/** The log row for a dispatched run: `workflow_dispatch-<id>-<attempt>`, the id matched whole. */
function loggedRun(req: SyncRequest, log: readonly SyncLogEntry[]): SyncLogEntry | null {
  if (!/^\d+$/.test(req.workflow_run_id)) return null;
  const re = new RegExp(`^workflow_dispatch-${req.workflow_run_id}-\\d+$`);
  return log.find((e) => re.test(e.run_id)) ?? null;
}

const FINAL_FALLBACK: Record<string, string> = {
  done: 'Finished.',
  cancelled: 'GitHub cancelled the run, usually because a scheduled sync took its place.',
  failed: 'The sync did not start. Ask again later.',
  not_reported: `No result ${CEILING_MIN} minutes after the run was started. The next scheduled sync will try again.`,
  skipped: 'Not started: a sync is already under way or ran a few minutes ago.',
  expired: `Not started: this request was not picked up within ${CEILING_MIN} minutes. The next scheduled sync will run as usual.`,
};

export function requestView(req: SyncRequest | null, log: readonly SyncLogEntry[], now: Date): RequestView | null {
  if (!req) return null;
  const nowMs = now.getTime();
  const requestedMs = Date.parse(req.requested_at);
  const sinceRequest = Number.isNaN(requestedMs) ? 0 : (nowMs - requestedMs) / MINUTE;
  const at = clock(req.requested_at, now);

  // A finished run's own log row outranks the request's status (#314), so the
  // SPA need not wait for the poller's next tick to say "finished".
  const logged = loggedRun(req, log);
  if (logged) {
    const when = clock(logged.finished_at || logged.started_at, now);
    const outcome = logged.status === 'ok' ? 'ok'
      : logged.status === 'partial' ? 'finished with errors'
      : logged.status === 'failed' ? 'the run failed' : logged.status;
    return {
      open: false,
      text: `Finished${when ? ` ${when}` : ''}: ${outcome}`,
      tone: logged.status === 'ok' ? 'neutral' : logged.status === 'partial' ? 'warning' : 'danger',
    };
  }

  switch (req.status) {
    case 'requested':
      if (sinceRequest >= CEILING_MIN) {
        return { open: false, tone: 'danger', text: FINAL_FALLBACK.expired };
      }
      if (sinceRequest >= NOT_PICKED_UP_AFTER_MIN) {
        return { open: true, tone: 'warning', text: `Requested ${at} and not picked up yet. It may still start.` };
      }
      return { open: true, tone: 'neutral', text: `Requested ${at}. Waiting for it to start.` };
    case 'started': {
      const startedMs = Date.parse(req.dispatched_at);
      const sinceStart = Number.isNaN(startedMs) ? sinceRequest : (nowMs - startedMs) / MINUTE;
      if (sinceStart >= CEILING_MIN) {
        return { open: false, tone: 'danger', text: FINAL_FALLBACK.not_reported };
      }
      const started = clock(req.dispatched_at, now);
      return {
        open: true, tone: 'neutral',
        text: `Started${started ? ` ${started}` : ''}. Running; a result may take up to 5 minutes to show here.`,
      };
    }
    case 'done': case 'cancelled': case 'failed': case 'not_reported': case 'skipped': case 'expired':
      return {
        open: false,
        text: req.detail.trim() || FINAL_FALLBACK[req.status],
        tone: req.status === 'done' || req.status === 'skipped' ? 'neutral'
          : req.status === 'cancelled' ? 'warning' : 'danger',
      };
    default:
      return null;
  }
}

/** The newest request row per vendor, by `requested_at` (never row position). */
export function newestRequest<T extends SyncRequest>(rows: readonly T[], vendor: string): T | null {
  let best: T | null = null;
  let bestMs = -Infinity;
  for (const r of rows) {
    if (r.vendor !== vendor) continue;
    const t = Date.parse(r.requested_at);
    const ms = Number.isNaN(t) ? -Infinity : t;
    if (best === null || ms > bestMs) { best = r; bestMs = ms; }
  }
  return best;
}

/** On opening Settings only an open request, or one made in the last hour, is shown. */
export const SHOW_FINAL_FOR_MIN = 60;
export function isRecent(req: SyncRequest, now: Date): boolean {
  const t = Date.parse(req.requested_at);
  return !Number.isNaN(t) && now.getTime() - t < SHOW_FINAL_FOR_MIN * MINUTE;
}
