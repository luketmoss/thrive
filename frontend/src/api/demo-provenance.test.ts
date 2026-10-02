// #157 AC5 — demo mode shows every badge state and every "Last synced" state,
// so none of them needs real credentials to preview.

import { describe, it, expect } from 'vitest';
import { DEMO_WORKOUTS, DEMO_SETS, DEMO_EXERCISES, demoSyncLog, demoWithingsSyncLog } from './demo-data';
import { provenanceOf } from './provenance';
import { corosActivityUrl } from './coros-link';
import { summarizeSyncLog, syncTone, COROS_STALE_AFTER_HOURS, WITHINGS_STALE_AFTER_HOURS } from './sync-status';
import { SyncLogNotSetUpError } from './sync-log-errors';

describe('AC5: demo workouts cover all three provenance states', () => {
  const completed = DEMO_WORKOUTS.filter((w) => w.status === '');

  it('has a manual, a synced and an enriched completed workout', () => {
    const states = new Set(completed.map(provenanceOf));
    expect([...states].sort()).toEqual(['enriched', 'manual', 'synced']);
  });

  const enriched = DEMO_WORKOUTS.find((w) => provenanceOf(w) === 'enriched')!;

  it('makes the enriched example a hand-logged weight workout with sets', () => {
    expect(enriched.type).toBe('weight');
    expect(enriched.source).toBe('');
    const sets = DEMO_SETS.filter((s) => s.workout_id === enriched.id);
    expect(sets.length).toBeGreaterThan(0);
    const ids = new Set(DEMO_EXERCISES.map((e) => e.id));
    for (const s of sets) expect(ids.has(s.exercise_id), s.exercise_id).toBe(true);
  });

  it('uses non-round seconds in the enriched fixture', () => {
    for (const v of [enriched.elapsed_seconds, enriched.moving_seconds]) {
      expect(Number(v) % 60, v).not.toBe(0);
    }
  });

  it('keeps sheetRow unique across workouts and across sets', () => {
    const wRows = DEMO_WORKOUTS.map((w) => w.sheetRow);
    const sRows = DEMO_SETS.map((s) => s.sheetRow);
    expect(new Set(wRows).size).toBe(wRows.length);
    expect(new Set(sRows).size).toBe(sRows.length);
  });
});

describe('AC5: demo SyncLog previews each state', () => {
  const now = new Date('2026-09-24T18:40:11.000Z');

  it('defaults to a fresh ok run', () => {
    const s = summarizeSyncLog(demoSyncLog(now, 'ok'), now, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.newest.status).toBe('ok');
    expect(s.kind === 'run' && s.stale).toBe(false);
    expect(syncTone(s)).toBe('neutral');
  });

  it('is stale in the stale scenario', () => {
    const s = summarizeSyncLog(demoSyncLog(now, 'stale'), now, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.stale).toBe(true);
  });

  it('has a failed newest run with an older ok run in the failed scenario', () => {
    const s = summarizeSyncLog(demoSyncLog(now, 'failed'), now, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.newest.status).toBe('failed');
    expect(s.kind === 'run' && s.lastOk).not.toBeNull();
    expect(syncTone(s)).toBe('danger');
  });

  it('has a partial newest run in the partial scenario', () => {
    const s = summarizeSyncLog(demoSyncLog(now, 'partial'), now, COROS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.newest.status).toBe('partial');
    expect(syncTone(s)).toBe('warning');
  });

  it('is empty in the empty scenario, and throws in the error scenario', () => {
    expect(summarizeSyncLog(demoSyncLog(now, 'empty'), now, COROS_STALE_AFTER_HOURS)).toEqual({ kind: 'empty' });
    expect(() => demoSyncLog(now, 'error')).toThrow();
  });

  it('writes rows oldest first, like the sheet, so the newest is found by time', () => {
    const rows = demoSyncLog(now, 'ok');
    const times = rows.map((r) => Date.parse(r.started_at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('#210 AC4: demo WithingsSyncLog previews each state independently of COROS', () => {
  const now = new Date('2026-09-24T18:40:11.000Z');

  it('defaults to a fresh ok run, distinct run_ids from the COROS log', () => {
    const withings = demoWithingsSyncLog(now, 'ok');
    const coros = demoSyncLog(now, 'ok');
    const s = summarizeSyncLog(withings, now, WITHINGS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.newest.status).toBe('ok');
    expect(withings.every((r) => !coros.some((c) => c.run_id === r.run_id))).toBe(true);
  });

  it('is stale past its 14 h threshold at an age that is still fresh for COROS', () => {
    const s = summarizeSyncLog(demoWithingsSyncLog(now, 'stale'), now, WITHINGS_STALE_AFTER_HOURS);
    expect(s.kind === 'run' && s.stale).toBe(true);
  });

  it('throws SyncLogNotSetUpError for the missing scenario (AC3)', () => {
    expect(() => demoWithingsSyncLog(now, 'missing')).toThrow(SyncLogNotSetUpError);
  });

  it('throws a plain error for the error scenario', () => {
    expect(() => demoWithingsSyncLog(now, 'error')).toThrow();
  });
});

// #260 AC9: demo mode shows the "View on COROS" link on the synced hike and
// the enriched Leg Day, and only there.
describe('#260 AC9: demo COROS rows carry digit IDs and a sport code', () => {
  const byId = (id: string) => DEMO_WORKOUTS.find((w) => w.id === id)!;

  it('gives w_demo008 (hike, 104) and w_demo009 (strength, 402) a portal link', () => {
    expect(byId('w_demo008').sport_type).toBe('104');
    expect(byId('w_demo009').sport_type).toBe('402');
    for (const id of ['w_demo008', 'w_demo009']) {
      const w = byId(id);
      expect(w.source_activity_id, id).toMatch(/^\d+$/);
      expect(corosActivityUrl(w), id).toBe(
        `https://t.coros.com/activity-detail?labelId=${w.source_activity_id}&sportType=${w.sport_type}`,
      );
    }
  });

  it('gives every other demo row a blank sport_type, and no link', () => {
    for (const w of DEMO_WORKOUTS.filter((x) => x.id !== 'w_demo008' && x.id !== 'w_demo009')) {
      expect(w.sport_type, w.id).toBe('');
      expect(corosActivityUrl(w), w.id).toBeNull();
    }
  });
});
