// #144 — almanac calls with a Google access token instead of the key, and may
// only read.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  loadApi, callEntry, workoutRow, exerciseRow, templateRow, setRow,
  type FetchReply, type LoadedApi,
} from './apps-script-sandbox';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const CLIENT_ID = 'almanac-1234.apps.googleusercontent.com';
const EMAIL = 'owner@example.com';
// Characters that URL-encode differently, so a leak of either spelling shows.
const TOKEN = 'ya29.a0Live/Token+Value=_with-chars';
const TOKEN_PROPS = { TOKEN_CLIENT_ID: CLIENT_ID, TOKEN_ALLOWED_EMAIL: EMAIL };

/** What tokeninfo says about a good almanac token, with `overrides` applied. */
function info(overrides: Record<string, unknown> = {}): FetchReply {
  const body: Record<string, unknown> = {
    azp: CLIENT_ID, aud: CLIENT_ID, sub: '1234567890', scope: 'openid email',
    exp: '1790000000', expires_in: '3599', email: EMAIL, email_verified: 'true',
    access_type: 'online', ...overrides,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return { status: 200, body: JSON.stringify(body) };
}

function load(
  tokeninfo: (url: string) => FetchReply = () => info(),
  properties: Record<string, string> = TOKEN_PROPS,
): LoadedApi {
  return loadApi(
    {
      workouts: [workoutRow()],
      exercises: [exerciseRow()],
      templates: [templateRow()],
      sets: [setRow({ weight: '185', reps: '6' })],
      dailySummary: [],
      dailyHealth: [],
      syncLog: [],
    },
    { properties, tokeninfo },
  );
}

const read = { action: 'getWorkouts' };
const tokenRead = { ...read, access_token: TOKEN };

/** The cache key the spec names: namespace + hex SHA-256 of token|client|email. */
function expectedCacheKey(token = TOKEN, clientId = CLIENT_ID, email = EMAIL): string {
  return 'thrive_tok:' + createHash('sha256').update(`${token}|${clientId}|${email}`, 'utf8').digest('hex');
}

describe('AC1: the credential decides the caller', () => {
  it('leaves a key caller exactly as it was: full access, no code, no fetch', () => {
    const api = load();
    const { res } = callEntry(api.sandbox, 'doGet', { ...read, key: 'test-key' });
    expect(res.success).toBe(true);
    expect(api.fetches).toEqual([]);

    const write = callEntry(api.sandbox, 'doGet', {
      action: 'createWorkout', key: 'test-key',
      payload: JSON.stringify({ data: { type: 'bike', name: 'Evening Ride' } }),
    });
    expect(write.res.success).toBe(true);
    expect(api.rows).toHaveLength(2);
  });

  it('refuses a wrong key as before, with no code on the envelope', () => {
    const { sandbox } = load();
    const { text } = callEntry(sandbox, 'doGet', { ...read, key: 'nope' });
    expect(text).toBe('{"success":false,"error":"Invalid or missing API key"}');
  });

  it('refuses a call with neither credential as before', () => {
    const { sandbox } = load();
    const { text } = callEntry(sandbox, 'doGet', read);
    expect(text).toBe('{"success":false,"error":"Invalid or missing API key"}');
  });

  it('makes a caller with both a token and the right key a token caller', () => {
    const api = load();
    const { res } = callEntry(api.sandbox, 'doGet', {
      action: 'createWorkout', key: 'test-key', access_token: TOKEN,
      payload: JSON.stringify({ data: { type: 'bike', name: 'Evening Ride' } }),
    });
    expect(res.code).toBe('read_only');
    expect(api.rows).toHaveLength(1);
    expect(api.fetches).toHaveLength(1);
  });

  it('never falls back to the key when the token is refused', () => {
    const api = load(() => ({ status: 400, body: '{"error":"invalid_token"}' }));
    const { res } = callEntry(api.sandbox, 'doGet', { ...tokenRead, key: 'test-key' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('token_invalid');
  });

  it('does not consult the key at all for a token caller', () => {
    const { sandbox } = load();
    const { res } = callEntry(sandbox, 'doGet', { ...tokenRead, key: 'wrong-key' });
    expect(res.success).toBe(true);
  });

  it('treats an empty access_token as a token caller, refused without a fetch', () => {
    const api = load();
    const { res } = callEntry(api.sandbox, 'doGet', { ...read, key: 'test-key', access_token: '' });
    expect(res.code).toBe('token_invalid');
    expect(api.fetches).toEqual([]);
  });
});

describe('AC2: verifying the token', () => {
  it('accepts a good token, asking tokeninfo with the token URL-encoded', () => {
    const api = load();
    const { res } = callEntry(api.sandbox, 'doPost', tokenRead);
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(api.fetches).toEqual([
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(TOKEN),
    ]);
  });

  describe('unset properties refuse every token call, before any fetch', () => {
    const cases: [string, Record<string, string>][] = [
      ['TOKEN_CLIENT_ID unset', { TOKEN_ALLOWED_EMAIL: EMAIL }],
      ['TOKEN_ALLOWED_EMAIL unset', { TOKEN_CLIENT_ID: CLIENT_ID }],
      ['both unset', {}],
      ['TOKEN_CLIENT_ID blank', { TOKEN_CLIENT_ID: '  ', TOKEN_ALLOWED_EMAIL: EMAIL }],
    ];
    for (const [name, props] of cases) {
      it(name, () => {
        const api = load(() => info(), props);
        const { res } = callEntry(api.sandbox, 'doGet', tokenRead);
        expect(res.success).toBe(false);
        expect(res.code).toBe('token_forbidden');
        expect(res.error).toMatch(/TOKEN_CLIENT_ID and TOKEN_ALLOWED_EMAIL must both be set/);
        expect(api.fetches).toEqual([]);
        expect(api.cache.size).toBe(0);

        // ...and a key caller is unaffected.
        expect(callEntry(api.sandbox, 'doGet', { ...read, key: 'test-key' }).res.success).toBe(true);
      });
    }
  });

  const refusals: [string, FetchReply, string][] = [
    ['tokeninfo answers 400', { status: 400, body: '{"error":"invalid_token"}' }, 'token_invalid'],
    ['tokeninfo answers 401', { status: 401, body: '' }, 'token_invalid'],
    ['the body is not JSON', { status: 200, body: '<html>' }, 'token_invalid'],
    ['the body is not an object', { status: 200, body: '[1,2]' }, 'token_invalid'],
    ['aud is another client', info({ aud: 'other.apps.googleusercontent.com' }), 'token_forbidden'],
    ['aud is missing', info({ aud: undefined }), 'token_forbidden'],
    ['azp is another client', info({ azp: 'other.apps.googleusercontent.com' }), 'token_forbidden'],
    ['email is another account', info({ email: 'someone@example.com' }), 'token_forbidden'],
    ['email is missing', info({ email: undefined }), 'token_forbidden'],
    ['email_verified is "false"', info({ email_verified: 'false' }), 'token_forbidden'],
    ['email_verified is missing', info({ email_verified: undefined }), 'token_forbidden'],
    ['expires_in is "0"', info({ expires_in: '0' }), 'token_invalid'],
    ['expires_in is missing', info({ expires_in: undefined }), 'token_invalid'],
    ['expires_in is not a number', info({ expires_in: 'soon' }), 'token_invalid'],
    ['expires_in is negative', info({ expires_in: -5 }), 'token_invalid'],
    ['tokeninfo answers 500', { status: 500, body: 'oops' }, 'token_unavailable'],
    ['tokeninfo answers 429', { status: 429, body: 'slow down' }, 'token_unavailable'],
    ['tokeninfo is unreachable', { throws: 'Address unavailable' }, 'token_unavailable'],
  ];
  for (const [name, reply, code] of refusals) {
    it(`refuses as ${code} when ${name}`, () => {
      const api = load(() => reply);
      const { res } = callEntry(api.sandbox, 'doPost', tokenRead);
      expect(res.success).toBe(false);
      expect(res.code).toBe(code);
      expect(res.data).toBeUndefined();
      expect(typeof res.error).toBe('string');
    });
  }

  // Until the owner re-authorizes for script.external_request, every fetch
  // throws this. It is the owner's to fix, so it is token_forbidden, not an
  // outage, and it is never cached.
  it('refuses as token_forbidden, uncached, when the script lacks the fetch scope', () => {
    const api = load(() => ({
      throws: 'Exception: You do not have permission to call UrlFetchApp.fetch. Required ' +
        'permissions: https://www.googleapis.com/auth/script.external_request',
    }));
    const { res } = callEntry(api.sandbox, 'doPost', tokenRead);
    expect(res.code).toBe('token_forbidden');
    expect(res.error).toMatch(/owner must re-authorize/);
    callEntry(api.sandbox, 'doPost', tokenRead);
    expect(api.cache.size).toBe(0);
    expect(api.fetches).toHaveLength(2);
  });

  it('accepts a token with no azp', () => {
    const { sandbox } = load(() => info({ azp: undefined }));
    expect(callEntry(sandbox, 'doGet', tokenRead).res.success).toBe(true);
  });

  it('compares the email trimmed and lowercased on both sides', () => {
    const { sandbox } = load(
      () => info({ email: ' Owner@Example.COM ' }),
      { TOKEN_CLIENT_ID: CLIENT_ID, TOKEN_ALLOWED_EMAIL: '  OWNER@example.com ' },
    );
    expect(callEntry(sandbox, 'doGet', tokenRead).res.success).toBe(true);
  });

  it('accepts email_verified as a boolean true too', () => {
    const { sandbox } = load(() => info({ email_verified: true }));
    expect(callEntry(sandbox, 'doGet', tokenRead).res.success).toBe(true);
  });

  it('matches aud exactly, not case-insensitively', () => {
    const { sandbox } = load(() => info({ aud: CLIENT_ID.toUpperCase(), azp: undefined }));
    expect(callEntry(sandbox, 'doGet', tokenRead).res.code).toBe('token_forbidden');
  });
});

describe('AC3: the verdict is cached under a hash', () => {
  it('verifies once, then answers from the cache with no second fetch', () => {
    const api = load();
    expect(callEntry(api.sandbox, 'doGet', tokenRead).res.success).toBe(true);
    expect(callEntry(api.sandbox, 'doPost', tokenRead).res.success).toBe(true);
    expect(callEntry(api.sandbox, 'doGet', { action: 'getTemplates', access_token: TOKEN }).res.success).toBe(true);
    expect(api.fetches).toHaveLength(1);
  });

  it('keys the verdict by SHA-256 of token|client|email, and stores only the verdict', () => {
    const api = load();
    callEntry(api.sandbox, 'doGet', tokenRead);
    expect([...api.cache.keys()]).toEqual([expectedCacheKey()]);
    expect(api.cache.get(expectedCacheKey())).toEqual({ value: 'ok', ttl: 3599 - 60 });
  });

  it('folds the properties into the key, so correcting one invalidates the verdict', () => {
    expect(expectedCacheKey(TOKEN, CLIENT_ID, EMAIL))
      .not.toBe(expectedCacheKey(TOKEN, 'other.apps.googleusercontent.com', EMAIL));
    expect(expectedCacheKey(TOKEN, CLIENT_ID, EMAIL))
      .not.toBe(expectedCacheKey(TOKEN, CLIENT_ID, 'someone@example.com'));
  });

  it('caps an acceptance at an hour', () => {
    const api = load(() => info({ expires_in: '7200' }));
    callEntry(api.sandbox, 'doGet', tokenRead);
    expect(api.cache.get(expectedCacheKey())?.ttl).toBe(3600);
  });

  for (const expiresIn of ['60', '30']) {
    it(`accepts but does not cache a token with ${expiresIn}s left`, () => {
      const api = load(() => info({ expires_in: expiresIn }));
      expect(callEntry(api.sandbox, 'doGet', tokenRead).res.success).toBe(true);
      expect(api.cache.size).toBe(0);
      callEntry(api.sandbox, 'doGet', tokenRead);
      expect(api.fetches).toHaveLength(2);
    });
  }

  for (const [reply, code] of [
    [{ status: 400, body: '{"error":"invalid_token"}' }, 'token_invalid'],
    [info({ email: 'someone@example.com' }), 'token_forbidden'],
  ] as [FetchReply, string][]) {
    it(`remembers a ${code} refusal for five minutes, and says ${code} again from the cache`, () => {
      const api = load(() => reply);
      const first = callEntry(api.sandbox, 'doGet', tokenRead);
      expect(api.cache.get(expectedCacheKey())).toEqual({ value: code, ttl: 300 });
      const second = callEntry(api.sandbox, 'doGet', tokenRead);
      expect(api.fetches).toHaveLength(1);
      expect(second.text).toBe(first.text);
    });
  }

  it('never caches token_unavailable', () => {
    const api = load(() => ({ throws: 'Address unavailable' }));
    callEntry(api.sandbox, 'doGet', tokenRead);
    callEntry(api.sandbox, 'doGet', tokenRead);
    expect(api.cache.size).toBe(0);
    expect(api.fetches).toHaveLength(2);
  });

  it('keeps separate verdicts for separate tokens', () => {
    const api = load((url) => (url.includes('good') ? info() : { status: 400, body: '{}' }));
    expect(callEntry(api.sandbox, 'doGet', { ...read, access_token: 'good-token' }).res.success).toBe(true);
    expect(callEntry(api.sandbox, 'doGet', { ...read, access_token: 'bad-token' }).res.code).toBe('token_invalid');
    expect(callEntry(api.sandbox, 'doGet', { ...read, access_token: 'good-token' }).res.success).toBe(true);
    expect(api.fetches).toHaveLength(2);
  });
});

describe('AC3: the token goes nowhere', () => {
  const spellings = [TOKEN, encodeURIComponent(TOKEN)];

  const scenarios: [string, (url: string) => FetchReply, Record<string, string>][] = [
    ['an accepted read', () => info(), tokenRead],
    ['an invalid token', () => ({ status: 400, body: '{"error":"invalid_token"}' }), tokenRead],
    ['a forbidden token', () => info({ aud: 'other' }), tokenRead],
    // UrlFetchApp's real message quotes the URL it failed on.
    ['an unreachable tokeninfo whose error quotes the URL',
      (url) => ({ throws: 'Address unavailable: ' + url }), tokenRead],
    ['a 500 from tokeninfo', () => ({ status: 500, body: TOKEN }), tokenRead],
    ['a write refused as read_only', () => info(), { action: 'createWorkout', access_token: TOKEN }],
    ['a read that throws', () => info(), { action: 'getWorkouts', type: 'swimming', access_token: TOKEN }],
    ['a read that echoes a parameter', () => info(), { action: 'getWorkout', id: TOKEN, access_token: TOKEN }],
  ];

  for (const [name, reply, params] of scenarios) {
    it(`is in no response or cache entry after ${name}`, () => {
      for (const entry of ['doGet', 'doPost'] as const) {
        const api = load(reply);
        const { text } = callEntry(api.sandbox, entry, params);
        for (const s of spellings) {
          expect(text).not.toContain(s);
          for (const [key, value] of api.cache) {
            expect(key).not.toContain(s);
            expect(value.value).not.toContain(s);
          }
        }
      }
    });
  }

  it('is never logged: the auth and dispatch sources contain no logging at all', () => {
    for (const file of ['auth.js', 'main.js']) {
      const text = readFileSync(path.join(SRC, file), 'utf8');
      expect(text, file).not.toMatch(/\b(Logger|console)\s*\./);
    }
  });
});

// Every `case` in the dispatcher, classified. A new action fails the last test
// below until someone decides which list it belongs on.
const KEY_ONLY_ACTIONS = [
  'createWorkout', 'updateWorkout', 'deleteWorkout',
  'createExercise', 'updateExercise', 'deleteExercise',
  'createTemplate', 'replaceTemplate',
  'appendSets', 'previewSetUpdates', 'updateSets',
  'rebuildDailySummary', 'upsertDailyHealth', 'upsertSyncedWorkout', 'enrichWorkout',
  'appendSyncLog', 'upsertBodyMeasurements',
  // A read, but key-only (#179): no token caller needs raw vendor text.
  'getWorkoutPayload',
];

const READ_PARAMS: Record<string, Record<string, string>> = {
  getWorkouts: {}, getWorkout: { id: 'w_001' }, getPlannedWorkouts: { date: '2026-09-15' },
  getExercises: {}, getExercise: { ref: 'ex_001' }, getExerciseHistory: { ref: 'ex_001' },
  getTemplates: {}, getTemplate: { ref: 'tpl_001' },
  getSets: { workout_id: 'w_001' }, getWorkoutSets: { workout_id: 'w_001' },
  getDailySummary: { from: '2026-09-01', to: '2026-09-30' }, getHistoryDateRange: {},
  getDailyHealth: { from: '2026-09-01', to: '2026-09-30' }, getSyncLog: { limit: '1' },
  getBodyMeasurements: { from: '2026-09-01', to: '2026-09-30' },
};

describe('AC4: token callers run only the named reads', () => {
  it('names exactly the reads', () => {
    const { sandbox } = load();
    expect([...sandbox.TOKEN_READ_ACTIONS].sort()).toEqual(Object.keys(READ_PARAMS).sort());
  });

  for (const [action, params] of Object.entries(READ_PARAMS)) {
    it(`runs ${action} for a token caller exactly as for a key caller`, () => {
      const asKey = callEntry(load().sandbox, 'doGet', { action, key: 'test-key', ...params });
      const asToken = callEntry(load().sandbox, 'doPost', { action, access_token: TOKEN, ...params });
      expect(asKey.res.success, asKey.text).toBe(true);
      expect(asToken.text).toBe(asKey.text);
    });
  }

  const WRITE_PAYLOADS: Record<string, unknown> = {
    createWorkout: { data: { type: 'bike', name: 'Evening Ride' } },
    updateWorkout: { id: 'w_001', changes: { name: 'Renamed' } },
    deleteWorkout: { id: 'w_001' },
    createExercise: { data: { name: 'Squat' } },
    updateExercise: { id: 'ex_001', changes: { name: 'Flat Bench' } },
    deleteExercise: { id: 'ex_001' },
    createTemplate: { data: { name: 'New', exercises: [] } },
    replaceTemplate: { template_id: 'tpl_001', data: { name: 'Upper Push A', exercises: [] } },
    appendSets: { sets: [{ workout_id: 'w_001', exercise_id: 'ex_001', set_number: 2 }] },
    previewSetUpdates: { workout_id: 'w_001', updates: [{ exercise: 'Bench Press', set_number: 1, reps: '8' }] },
    updateSets: { workout_id: 'w_001', updates: [{ exercise: 'Bench Press', set_number: 1, reps: '8' }] },
    rebuildDailySummary: { from: '2026-09-15', to: '2026-09-15' },
    upsertDailyHealth: { rows: [{ date: '2026-09-15', steps: '100' }], synced_at: '2026-09-15T00:00:00Z' },
    upsertSyncedWorkout: { incoming: { date: '2026-09-15', type: 'bike', name: 'Ride' }, last_written: null },
    enrichWorkout: { activity: { date: '2026-09-15' }, last_written: null },
    appendSyncLog: { row: { run_id: 'r1', status: 'ok' } },
    upsertBodyMeasurements: {
      rows: [{ grpid: '1', date: '2026-09-15', time: '07:00', measured_at_utc: '2026-09-15T07:00:00-06:00',
        kind: 'scale', weight_kg: '80', source: 'withings' }],
      synced_at: '2026-09-15T00:00:00Z',
    },
    getWorkoutPayload: {},
  };

  for (const action of KEY_ONLY_ACTIONS) {
    it(`refuses ${action} to a token caller, and it does not run`, () => {
      const api = load();
      const before = JSON.stringify([api.rows, api.exerciseRows, api.templateRows, api.setRows,
        api.summaryRows, api.healthRows, api.syncLogRows]);
      let ran = false;
      // previewSetUpdates writes nothing, so a snapshot cannot tell whether it ran.
      api.sandbox.previewSetUpdates = () => { ran = true; return []; };

      const { text } = callEntry(api.sandbox, 'doPost', {
        action, access_token: TOKEN, payload: JSON.stringify(WRITE_PAYLOADS[action]),
      });
      expect(JSON.parse(text)).toEqual({
        success: false, code: 'read_only',
        error: `Read-only caller: action "${action}" is not permitted`,
      });
      expect(JSON.stringify([api.rows, api.exerciseRows, api.templateRows, api.setRows,
        api.summaryRows, api.healthRows, api.syncLogRows])).toBe(before);
      expect(api.lock.acquired).toBe(0);
      expect(ran).toBe(false);
      expect(api.driveCalls).toEqual([]);
    });
  }

  it('refuses an unknown action to a token caller as read_only, not as unknown', () => {
    const { sandbox } = load();
    const { res } = callEntry(sandbox, 'doGet', { action: 'dropEverything', access_token: TOKEN });
    expect(res.code).toBe('read_only');
    expect(res.error).toBe('Read-only caller: action "dropEverything" is not permitted');
  });

  it('refuses a missing action to a token caller', () => {
    const { sandbox } = load();
    const { res } = callEntry(sandbox, 'doGet', { access_token: TOKEN });
    expect(res.code).toBe('read_only');
  });

  it('verifies the token before the allow-list: a bad token on a write says token_invalid', () => {
    const api = load(() => ({ status: 400, body: '{}' }));
    const { res } = callEntry(api.sandbox, 'doGet', { action: 'createWorkout', access_token: TOKEN });
    expect(res.code).toBe('token_invalid');
  });

  it('classifies every action in the dispatcher as a read or key-only', () => {
    const main = readFileSync(path.join(SRC, 'main.js'), 'utf8');
    const cases = [...main.matchAll(/^\s*case '(\w+)':/gm)].map((m) => m[1]).sort();
    const { sandbox } = load();
    const reads: string[] = [...sandbox.TOKEN_READ_ACTIONS];
    expect(reads.filter((a) => KEY_ONLY_ACTIONS.includes(a))).toEqual([]);
    expect(cases).toEqual([...reads, ...KEY_ONLY_ACTIONS].sort());
  });
});

describe('AC5: a form-encoded POST behaves exactly like a GET', () => {
  const calls: Record<string, string>[] = [
    { action: 'getWorkouts', key: 'test-key' },
    { action: 'getWorkout', key: 'test-key' },
    { action: 'getWorkouts', key: 'wrong' },
    { action: 'noSuchAction', key: 'test-key' },
    { action: 'getWorkouts', access_token: TOKEN },
    { action: 'appendSets', access_token: TOKEN },
  ];
  for (const params of calls) {
    it(`answers ${JSON.stringify({ ...params, access_token: params.access_token && '…' })} identically`, () => {
      const viaGet = callEntry(load().sandbox, 'doGet', params);
      const viaPost = callEntry(load().sandbox, 'doPost', params);
      expect(viaPost.text).toBe(viaGet.text);
    });
  }

  it('writes through POST for a key caller, as through GET', () => {
    const api = load();
    const { res } = callEntry(api.sandbox, 'doPost', {
      action: 'createWorkout', key: 'test-key',
      payload: JSON.stringify({ data: { type: 'hike', name: 'Morning Hike' } }),
    });
    expect(res.success).toBe(true);
    expect(api.rows).toHaveLength(2);
  });

  it('answers a POST with no parameters in the envelope, not a crash', () => {
    const { sandbox } = load();
    const res = JSON.parse(sandbox.doPost({}).getContent());
    expect(res).toEqual({ success: false, error: 'Invalid or missing API key' });
  });
});
