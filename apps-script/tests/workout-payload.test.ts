// #179 — a synced activity's archived COROS payload, read by workout id.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, callEntry, workoutRow, type DriveNode, type CellValue } from './apps-script-sandbox';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const ACTIVITY = '480573149960765546';
const FILE = '1_xRMVWN4-EFUZ6RxfZRRGOfb-5wJpM4r';
const PROSE = '🚴 Gravel Bike Activity Details\n====\n\nWorkout Time: 1:02:03\nMax Heart Rate: 161 bpm';
const SECRET = 'refresh-token-value-that-must-never-leave';

/** The archive record as the sync writes it (sync/src/archive.mjs). */
function record(overrides: Record<string, unknown> = {}) {
  return {
    source: 'coros',
    activity_id: ACTIVITY,
    tool: 'getActivityDetail',
    args: { labelId: ACTIVITY, sportType: 203 },
    list_entry: { text: 'Start Coordinates: 39.861002, -105.212004' },
    // COROS's text byte for byte: a JSON string literal.
    payload: JSON.stringify(PROSE),
    payload_hash: 'abc',
    fetched_at: '2026-09-24T17:41:08.114Z',
    normalized: { avg_hr: '140' },
    fit: { status: 'stored' },
    ...overrides,
  };
}

/** `Thrive COROS/activities/2026/09/<file>`, plus the token file beside the root. */
function drive(fileOverrides: Partial<DriveNode> = {}, content: unknown = record()): Record<string, DriveNode> {
  return {
    root: { name: 'Thrive COROS', parents: ['myDrive'] },
    myDrive: { name: 'My Drive', parents: [] },
    acts: { name: 'activities', parents: ['root'] },
    y2026: { name: '2026', parents: ['acts'] },
    m09: { name: '09', parents: ['y2026'] },
    [FILE]: {
      name: `${ACTIVITY}.json`,
      parents: ['m09'],
      content: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
      ...fileOverrides,
    },
    tokenFile: { name: 'coros-token.json', parents: ['root'], content: JSON.stringify({ refresh_token: SECRET }) },
  };
}

function synced(overrides: Record<string, CellValue> = {}) {
  return workoutRow({
    id: 'w_ride', type: 'bike', name: 'Gravel Bike', source: 'coros',
    source_activity_id: ACTIVITY, raw_ref: FILE, ...overrides,
  });
}

type Page = {
  workout_id: string; source_activity_id: string; raw_ref: string; tool: string; fetched_at: string;
  text: string; offset: number; total_chars: number; next_offset: number | null;
};

function read(rows: CellValue[][], nodes: Record<string, DriveNode>, params: Record<string, string> = {}, driveFails?: string) {
  const api = loadApi(rows, { drive: nodes, driveFails });
  const res = callDoGet<Page>(api.sandbox, { action: 'getWorkoutPayload', id: 'w_ride', ...params });
  return { api, res };
}

const NOT_ARCHIVE = 'raw_ref on this workout does not name its COROS archive file, so nothing was read from it. ' +
  'The next sync run rewrites raw_ref.';

