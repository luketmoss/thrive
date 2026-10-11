// #410 — requestSync: Sync now dispatches the rows the SPA just appended in the
// same request, through the poller's own per-vendor step and lock. Fakes only:
// no network, no live Apps Script, the clock fixed.

import { describe, it, expect } from 'vitest';
import {
  loadSources, makeSheet, makeUtilities, makeLockService, makePropertiesService,
  makeContentService, makeCacheService, type CellValue, type FetchReply, type CacheEntry,
} from './apps-script-sandbox';

// Characters that URL-encode differently, so a leak of either spelling shows.
const GH_TOKEN = 'github_pat_SENTINEL/410+Token=_value';
const ACCESS_TOKEN = 'ya29.a0SPA/Access+Token=_410';
const GH_BODY = 'GITHUB_BODY_SENTINEL_410';
const CLIENT_ID = 'spa-410.apps.googleusercontent.com';
const EMAIL = 'owner@example.com';

const NOW = new Date('2026-10-02T19:00:00.000Z'); // 1:00 PM MDT, outside every schedule slot
const minutesAgo = (n: number, now = NOW) => new Date(now.getTime() - n * 60_000).toISOString();

const REQUEST_ORDER = [
  'request_id', 'vendor', 'requested_at', 'requested_by', 'status',
  'workflow_run_id', 'dispatched_at', 'finished_at', 'detail',
];

const COROS_ID = 'sr_0000c0c0';
const WITHINGS_ID = 'sr_0000a1a1';

function req(overrides: Record<string, string> = {}, now = NOW): CellValue[] {
  const f: Record<string, string> = {
    request_id: COROS_ID, vendor: 'coros', requested_at: minutesAgo(0.1, now),
    requested_by: EMAIL, status: 'requested', ...overrides,
  };
  return REQUEST_ORDER.map((k) => f[k] ?? '');
}

function logRow(runId: string, startedAt: string, status = 'ok'): CellValue[] {
  const row: CellValue[] = new Array(14).fill('');
  row[0] = runId;
  row[1] = startedAt;
  row[2] = startedAt;
  row[11] = status;
  return row;
}

interface Fetch {
  url: string;
  method: string;
  headers: Record<string, string>;
  payload?: string;
  options: Record<string, unknown>;
}

function tokeninfo(overrides: Record<string, unknown> = {}): FetchReply {
  return {
    status: 200,
    body: JSON.stringify({
      aud: CLIENT_ID, azp: CLIENT_ID, email: EMAIL, email_verified: 'true', expires_in: '3599', ...overrides,
    }),
  };
}

const dispatchOk: FetchReply = { status: 200, body: JSON.stringify({ workflow_run_id: 987654 }) };
const runInProgress: FetchReply = { status: 200, body: JSON.stringify({ status: 'in_progress', conclusion: null }) };

