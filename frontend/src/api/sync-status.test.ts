// #157 AC3/AC4 — the "Last synced" line: newest run by started_at, its age,
// stale past the watchdog's 16 h, and failed/partial told apart from ok.

import { describe, it, expect } from 'vitest';
import {
  summarizeSyncLog, newestFirst, formatAge, statusWords, syncTone,
  COROS_STALE_AFTER_HOURS, WITHINGS_STALE_AFTER_HOURS,
} from './sync-status';
import type { SyncLogEntry } from './sync-log-api';

const NOW = new Date('2026-09-24T18:40:11.000Z');
const HOUR = 3600_000;

function run(hoursAgo: number, status = 'ok', id = `r${hoursAgo}`): SyncLogEntry {
  const started = new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
  return {
    run_id: id, started_at: started, finished_at: started, window_start: '2026-09-14',
    window_end: '2026-09-25', n_seen: '3', n_new: '0', n_updated: '0', n_enriched: '0',
    n_fit_fetched: '0', n_errors: status === 'ok' ? '0' : '1', status,
    error_detail: status === 'ok' ? '' : 'CorosApiError: secret detail', notes: '',
  };
}

describe('AC3: newest run by started_at', () => {
  it('ignores row position', () => {
    const log = [run(2, 'ok', 'newest'), run(30, 'ok', 'oldest'), run(9, 'ok', 'middle')];
    expect(newestFirst(log).map((e) => e.run_id)).toEqual(['newest', 'middle', 'oldest']);
    const s = summarizeSyncLog([log[1], log[2], log[0]], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.newest.run_id).toBe('newest');
  });

  it('reports the age of the newest run', () => {
    const s = summarizeSyncLog([run(5.5)], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind).toBe('run');
    if (s.kind === 'run') {
      expect(s.ageMs).toBe(5.5 * HOUR);
      expect(s.stale).toBe(false);
      expect(s.lastOk).toBeNull();
    }
  });

  it('never reports a negative age for a run stamped after the clock', () => {
    const s = summarizeSyncLog([run(-0.1)], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.ageMs).toBe(0);
  });

  it('is empty for an empty log', () => {
    expect(summarizeSyncLog([], NOW, COROS_STALE_AFTER_HOURS)).toEqual({ kind: 'empty' });
  });

  it('is unreadable when no row has a parseable started_at', () => {
    expect(summarizeSyncLog([{ ...run(1), started_at: 'yesterday' }], NOW, COROS_STALE_AFTER_HOURS)).toEqual({ kind: 'unreadable' });
  });

  it('skips an unparseable row rather than letting it be newest', () => {
    const s = summarizeSyncLog([{ ...run(0, 'ok', 'bad'), started_at: '' }, run(3, 'ok', 'good')], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.newest.run_id).toBe('good');
  });
});

describe('formatAge', () => {
  it.each([
    [20_000, 'just now'],
    [42 * 60_000 + 30_000, '42 min ago'],
    [HOUR, '1 h ago'],
    [19.6 * HOUR, '19 h ago'],
    [47.9 * HOUR, '47 h ago'],
    [3.2 * 24 * HOUR, '3 d ago'],
  ])('%d ms reads "%s"', (ms, text) => {
    expect(formatAge(ms)).toBe(text);
  });
});

describe('AC4: stale past the watchdog threshold', () => {
  it('uses the COROS watchdog\'s 16 hours', () => {
    expect(COROS_STALE_AFTER_HOURS).toBe(16);
  });

  it('is fresh at exactly 16 h and stale just past it', () => {
    const at = summarizeSyncLog([run(16)], NOW, COROS_STALE_AFTER_HOURS);
    const past = summarizeSyncLog([run(16.02)], NOW, COROS_STALE_AFTER_HOURS);
    expect(at.kind === 'run' && at.stale).toBe(false);
    expect(past.kind === 'run' && past.stale).toBe(true);
    expect(syncTone(past)).toBe('danger');
  });

  it('measures the newest run of any status, as the watchdog does', () => {
    const s = summarizeSyncLog([run(2, 'failed'), run(30, 'ok')], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.stale).toBe(false);
  });
});

describe('#210: a threshold passed in, per vendor', () => {
  it('uses the Withings watchdog\'s 14 hours', () => {
    expect(WITHINGS_STALE_AFTER_HOURS).toBe(14);
  });

  it('the same age is stale on the Withings threshold but not on the COROS one', () => {
    const coros = summarizeSyncLog([run(15)], NOW, COROS_STALE_AFTER_HOURS);
    const withings = summarizeSyncLog([run(15)], NOW, WITHINGS_STALE_AFTER_HOURS);
    expect(coros.kind === 'run' && coros.stale).toBe(false);
    expect(withings.kind === 'run' && withings.stale).toBe(true);
  });
});

describe('AC4: failed and partial are distinguishable from ok', () => {
  it('says nothing extra for ok, and names failed and partial', () => {
    expect(statusWords('ok')).toBe('');
    expect(statusWords('failed')).toBe('Last run failed');
    expect(statusWords('partial')).toBe('Last run finished with errors');
    expect(statusWords('')).toBe('Last run status unknown');
  });

  it('tones ok neutral, partial warning, failed danger', () => {
    expect(syncTone(summarizeSyncLog([run(1, 'ok')], NOW, COROS_STALE_AFTER_HOURS))).toBe('neutral');
    expect(syncTone(summarizeSyncLog([run(1, 'partial')], NOW, COROS_STALE_AFTER_HOURS))).toBe('warning');
    expect(syncTone(summarizeSyncLog([run(1, 'failed')], NOW, COROS_STALE_AFTER_HOURS))).toBe('danger');
    expect(syncTone({ kind: 'empty' })).toBe('neutral');
  });

  it('gives the age of the newest ok run when the newest is not ok', () => {
    const s = summarizeSyncLog([run(1.2, 'failed'), run(6.2, 'failed'), run(10.2, 'ok', 'good'), run(14, 'ok')], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind).toBe('run');
    if (s.kind === 'run') {
      expect(s.lastOk?.entry.run_id).toBe('good');
      expect(s.lastOk?.ageMs).toBeCloseTo(10.2 * HOUR);
    }
  });

  it('says there is no ok run when the log has none', () => {
    const s = summarizeSyncLog([run(1, 'failed'), run(5, 'partial')], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.lastOk).toBeNull();
  });

  it('does not look for an ok run when the newest is ok', () => {
    const s = summarizeSyncLog([run(1, 'ok'), run(5, 'failed')], NOW, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.lastOk).toBeNull();
  });
});