describe('AC1: a key caller reads the archived payload by workout id', () => {
  it('returns the prose, decoded from its JSON quoting, with the row and file identifiers', () => {
    const { res, api } = read([synced()], drive());
    expect(res.success, res.error).toBe(true);
    expect(res.data).toEqual({
      workout_id: 'w_ride', source_activity_id: ACTIVITY, raw_ref: FILE,
      tool: 'getActivityDetail', fetched_at: '2026-09-24T17:41:08.114Z',
      text: PROSE, offset: 0, total_chars: PROSE.length, next_offset: null,
    });
    expect(api.driveCalls).toEqual([FILE]);
  });

  it('returns nothing else from the file: not normalized, fit, args, hash or the list entry', () => {
    const { res } = read([synced()], drive());
    const body = JSON.stringify(res);
    for (const leaked of ['normalized', 'fit"', 'args', 'payload_hash', 'list_entry', '39.861002']) {
      expect(body).not.toContain(leaked);
    }
  });

  it('reads an enriched hand-logged row the same way (source blank, link fields set)', () => {
    const { res } = read([synced({ type: 'weight', source: '' })], drive());
    expect(res.success, res.error).toBe(true);
    expect(res.data.text).toBe(PROSE);
  });

  it('returns a payload that is not a JSON string literal exactly as stored', () => {
    const { res } = read([synced()], drive({}, record({ payload: 'plain prose, not quoted' })));
    expect(res.data.text).toBe('plain prose, not quoted');
    const obj = read([synced()], drive({}, record({ payload: '{"a":1}' })));
    expect(obj.res.data.text).toBe('{"a":1}');
  });

  it('takes no Drive ID from the caller: a raw_ref or file_id parameter is ignored', () => {
    const { res, api } = read([synced()], drive(), { raw_ref: 'tokenFile', file_id: 'tokenFile' });
    expect(res.success).toBe(true);
    expect(api.driveCalls).toEqual([FILE]);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});

describe('AC2: only the row\'s own archive file can be read', () => {
  const noDrive = [
    ['no id', {}, 'id parameter required', { id: '' }],
    ['an unknown workout', {}, 'Workout "w_nope" not found', { id: 'w_nope' }],
    ['a blank raw_ref', { raw_ref: '' }, 'Workout "w_ride" has no archived COROS payload (raw_ref is blank)', {}],
    ['a blank source_activity_id', { source_activity_id: '' }, 'has a raw_ref but no source_activity_id', {}],
  ] as const;

  for (const [label, row, message, params] of noDrive) {
    it(`refuses ${label} without a Drive call`, () => {
      const { res, api } = read([synced(row)], drive(), params);
      expect(res.success).toBe(false);
      expect(res.error).toContain(message);
      expect(api.driveCalls).toEqual([]);
    });
  }

  const notArchive: [string, CellValue[], Record<string, DriveNode>][] = [
    ['a missing file', synced({ raw_ref: 'gone' }), drive()],
    ['a trashed file', synced(), drive({ trashed: true })],
    ['a file with another name', synced(), drive({ name: 'something.json' })],
    ['a file over 5 MB', synced(), drive({}, record({ payload: JSON.stringify('x'.repeat(5 * 1024 * 1024)) }))],
    ['a file outside the month folder', synced(), drive({ parents: ['acts'] })],
    ['a file with two parents', synced(), drive({ parents: ['m09', 'y2026'] })],
    ['a file under health/ instead of activities/', synced(), (() => {
      const d = drive(); d.acts.name = 'health'; return d;
    })()],
    ['a file under another root folder', synced(), (() => {
      const d = drive(); d.root.name = 'Somewhere Else'; return d;
    })()],
    ['a file that is not JSON', synced(), drive({}, 'not json at all')],
    ['a file for another activity', synced(), drive({}, record({ activity_id: '999' }))],
    ['a file from another source', synced(), drive({}, record({ source: 'garmin' }))],
    ['a file with no string payload', synced(), drive({}, record({ payload: { a: 1 } }))],
    ['a JSON array', synced(), drive({}, '[1,2]')],
  ];

  for (const [label, row, nodes] of notArchive) {
    it(`refuses ${label} with the one fixed message`, () => {
      const { res } = read([row], nodes);
      expect(res).toEqual({ success: false, error: NOT_ARCHIVE });
    });
  }

  it('refuses a raw_ref pointed at the token file, and never returns a byte of it', () => {
    // updateWorkout can write raw_ref and source_activity_id, so a key caller
    // could aim a row at coros-token.json. Name, place and content all refuse.
    const row = synced({ raw_ref: 'tokenFile', source_activity_id: 'coros-token' });
    const { res, api } = read([row], drive());
    expect(res).toEqual({ success: false, error: NOT_ARCHIVE });
    expect(JSON.stringify(res)).not.toContain(SECRET);
    expect(api.driveCalls).toEqual(['tokenFile']);
  });

  it('refuses a file that passes name and place but whose content is another file\'s', () => {
    const nodes = drive({}, { refresh_token: SECRET });
    const { res } = read([synced()], nodes);
    expect(res).toEqual({ success: false, error: NOT_ARCHIVE });
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('says the owner must re-authorize when Drive refuses for want of the scope', () => {
    const { res } = read([synced()], drive(), {},
      'You do not have permission to call DriveApp.getFileById. Required permissions: ' +
      'https://www.googleapis.com/auth/drive.readonly');
    expect(res.success).toBe(false);
    expect(res.error).toBe(
      'The script is not yet allowed to read Drive: its owner must re-authorize it for the ' +
      'drive.readonly scope (apps-script/README.md, "Setup").');
  });

  it('does not mistake a missing file ("...or you do not have permission to access it") for a missing scope', () => {
    const { res } = read([synced({ raw_ref: 'gone' })], drive());
    expect(res.error).toBe(NOT_ARCHIVE);
  });

  it('refuses a token caller as read_only before the action runs', () => {
    const api = loadApi([synced()], {
      drive: drive(),
      properties: { TOKEN_CLIENT_ID: 'c', TOKEN_ALLOWED_EMAIL: 'e@example.com' },
      tokeninfo: () => ({
        status: 200,
        body: JSON.stringify({ aud: 'c', azp: 'c', email: 'e@example.com', email_verified: 'true', expires_in: '3599' }),
      }),
    });
    const { res } = callEntry(api.sandbox, 'doPost', { action: 'getWorkoutPayload', id: 'w_ride', access_token: 'tok' });
    expect(res).toEqual({
      success: false, code: 'read_only',
      error: 'Read-only caller: action "getWorkoutPayload" is not permitted',
    });
    expect(api.driveCalls).toEqual([]);
  });
});

describe('AC3: paged deliberately, never truncated silently', () => {
  const long = '🚴' + 'a'.repeat(19_997) + '🚴' + 'b'.repeat(25_000);

  it('returns 20,000 characters and the offset to continue from', () => {
    const { res } = read([synced()], drive({}, record({ payload: JSON.stringify('x'.repeat(45_000)) })));
    expect(res.data.text).toHaveLength(20_000);
    expect(res.data).toMatchObject({ offset: 0, total_chars: 45_000, next_offset: 20_000 });

    const last = read([synced()], drive({}, record({ payload: JSON.stringify('x'.repeat(45_000)) })), { offset: '40000' });
    expect(last.res.data).toMatchObject({ offset: 40_000, total_chars: 45_000, next_offset: null });
    expect(last.res.data.text).toHaveLength(5_000);
  });

  it('reassembles to the whole text, and no page ends inside a surrogate pair', () => {
    const nodes = drive({}, record({ payload: JSON.stringify(long) }));
    let offset: number | null = 0;
    let whole = '';
    while (offset !== null) {
      const { res } = read([synced()], nodes, { offset: String(offset) });
      const code = res.data.text.charCodeAt(res.data.text.length - 1);
      expect(code >= 0xd800 && code <= 0xdbff, `page at ${offset} ends on a high surrogate`).toBe(false);
      whole += res.data.text;
      offset = res.data.next_offset;
    }
    expect(whole).toBe(long);
  });

  it('pages an exactly-full payload as complete', () => {
    const { res } = read([synced()], drive({}, record({ payload: JSON.stringify('y'.repeat(20_000)) })));
    expect(res.data.next_offset).toBeNull();
  });

  for (const bad of ['-1', '1.5', 'ten', '1e3']) {
    it(`refuses offset "${bad}"`, () => {
      const { res } = read([synced()], drive(), { offset: bad });
      expect(res).toEqual({ success: false, error: 'offset must be a whole number of characters (0 or more)' });
    });
  }

  it('refuses an offset past the end, naming the length', () => {
    const { res } = read([synced()], drive(), { offset: String(PROSE.length) });
    expect(res.success).toBe(false);
    expect(res.error).toBe(`offset ${PROSE.length} is past the end: the payload is ${PROSE.length} characters.`);
  });
});

describe('AC5: scope and logging', () => {
  it('pins exactly the three scopes, drive.readonly the only Drive one', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
    expect(manifest.oauthScopes).toEqual([
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/drive.readonly',
    ]);
    expect(manifest.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  });

  it('never logs: payload.js contains no logging at all', () => {
    const text = readFileSync(path.join(SRC, 'payload.js'), 'utf8');
    expect(text).not.toMatch(/\b(Logger|console)\s*\./);
  });

  it('uses only read methods of DriveApp', () => {
    const text = readFileSync(path.join(SRC, 'payload.js'), 'utf8');
    expect(text).not.toMatch(/\.(setContent|setName|setTrashed|createFile|createFolder|moveTo|addEditor|setSharing|removeFile)\s*\(/);
  });
});