function harness(opts: {
  requests?: CellValue[][] | null;
  syncLog?: CellValue[][];
  withingsLog?: CellValue[][];
  ghToken?: string | null;
  dispatch?: FetchReply;
  run?: FetchReply;
  info?: FetchReply;
  lockHeld?: boolean;
  now?: Date;
  requestsThrow?: string;
} = {}) {
  const requests = opts.requests === undefined ? [] : opts.requests;
  const fetches: Fetch[] = [];
  const logs: string[] = [];
  const tabReads: string[] = [];
  const lock = { acquired: 0, held: !!opts.lockHeld, tryWaits: [] as number[] };
  const cache = new Map<string, CacheEntry>();
  const properties: Record<string, string> = {
    API_KEY: 'test-key', SPREADSHEET_ID: 'sheet-id',
    TOKEN_CLIENT_ID: CLIENT_ID, TOKEN_ALLOWED_EMAIL: EMAIL,
  };
  if (opts.ghToken !== null) properties.GITHUB_DISPATCH_TOKEN = opts.ghToken ?? GH_TOKEN;

  const tabs: Record<string, ReturnType<typeof makeSheet>> = {};
  if (requests) {
    const sheet = makeSheet(requests, 9);
    if (opts.requestsThrow) {
      sheet.getLastRow = () => { throw new Error(opts.requestsThrow); };
    }
    tabs.SyncRequests = sheet;
  }
  tabs.SyncLog = makeSheet(opts.syncLog ?? [], 14);
  tabs.WithingsSyncLog = makeSheet(opts.withingsLog ?? [], 14);

  const FixedDate = new Proxy(Date, {
    construct(target, args) {
      return args.length ? new target(...(args as [])) : new target(opts.now ?? NOW);
    },
  });

  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  const sandbox = loadSources(
    ['types.js', 'utils.js', 'workouts.js', 'exercises.js', 'templates.js', 'sets.js',
      'daily-summary.js', 'daily-health.js', 'journal.js', 'body-measurements.js', 'sync-log.js', 'payload.js',
      'auth.js', 'sync-requests.js', 'main.js'],
    {
      Logger: { log: capture },
      console: { log: capture, info: capture, warn: capture, error: capture, debug: capture },
      Date: FixedDate,
      Utilities: makeUtilities(),
      LockService: makeLockService(lock),
      PropertiesService: makePropertiesService(properties),
      ContentService: makeContentService(),
      CacheService: makeCacheService(cache),
      SpreadsheetApp: {
        openById(id: string) {
          if (id !== 'sheet-id') throw new Error('wrong spreadsheet');
          return {
            getSheetByName(name: string) {
              tabReads.push(name);
              return tabs[name] ?? null;
            },
          };
        },
      },
      UrlFetchApp: {
        fetch(url: string, options: Record<string, any> = {}) {
          const f: Fetch = {
            url, method: String(options.method ?? 'get'), headers: { ...(options.headers ?? {}) },
            payload: options.payload, options,
          };
          fetches.push(f);
          let r: FetchReply;
          if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) r = opts.info ?? tokeninfo();
          else if (url.endsWith('/dispatches')) r = opts.dispatch ?? dispatchOk;
          else if (/\/actions\/runs\/\d+$/.test(url)) r = opts.run ?? runInProgress;
          else throw new Error('unexpected fetch ' + url);
          if ('throws' in r) throw new Error(r.throws);
          return { getResponseCode: () => r.status, getContentText: () => r.body };
        },
      },
    },
  );

  const rows = requests ?? [];
  const row = (i: number) =>
    Object.fromEntries(REQUEST_ORDER.map((k, c) => [k, String(rows[i][c] ?? '')]));
  const github = () => fetches.filter((f) => f.url.startsWith('https://api.github.com/'));
  const dispatches = () => fetches.filter((f) => f.url.endsWith('/dispatches'));

  /** POST as the SPA does: form fields only, the token never in a URL. */
  const call = (params: Record<string, string>, entry: 'doPost' | 'doGet' = 'doPost') => {
    const text: string = sandbox[entry]({ parameter: params }).getContent();
    return { text, res: JSON.parse(text) };
  };
  const ask = (ids: unknown, extra: Record<string, unknown> = {}) =>
    call({ action: 'requestSync', access_token: ACCESS_TOKEN, payload: JSON.stringify({ request_ids: ids, ...extra }) });

  return { sandbox, fetches, logs, tabReads, lock, cache, rows, row, github, dispatches, call, ask };
}

const DISPATCH_URL = (wf: string) =>
  `https://api.github.com/repos/luketmoss/thrive/actions/workflows/${wf}/dispatches`;

describe('AC1: a press is dispatched in the same request', () => {
  it('dispatches both vendors once each with {"ref":"main"} and writes started, run id and dispatched_at', () => {
    const h = harness({
      requests: [req(), req({ request_id: WITHINGS_ID, vendor: 'withings' })],
    });
    const { text, res } = h.ask([COROS_ID, WITHINGS_ID]);

    expect(JSON.parse(text)).toEqual({
      success: true,
      data: { requests: [{ request_id: COROS_ID, status: 'started' }, { request_id: WITHINGS_ID, status: 'started' }] },
    });
    expect(res.success).toBe(true);
    expect(h.dispatches().map((f) => f.url)).toEqual([DISPATCH_URL('coros-sync.yml'), DISPATCH_URL('withings-sync.yml')]);
    for (const f of h.dispatches()) {
      expect(f.method).toBe('post');
      expect(f.payload).toBe('{"ref":"main"}');
    }
    for (const i of [0, 1]) {
      expect(h.row(i).status).toBe('started');
      expect(h.row(i).workflow_run_id).toBe('987654');
      expect(h.row(i).dispatched_at).toBe(NOW.toISOString());
      expect(h.row(i).detail).toBe('');
      // A:D untouched.
      expect(h.row(i).requested_by).toBe(EMAIL);
    }
  });

  it('sends GitHub exactly what a poller tick would, on the same rows', () => {
    const viaAction = harness({ requests: [req()] });
    viaAction.ask([COROS_ID]);
    const viaTick = harness({ requests: [req()] });
    viaTick.sandbox.pollSyncRequests();

    const shape = (f: Fetch) => ({ url: f.url, method: f.method, headers: f.headers, payload: f.payload,
      contentType: f.options.contentType, followRedirects: f.options.followRedirects });
    expect(viaAction.github().map(shape)).toEqual(viaTick.github().map(shape));
    expect(viaAction.rows).toEqual(viaTick.rows);
  });

  it('a key caller may call it too, with the same answer', () => {
    const h = harness({ requests: [req()] });
    const { res } = h.call({ action: 'requestSync', key: 'test-key', payload: JSON.stringify({ request_ids: [COROS_ID] }) }, 'doGet');
    expect(res).toEqual({ success: true, data: { requests: [{ request_id: COROS_ID, status: 'started' }] } });
    expect(h.fetches.some((f) => f.url.includes('tokeninfo'))).toBe(false);
  });
});

