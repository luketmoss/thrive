// #314 AC1 — the SyncRequests layout mirrors apps-script/src/types.js
// (CLAUDE.md: change both together). This test is what notices when only one
// side changed: the field, status and vendor lists, name for name, in order.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  SYNC_REQUEST_FIELDS, SYNC_REQUEST_STATUSES, SYNC_REQUEST_VENDORS, rowToSyncRequest,
} from './sync-requests-api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typesJs = readFileSync(resolve(__dirname, '../../../apps-script/src/types.js'), 'utf-8');

/** The quoted names in `var <name> = [ ... ];` in types.js. */
function declared(name: string): string[] {
  const block = typesJs.match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`))?.[1];
  expect(block, `${name} not found in types.js`).toBeTruthy();
  return Array.from(block!.matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

describe('SyncRequests mirrors types.js', () => {
  it('SYNC_REQUEST_FIELDS matches, in order (A:I)', () => {
    expect([...SYNC_REQUEST_FIELDS]).toEqual(declared('SYNC_REQUEST_FIELDS'));
    expect(SYNC_REQUEST_FIELDS).toHaveLength(9);
  });

  it('SYNC_REQUEST_STATUSES matches, in order', () => {
    expect([...SYNC_REQUEST_STATUSES]).toEqual(declared('SYNC_REQUEST_STATUSES'));
  });

  it('SYNC_REQUEST_VENDORS matches, in order', () => {
    expect([...SYNC_REQUEST_VENDORS]).toEqual(declared('SYNC_REQUEST_VENDORS'));
  });

  it('types.js declares the column count to match', () => {
    expect(typesJs).toMatch(/var SYNC_REQUEST_COLUMN_COUNT = 9;/);
  });
});

describe('rowToSyncRequest', () => {
  it('maps a full row by position', () => {
    const r = rowToSyncRequest([
      'sr_1a2b3c4d', 'coros', '2026-10-02T13:28:00.000Z', 'me@example.com', 'started',
      '987654', '2026-10-02T13:30:00.000Z', '', '',
    ], 4);
    expect(r).toEqual({
      request_id: 'sr_1a2b3c4d', vendor: 'coros', requested_at: '2026-10-02T13:28:00.000Z',
      requested_by: 'me@example.com', status: 'started', workflow_run_id: '987654',
      dispatched_at: '2026-10-02T13:30:00.000Z', finished_at: '', detail: '', sheetRow: 4,
    });
  });

  it("gives '' for a missing cell (a short row), never undefined", () => {
    const r = rowToSyncRequest(['sr_1', 'withings', '2026-10-02T13:28:00.000Z', '', 'requested'], 2);
    expect(r.workflow_run_id).toBe('');
    expect(r.detail).toBe('');
    for (const f of SYNC_REQUEST_FIELDS) expect(typeof r[f]).toBe('string');
  });

  it('keeps values exactly as read', () => {
    expect(rowToSyncRequest([' sr_1 ', 'COROS'], 2)).toMatchObject({ request_id: ' sr_1 ', vendor: 'COROS' });
  });
});
