// #260 AC6 — one pure function builds the COROS portal URL, from public IDs only.

import { describe, it, expect } from 'vitest';
import { corosActivityUrl, COROS_PORTAL_HOST } from './coros-link';

const synced = {
  source: 'coros', source_activity_id: '480640601618940011', sport_type: '204', status: '',
};

describe('corosActivityUrl', () => {
  it('keeps the host in one constant', () => {
    expect(COROS_PORTAL_HOST).toBe('https://t.coros.com');
  });

  it('builds the verified shape: labelId and sportType, nothing else', () => {
    expect(corosActivityUrl(synced)).toBe(
      'https://t.coros.com/activity-detail?labelId=480640601618940011&sportType=204',
    );
    const url = new URL(corosActivityUrl(synced)!);
    expect([...url.searchParams.keys()]).toEqual(['labelId', 'sportType']);
  });

  it('links an enriched row (source blank, source_activity_id set)', () => {
    expect(corosActivityUrl({ ...synced, source: '', sport_type: '402' })).toBe(
      'https://t.coros.com/activity-detail?labelId=480640601618940011&sportType=402',
    );
  });

  it('gives null for a manual row', () => {
    expect(corosActivityUrl({ source: '', source_activity_id: '', sport_type: '', status: '' })).toBeNull();
  });

  it('gives null for a garmin_import row, even with digit IDs', () => {
    expect(corosActivityUrl({ ...synced, source: 'garmin_import' })).toBeNull();
  });

  it('gives null for a planned workout', () => {
    expect(corosActivityUrl({ ...synced, status: 'planned' })).toBeNull();
  });

  it('gives null for a blank sport_type (not yet backfilled)', () => {
    expect(corosActivityUrl({ ...synced, sport_type: '' })).toBeNull();
  });

  it('gives null for a non-digit ID or code', () => {
    expect(corosActivityUrl({ ...synced, source_activity_id: 'demo_act_001' })).toBeNull();
    expect(corosActivityUrl({ ...synced, source_activity_id: '' })).toBeNull();
    expect(corosActivityUrl({ ...synced, sport_type: '20a' })).toBeNull();
    expect(corosActivityUrl({ ...synced, sport_type: ' 204' })).toBeNull();
    expect(corosActivityUrl({ ...synced, source_activity_id: '123&x=1' })).toBeNull();
  });
});
