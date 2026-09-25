// #157 AC1/AC2 — provenance is derived from `source` and `source_activity_id`
// alone (sync plan §8), and says so in words.

import { describe, it, expect } from 'vitest';
import {
  provenanceOf, provenanceMark, provenanceSpeech, provenanceDetail, sourceName, formatLocalStamp,
} from './provenance';

const manual = { source: '', source_activity_id: '', synced_at: '' };
const synced = { source: 'coros', source_activity_id: '472210938', synced_at: '2025-01-09T18:00:00.000Z' };
const enriched = { source: '', source_activity_id: '472198811', synced_at: '2025-01-08T15:02:37.000Z' };

describe('provenanceOf (§8 three states)', () => {
  it('reads a blank source with no activity id as manual', () => {
    expect(provenanceOf(manual)).toBe('manual');
  });
  it('reads any non-blank source as synced', () => {
    expect(provenanceOf(synced)).toBe('synced');
    expect(provenanceOf({ ...synced, source: 'garmin_import' })).toBe('synced');
  });
  it('reads a blank source with an activity id as enriched', () => {
    expect(provenanceOf(enriched)).toBe('enriched');
  });
  it('treats a source with no activity id as synced, not manual', () => {
    expect(provenanceOf({ source: 'coros', source_activity_id: '' })).toBe('synced');
  });
});

describe('AC1: the card mark', () => {
  it('names the source on a synced row', () => {
    expect(provenanceMark(synced)).toBe('COROS');
    expect(provenanceMark({ ...synced, source: 'garmin_import' })).toBe('Garmin');
  });
  it('falls back to "Synced" for a source this build does not know', () => {
    expect(sourceName('strava')).toBe('');
    expect(provenanceMark({ ...synced, source: 'strava' })).toBe('Synced');
  });
  it('reads "+ COROS" on an enriched row', () => {
    expect(provenanceMark(enriched)).toBe('+ COROS');
  });
  it('is absent on a manual row', () => {
    expect(provenanceMark(manual)).toBeNull();
  });
});

describe('AC1: the spoken form', () => {
  it('speaks each state, and nothing for manual', () => {
    expect(provenanceSpeech(synced)).toBe('synced from COROS');
    expect(provenanceSpeech({ ...synced, source: 'strava' })).toBe('synced');
    expect(provenanceSpeech(enriched)).toBe('logged by hand, enriched from COROS');
    expect(provenanceSpeech(manual)).toBe('');
  });
});

describe('formatLocalStamp', () => {
  it('renders an instant in local YYYY-MM-DD HH:mm', () => {
    const iso = '2025-01-09T18:00:00.000Z';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(formatLocalStamp(iso)).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  });
  it('is empty for a blank or unparseable value', () => {
    expect(formatLocalStamp('')).toBe('');
    expect(formatLocalStamp('not a date')).toBe('');
  });
});

describe('AC2: the detail line', () => {
  it('says synced from COROS with the last-synced time', () => {
    expect(provenanceDetail(synced)).toBe(
      `Synced from COROS · last synced ${formatLocalStamp(synced.synced_at)}`,
    );
  });
  // On an enriched row synced_at is "last enriched" (§7).
  it('says logged by hand, enriched from COROS, with the enrichment time', () => {
    expect(provenanceDetail(enriched)).toBe(
      `Logged by hand · enriched from COROS ${formatLocalStamp(enriched.synced_at)}`,
    );
  });
  it('drops only the time clause when synced_at is blank or unreadable', () => {
    expect(provenanceDetail({ ...synced, synced_at: '' })).toBe('Synced from COROS');
    expect(provenanceDetail({ ...enriched, synced_at: 'garbage' })).toBe('Logged by hand · enriched from COROS');
  });
  it('shows nothing for a manual row', () => {
    expect(provenanceDetail(manual)).toBeNull();
  });
});
