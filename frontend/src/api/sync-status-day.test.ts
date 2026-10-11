// #409 AC1 — the Day view's one "Synced <age>" line, collapsed from both vendors.
import { describe, it, expect } from 'vitest';
import { collapseSyncStatus } from './sync-status';
import type { SyncLogState } from '../state/store';
import { rowToSyncLog } from './sync-log-api';

const NOW = new Date('2026-10-02T18:00:00.000Z');
const HOUR = 3_600_000;

function run(hoursAgo: number, status = 'ok'): ReturnType<typeof rowToSyncLog> {
  const started = new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
  return rowToSyncLog(['r' + hoursAgo, started, started, '', '', 0, 0, 0, 0, 0, 0, status, 'SECRET DETAIL', 'SECRET NOTES'], 2);
}
const loaded = (...e: ReturnType<typeof run>[]): SyncLogState => ({ state: 'loaded', entries: e });
const idle: SyncLogState = { state: 'idle' };

describe('collapseSyncStatus', () => {
  it('reads the OLDER of the two newest runs', () => {
    const s = collapseSyncStatus(loaded(run(2)), loaded(run(5)), NOW);
    expect(s.text).toBe('Synced 5 h ago');
    expect(s.notes).toEqual([]);
    expect(s.tone).toBe('neutral');
  });

  it('leaves a not-set-up vendor out of the age', () => {
    expect(collapseSyncStatus(loaded(run(3)), { state: 'not-set-up' }, NOW).text).toBe('Synced 3 h ago');
    expect(collapseSyncStatus({ state: 'not-set-up' }, loaded(run(1)), NOW).text).toBe('Synced 1 h ago');
  });

  it('says no sync recorded when neither vendor has a run', () => {
    expect(collapseSyncStatus(loaded(), { state: 'not-set-up' }, NOW).text).toBe('No sync recorded yet');
    expect(collapseSyncStatus(loaded(), loaded(), NOW).text).toBe('No sync recorded yet');
  });

  it('says Checking while either log first loads', () => {
    expect(collapseSyncStatus(idle, loaded(run(1)), NOW).text).toBe('Checking…');
    expect(collapseSyncStatus(loaded(run(1)), { state: 'loading' }, NOW).text).toBe('Checking…');
  });

  it('says it could not read when a read failed, in warning tone', () => {
    const s = collapseSyncStatus({ state: 'error' }, loaded(run(1)), NOW);
    expect(s.text).toBe("Couldn't read sync status");
    expect(s.tone).toBe('warning');
  });

  it('names a vendor whose newest run failed, finished with errors or went stale', () => {
    expect(collapseSyncStatus(loaded(run(1, 'failed')), loaded(run(1)), NOW).notes)
      .toEqual([{ vendor: 'COROS', text: 'COROS last run failed', tone: 'danger' }]);
    expect(collapseSyncStatus(loaded(run(1)), loaded(run(1, 'partial')), NOW).notes)
      .toEqual([{ vendor: 'Withings', text: 'Withings last run finished with errors', tone: 'warning' }]);
    // Withings goes stale past 14 h, COROS only past 16 h.
    expect(collapseSyncStatus(loaded(run(15)), loaded(run(15)), NOW).notes)
      .toEqual([{ vendor: 'Withings', text: 'Withings sync may have stopped', tone: 'danger' }]);
    expect(collapseSyncStatus(loaded(run(17)), loaded(run(1)), NOW).notes)
      .toEqual([{ vendor: 'COROS', text: 'COROS sync may have stopped', tone: 'danger' }]);
  });

  it('never carries error_detail or notes', () => {
    const s = collapseSyncStatus(loaded(run(1, 'failed')), loaded(run(20, 'partial')), NOW);
    expect(JSON.stringify(s)).not.toContain('SECRET');
  });
});