describe('AC2: the poller\'s rules, under the poller\'s lock', () => {
  it('takes the script lock with tryLock(5000) and releases it', () => {
    const h = harness({ requests: [req()] });
    h.ask([COROS_ID]);
    expect(h.lock.tryWaits).toEqual([5000]);
    expect(h.lock.acquired).toBe(1);
    expect(h.lock.held).toBe(false);
  });

  it('a busy lock writes nothing, dispatches nothing, and answers the rows as they stand', () => {
    const h = harness({ requests: [req(), req({ request_id: WITHINGS_ID, vendor: 'withings' })], lockHeld: true });
    const before = JSON.stringify(h.rows);
    const { res } = h.ask([COROS_ID, WITHINGS_ID]);
    expect(res).toEqual({
      success: true,
      data: { requests: [{ request_id: COROS_ID, status: 'requested' }, { request_id: WITHINGS_ID, status: 'requested' }] },
    });
    expect(JSON.stringify(h.rows)).toBe(before);
    expect(h.github()).toEqual([]);
    expect(h.lock.held).toBe(true); // still the other holder's
  });

  it('a named row no longer requested is reported as it is and never dispatched again', () => {
    const h = harness({
      requests: [req({ status: 'started', workflow_run_id: '55', dispatched_at: minutesAgo(1) })],
    });
    const before = JSON.stringify(h.rows);
    const { res } = h.ask([COROS_ID]);
    expect(res.data.requests).toEqual([{ request_id: COROS_ID, status: 'started' }]);
    expect(h.github()).toEqual([]);
    expect(JSON.stringify(h.rows)).toBe(before);
  });

  it('asking twice for the same row dispatches once', () => {
    const h = harness({ requests: [req()] });
    h.ask([COROS_ID]);
    const { res } = h.ask([COROS_ID]);
    expect(res.data.requests).toEqual([{ request_id: COROS_ID, status: 'started' }]);
    expect(h.dispatches()).toHaveLength(1);
  });

  it('two presses in a row for the same vendor dispatch once: the second is skipped', () => {
    const second = 'sr_0000c0c1';
    const h = harness({ requests: [req(), req({ request_id: second })] });
    // The first ask runs the tick's step for COROS, which decides the second
    // row too, exactly as a tick would: one dispatch, the duplicate skipped.
    h.ask([COROS_ID]);
    const { res } = h.ask([second]);
    expect(h.dispatches()).toHaveLength(1);
    expect(res.data.requests).toEqual([{ request_id: second, status: 'skipped' }]);
    expect(h.row(1).detail).toMatch(/^Not started: a COROS sync asked for at .* is already under way\.$/);
  });

  it('inside the cooldown: skipped with the poller\'s sentence, no dispatch', () => {
    const h = harness({ requests: [req()], syncLog: [logRow('schedule-1-1', minutesAgo(3))] });
    const { res } = h.ask([COROS_ID]);
    expect(res.data.requests).toEqual([{ request_id: COROS_ID, status: 'skipped' }]);
    expect(h.row(0).detail).toBe('Not started: a COROS sync started at 12:57 PM. Ask again after 1:07 PM.');
    expect(h.dispatches()).toEqual([]);
  });

  it('a run already under way for the vendor: skipped', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_0000eeee', status: 'started', workflow_run_id: '77', dispatched_at: minutesAgo(12),
          requested_at: minutesAgo(12) }),
        req(),
      ],
    });
    const { res } = h.ask([COROS_ID]);
    expect(res.data.requests).toEqual([{ request_id: COROS_ID, status: 'skipped' }]);
    expect(h.row(1).detail).toBe('Not started: a COROS sync asked for at 12:48 PM is already under way.');
    expect(h.dispatches()).toEqual([]);
  });

  it.each([
    ['no token', { ghToken: null }, 'Not started: no GitHub token is set.'],
    ['a 401', { dispatch: { status: 401, body: GH_BODY } }, 'Not started: GitHub refused the token (401).'],
    ['a 403', { dispatch: { status: 403, body: GH_BODY } }, 'Not started: GitHub refused the request (403).'],
    ['a 404', { dispatch: { status: 404, body: GH_BODY } }, 'Not started: GitHub could not find coros-sync.yml (404).'],
    ['a 422', { dispatch: { status: 422, body: GH_BODY } }, 'Not started: GitHub would not start coros-sync.yml (422).'],
    ['a 502', { dispatch: { status: 502, body: GH_BODY } }, 'Not started: GitHub answered 502.'],
    ['a fetch that throws', { dispatch: { throws: 'DNS ' + GH_TOKEN } }, 'Not started: GitHub could not be reached.'],
  ] as const)('%s: failed with the poller\'s sentence, and the call still succeeds', (_name, opts, start) => {
    const h = harness({ requests: [req()], ...opts });
    const { res } = h.ask([COROS_ID]);
    expect(res).toEqual({ success: true, data: { requests: [{ request_id: COROS_ID, status: 'failed' }] } });
    expect(h.row(0).status).toBe('failed');
    expect(h.row(0).detail.startsWith(start)).toBe(true);
    expect(h.row(0).detail).not.toContain(GH_BODY);
  });

  it('a row older than the ceiling is expired, with no fetch', () => {
    const h = harness({ requests: [req({ requested_at: minutesAgo(20) })] });
    const { res } = h.ask([COROS_ID]);
    expect(res.data.requests).toEqual([{ request_id: COROS_ID, status: 'expired' }]);
    expect(h.github()).toEqual([]);
  });

  it('acts only on the named rows\' vendors', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_0000c0c1' }), // coros, open, not named
        req({ request_id: WITHINGS_ID, vendor: 'withings' }),
        req({ request_id: 'sr_0000c0c2', status: 'started', workflow_run_id: '9', dispatched_at: minutesAgo(25) }),
      ],
    });
    const { res } = h.ask([WITHINGS_ID]);
    expect(res.data.requests).toEqual([{ request_id: WITHINGS_ID, status: 'started' }]);
    expect(h.dispatches().map((f) => f.url)).toEqual([DISPATCH_URL('withings-sync.yml')]);
    expect(h.row(0).status).toBe('requested');
    // The COROS started row past its ceiling is the tick's to close, not this call's.
    expect(h.row(2).status).toBe('started');
  });

  it('closes its own vendor\'s finished started rows, as the tick\'s step does', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_0000c0c2', status: 'started', workflow_run_id: '123', dispatched_at: minutesAgo(15),
          requested_at: minutesAgo(15) }),
        req(),
      ],
      syncLog: [logRow('workflow_dispatch-123-1', minutesAgo(14))],
    });
    const { res } = h.ask([COROS_ID]);
    expect(h.row(0).status).toBe('done');
    // The run started 14 minutes ago: outside the cooldown, so this one starts.
    expect(res.data.requests).toEqual([{ request_id: COROS_ID, status: 'started' }]);
  });

  it('never appends a row and never runs the schedule-slot check, even inside a slot', () => {
    const inSlot = new Date('2026-10-02T12:31:00.000Z'); // 6:31 AM MDT
    const h = harness({ requests: [req({ request_id: WITHINGS_ID, vendor: 'withings' }, inSlot)], now: inSlot });
    h.ask([WITHINGS_ID]);
    expect(h.rows).toHaveLength(1);
    expect(h.dispatches().map((f) => f.url)).toEqual([DISPATCH_URL('withings-sync.yml')]);
  });

  it('an unreadable row of the same vendor is left for the tick, unwritten', () => {
    const h = harness({ requests: [req({ request_id: 'sr_0000bad0', requested_at: 'yesterday' }), req()] });
    h.ask([COROS_ID]);
    expect(h.row(0).status).toBe('requested');
    expect(h.row(1).status).toBe('started');
  });
});

