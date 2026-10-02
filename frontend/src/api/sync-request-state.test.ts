// #315 AC2 — what each vendor's request says, in every state and at both ceilings.

import { describe, it, expect } from 'vitest';
import { requestView, newestRequest, isRecent } from './sync-request-state';
import { rowToSyncRequest } from './sync-requests-api';
import type { SyncLogEntry } from './sync-log-api';

const T0 = Date.parse('2026-10-02T13:12:00.000Z'); // 7:12 AM Denver
const at = (min: number) => new Date(T0 + min * 60_000);
const iso = (min: number) => at(min).toISOString();

function req(over: Record<string, string> = {}) {
  return { ...rowToSyncRequest(['sr_1a2b3c4d', 'coros', iso(0), '', 'requested'], 2), ...over };
}
function logRow(run_id: string, status = 'ok'): SyncLogEntry {
  return {
    run_id, started_at: iso(2), finished_at: iso(3), window_start: '', window_end: '', n_seen: '0', n_new: '0',
    n_updated: '0', n_enriched: '0', n_fit_fetched: '0', n_errors: '0', status, error_detail: 'SECRET', notes: '',
  };
}

describe('requestView', () => {
  it('is null with no request', () => expect(requestView(null, [], at(0))).toBeNull());

  it('requested: waiting, then not picked up, then past the ceiling', () => {
    expect(requestView(req(), [], at(1))).toMatchObject({ open: true, text: 'Requested 7:12 AM. Waiting for it to start.' });
    expect(requestView(req(), [], at(5))).toMatchObject({ open: true, tone: 'warning' });
    expect(requestView(req(), [], at(5))!.text).toContain('not picked up yet');
    const late = requestView(req(), [], at(20))!;
    expect(late.open).toBe(false);
    expect(late.text).toContain('not picked up within 20 minutes');
    expect(late.text).toContain('next scheduled sync');
  });

  it('started: running, then no result 20 minutes after dispatch (not after the request)', () => {
    const r = req({ status: 'started', workflow_run_id: '123', dispatched_at: iso(10) });
    expect(requestView(r, [], at(11))).toMatchObject({ open: true });
    expect(requestView(r, [], at(11))!.text).toContain('Started 7:22 AM');
    expect(requestView(r, [], at(29))!.open).toBe(true); // 19 min after dispatch
    const done = requestView(r, [], at(30))!;
    expect(done.open).toBe(false);
    expect(done.text).toContain('No result 20 minutes');
    expect(done.tone).toBe('danger');
  });

  it('a log row for the run outranks the request status, with the run id matched whole', () => {
    const r = req({ status: 'started', workflow_run_id: '12', dispatched_at: iso(1) });
    expect(requestView(r, [logRow('workflow_dispatch-123-1')], at(4))!.open).toBe(true);
    const v = requestView(r, [logRow('workflow_dispatch-12-1')], at(4))!;
    expect(v).toMatchObject({ open: false, tone: 'neutral', text: 'Finished 7:15 AM: ok' });
    expect(requestView(r, [logRow('workflow_dispatch-12-1', 'partial')], at(4))!.text).toContain('finished with errors');
    expect(requestView(r, [logRow('workflow_dispatch-12-1', 'failed')], at(4))!.tone).toBe('danger');
    // Never error_detail.
    expect(JSON.stringify(v)).not.toContain('SECRET');
  });

  it('shows the poller detail for every final status, with a fallback when blank', () => {
    for (const status of ['done', 'cancelled', 'failed', 'not_reported', 'skipped', 'expired']) {
      const v = requestView(req({ status, detail: `words for ${status}` }), [], at(6))!;
      expect(v).toMatchObject({ open: false, text: `words for ${status}` });
      expect(requestView(req({ status }), [], at(6))!.text.length).toBeGreaterThan(5);
    }
  });

  it('an unknown status says nothing', () => {
    expect(requestView(req({ status: 'weird' }), [], at(1))).toBeNull();
  });
});

describe('newestRequest / isRecent', () => {
  it('picks the newest per vendor by requested_at, not row position', () => {
    const rows = [
      req({ request_id: 'a', requested_at: iso(10) }),
      req({ request_id: 'b', requested_at: iso(0) }),
      req({ request_id: 'c', vendor: 'withings', requested_at: iso(20) }),
    ];
    expect(newestRequest(rows, 'coros')!.request_id).toBe('a');
    expect(newestRequest(rows, 'withings')!.request_id).toBe('c');
    expect(newestRequest(rows, 'garmin')).toBeNull();
  });

  it('is recent for an hour', () => {
    expect(isRecent(req(), at(59))).toBe(true);
    expect(isRecent(req(), at(60))).toBe(false);
  });
});