describe('AC3: a request that cannot be found', () => {
  it('a named row not in the tab is not_found, and nothing is dispatched for it', () => {
    const h = harness({ requests: [req()] });
    const { res } = h.ask(['sr_00000000', COROS_ID]);
    expect(res.data.requests).toEqual([
      { request_id: 'sr_00000000', status: 'not_found' }, { request_id: COROS_ID, status: 'started' },
    ]);
    expect(h.dispatches()).toHaveLength(1);
  });

  it('with no SyncRequests tab every id is not_found', () => {
    const h = harness({ requests: null });
    const { res } = h.ask([COROS_ID]);
    expect(res).toEqual({ success: true, data: { requests: [{ request_id: COROS_ID, status: 'not_found' }] } });
    expect(h.github()).toEqual([]);
  });

  it('a token refusal is the existing envelope, and dispatches nothing', () => {
    const h = harness({ requests: [req()], info: { status: 400, body: '{"error":"invalid_token"}' } });
    const { res } = h.ask([COROS_ID]);
    expect(res.success).toBe(false);
    expect(res.code).toBe('token_invalid');
    expect(h.github()).toEqual([]);
    expect(h.row(0).status).toBe('requested');
  });
});

describe('AC4: owner-only, and it cannot be steered', () => {
  it.each([
    ['another Google account', { email: 'someone@example.com' }],
    ['another OAuth client', { aud: 'almanac-1234.apps.googleusercontent.com', azp: 'almanac-1234.apps.googleusercontent.com' }],
    ['an unverified email', { email_verified: 'false' }],
  ])('a token from %s is token_forbidden and dispatches nothing', (_name, over) => {
    const h = harness({ requests: [req()], info: tokeninfo(over) });
    const before = JSON.stringify(h.rows);
    const { res } = h.ask([COROS_ID]);
    expect(res.success).toBe(false);
    expect(res.code).toBe('token_forbidden');
    expect(h.github()).toEqual([]);
    expect(JSON.stringify(h.rows)).toBe(before);
    expect(h.lock.acquired).toBe(0);
  });

  it('nothing the caller sends grants anything: an email or requested_by parameter is ignored', () => {
    const h = harness({ requests: [req()], info: tokeninfo({ email: 'someone@example.com' }) });
    const { res } = h.call({
      action: 'requestSync', access_token: ACCESS_TOKEN, email: EMAIL, requested_by: EMAIL,
      payload: JSON.stringify({ request_ids: [COROS_ID], email: EMAIL, requested_by: EMAIL }),
    });
    expect(res.code).toBe('token_forbidden');
    expect(h.github()).toEqual([]);
  });

  it('extra payload keys produce the identical GitHub request', () => {
    const plain = harness({ requests: [req()] });
    plain.ask([COROS_ID]);
    const steered = harness({ requests: [req()] });
    steered.ask([COROS_ID], {
      ref: 'evil-branch', inputs: { force_refresh: 'true', backfill: '365' },
      workflow: 'withings-sync.yml', vendor: 'withings', owner: 'someone', repo: 'other',
    });
    const shape = (f: Fetch) => ({ url: f.url, method: f.method, headers: f.headers, payload: f.payload, options: f.options });
    expect(steered.github().map(shape)).toEqual(plain.github().map(shape));
    expect(steered.dispatches()[0].payload).toBe('{"ref":"main"}');
    expect(steered.rows).toEqual(plain.rows);
  });

  const BAD: [string, string | undefined][] = [
    ['no payload', undefined],
    ['no request_ids', JSON.stringify({})],
    ['request_ids not an array', JSON.stringify({ request_ids: COROS_ID })],
    ['an empty array', JSON.stringify({ request_ids: [] })],
    ['three ids', JSON.stringify({ request_ids: [COROS_ID, WITHINGS_ID, 'sr_0000ffff'] })],
    ['a duplicate', JSON.stringify({ request_ids: [COROS_ID, COROS_ID] })],
    ['uppercase hex', JSON.stringify({ request_ids: ['sr_0000C0C0'] })],
    ['a longer id', JSON.stringify({ request_ids: ['sr_0000c0c0x'] })],
    ['an injected id', JSON.stringify({ request_ids: ['sr_0000c0c0"<script>'] })],
    ['a number', JSON.stringify({ request_ids: [12345678] })],
    ['payload not JSON', '{"request_ids": [sr_<script>'],
  ];
  for (const [name, payload] of BAD) {
    it(`${name}: bad_request with fixed text, before the lock, the sheet or any GitHub fetch`, () => {
      const h = harness({ requests: [req()] });
      const params: Record<string, string> = { action: 'requestSync', access_token: ACCESS_TOKEN };
      if (payload !== undefined) params.payload = payload;
      const { text, res } = h.call(params);
      expect(res).toEqual({
        success: false, code: 'bad_request',
        error: 'payload.request_ids must be an array of one or two distinct request ids (sr_ and 8 hex digits).',
      });
      expect(text).not.toContain('script');
      expect(h.lock.acquired).toBe(0);
      expect(h.lock.tryWaits).toEqual([]);
      expect(h.tabReads).toEqual([]);
      expect(h.github()).toEqual([]);
    });
  }

  it('the response carries only request_id and status per row', () => {
    const h = harness({ requests: [req(), req({ request_id: WITHINGS_ID, vendor: 'withings' })], dispatch: { status: 401, body: GH_BODY } });
    const { res } = h.ask([COROS_ID, WITHINGS_ID]);
    expect(Object.keys(res).sort()).toEqual(['data', 'success']);
    expect(Object.keys(res.data)).toEqual(['requests']);
    for (const r of res.data.requests) expect(Object.keys(r).sort()).toEqual(['request_id', 'status']);
  });

  it('a status cell outside the known list is never echoed', () => {
    const h = harness({ requests: [req({ status: '=HYPERLINK("x")' })] });
    const { res } = h.ask([COROS_ID]);
    expect(res.data.requests).toEqual([{ request_id: COROS_ID, status: 'unknown' }]);
  });

  describe('neither token leaks, on any path', () => {
    const paths: [string, Parameters<typeof harness>[0]][] = [
      ['dispatched', { requests: [req()] }],
      ['dispatched, GitHub echoing the token', { requests: [req()],
        dispatch: { status: 200, body: JSON.stringify({ workflow_run_id: GH_TOKEN, message: GH_BODY }) } }],
      ['skipped', { requests: [req()], syncLog: [logRow('schedule-1-1', minutesAgo(3))] }],
      ['401', { requests: [req()], dispatch: { status: 401, body: GH_BODY + GH_TOKEN } }],
      ['403', { requests: [req()], dispatch: { status: 403, body: GH_BODY + GH_TOKEN } }],
      ['404', { requests: [req()], dispatch: { status: 404, body: GH_BODY + GH_TOKEN } }],
      ['422', { requests: [req()], dispatch: { status: 422, body: GH_BODY + GH_TOKEN } }],
      ['500', { requests: [req()], dispatch: { status: 500, body: GH_BODY + GH_TOKEN } }],
      ['fetch throws', { requests: [req()], dispatch: { throws: 'failed ' + GH_TOKEN + ' ' + ACCESS_TOKEN } }],
      ['lock busy', { requests: [req()], lockHeld: true }],
      ['unexpected error', { requests: [req()], requestsThrow: 'boom ' + GH_TOKEN + ' ' + encodeURIComponent(GH_TOKEN) }],
    ];
    for (const [name, opts] of paths) {
      it(name, () => {
        const h = harness(opts);
        const { text } = h.ask([COROS_ID]);
        for (const s of [GH_TOKEN, encodeURIComponent(GH_TOKEN), ACCESS_TOKEN, encodeURIComponent(ACCESS_TOKEN)]) {
          expect(text).not.toContain(s);
          expect(h.logs.join('\n')).not.toContain(s);
          expect(JSON.stringify(h.rows)).not.toContain(s);
          for (const [k, v] of h.cache) {
            expect(k).not.toContain(s);
            expect(v.value).not.toContain(s);
          }
        }
        expect(text).not.toContain(GH_BODY);
        expect(JSON.stringify(h.rows)).not.toContain(GH_BODY);
        // The GitHub token goes only into GitHub's Authorization header.
        for (const f of h.github()) {
          expect(f.headers.Authorization).toBe(`Bearer ${GH_TOKEN}`);
          expect(f.url).not.toContain(GH_TOKEN);
          expect(String(f.payload ?? '')).not.toContain(GH_TOKEN);
          expect(String(f.payload ?? '')).not.toContain(ACCESS_TOKEN);
        }
      });
    }

    it('an unexpected error answers fixed text and releases the lock', () => {
      const h = harness({ requests: [req()], requestsThrow: 'boom ' + GH_TOKEN });
      const { res } = h.ask([COROS_ID]);
      expect(res).toEqual({
        success: false, error: 'requestSync hit an unexpected error. The request stays open for the poller.',
      });
      expect(h.lock.held).toBe(false);
      expect(h.logs.some((l) => l.startsWith('requestSync: unexpected error: boom [redacted]'))).toBe(true);
    });
  });
});
