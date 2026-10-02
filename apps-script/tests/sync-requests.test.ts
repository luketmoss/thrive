// #314 — the SyncRequests poller: an Apps Script time-driven trigger that
// starts coros-sync.yml / withings-sync.yml from rows the SPA appends, and
// closes every row it started. Fakes only: no network, no live Apps Script,
// the clock fixed.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  loadSources, loadApi, callEntry, makeSheet, makeUtilities, makeLockService,
  makePropertiesService, type CellValue, type FetchReply,
} from './apps-script-sandbox';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Characters that URL-encode differently, so a leak of either spelling shows.
const TOKEN = 'github_pat_SENTINEL/314+Token=_value';
const NOW = new Date('2026-10-02T13:30:00.000Z'); // 7:30 AM MDT
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const REQUEST_ORDER = [
  'request_id', 'vendor', 'requested_at', 'requested_by', 'status',
  'workflow_run_id', 'dispatched_at', 'finished_at', 'detail',
];

function req(overrides: Record<string, string> = {}): CellValue[] {
  const f: Record<string, string> = {
    request_id: 'sr_1a2b3c4d', vendor: 'coros', requested_at: minutesAgo(2),
    requested_by: 'someone@example.com', status: 'requested', ...overrides,
  };
  return REQUEST_ORDER.map((k) => f[k] ?? '');
}

/** A SyncLog / WithingsSyncLog row: run_id, started_at, and status in L. */
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

type Reply = FetchReply;

interface Trigger { handler: string; minutes?: number }

function makeScriptApp(triggers: Trigger[]) {
  return {
    getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.handler, t })),
    deleteTrigger(trigger: { t: Trigger }) {
      const i = triggers.indexOf(trigger.t);
      if (i >= 0) triggers.splice(i, 1);
    },
    newTrigger(handler: string) {
      const spec: Trigger = { handler };
      let timeBased = false;
      const builder = {
        timeBased() { timeBased = true; return builder; },
        everyMinutes(n: number) { spec.minutes = n; return builder; },
        create() {
          if (!timeBased || spec.minutes === undefined) throw new Error('incomplete trigger');
          triggers.push(spec);
          return {};
        },
      };
      return builder;
    },
  };
}

/** Default GitHub: a dispatch answers 200 with a run id; a run is in progress. */
function github(over: { dispatch?: Reply; run?: Reply | ((id: string) => Reply) } = {}) {
  return (url: string): Reply => {
    if (url.endsWith('/dispatches')) {
      return over.dispatch ?? { status: 200, body: JSON.stringify({ workflow_run_id: 987654, run_url: 'x' }) };
    }
    const m = url.match(/\/actions\/runs\/(\d+)$/);
    if (m) {
      const run = over.run ?? { status: 200, body: JSON.stringify({ status: 'in_progress', conclusion: null }) };
      return typeof run === 'function' ? run(m[1]) : run;
    }
    throw new Error('unexpected fetch ' + url);
  };
}

function harness(opts: {
  requests?: CellValue[][] | null;
  syncLog?: CellValue[][] | null;
  withingsLog?: CellValue[][] | null;
  token?: string | null;
  reply?: (url: string, f: Fetch) => Reply;
  lockHeld?: boolean;
  triggers?: Trigger[];
  logFails?: string;
} = {}) {
  const requests = opts.requests === undefined ? [] : opts.requests;
  const fetches: Fetch[] = [];
  const logs: string[] = [];
  const propertyReads: string[] = [];
  const tabReads: string[] = [];
  const rangeReads: string[] = [];
  const lock = { acquired: 0, held: !!opts.lockHeld, tryWaits: [] as number[] };
  const triggers = opts.triggers ?? [];
  const reply = opts.reply ?? github();

  const properties: Record<string, string> = { SPREADSHEET_ID: 'sheet-id' };
  if (opts.token !== null) properties.GITHUB_DISPATCH_TOKEN = opts.token ?? TOKEN;

  const tabs: Record<string, ReturnType<typeof makeSheet>> = {};
  const track = (name: string, sheet: ReturnType<typeof makeSheet>) => {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (r: number, c: number, nr: number, nc: number) => {
      const range = getRange(r, c, nr, nc);
      const read = range.getDisplayValues.bind(range);
      range.getDisplayValues = () => {
        if (opts.logFails && name !== 'SyncRequests') throw new Error(opts.logFails);
        rangeReads.push(`${name}!${r},${c},${nr},${nc}`);
        return read();
      };
      return range;
    };
    tabs[name] = sheet;
  };
  if (requests) track('SyncRequests', makeSheet(requests, 9));
  if (opts.syncLog) track('SyncLog', makeSheet(opts.syncLog, 14));
  if (opts.withingsLog) track('WithingsSyncLog', makeSheet(opts.withingsLog, 14));

  const FixedDate = new Proxy(Date, {
    construct(target, args) {
      return args.length ? new target(...(args as [])) : new target(NOW);
    },
  });

  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  const sandbox = loadSources(['types.js', 'utils.js', 'sync-requests.js'], {
    Logger: { log: capture },
    console: { log: capture, info: capture, warn: capture, error: capture, debug: capture },
    Date: FixedDate,
    Utilities: makeUtilities(),
    LockService: makeLockService(lock),
    PropertiesService: makePropertiesService(properties, propertyReads),
    ScriptApp: makeScriptApp(triggers),
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
        const r = reply(url, f);
        if ('throws' in r) throw new Error(r.throws);
        if (!options.muteHttpExceptions && r.status >= 400) throw new Error('code ' + r.status);
        return { getResponseCode: () => r.status, getContentText: () => r.body };
      },
    },
  });

  const rows = requests ?? [];
  const field = (i: number, name: string) => String(rows[i][REQUEST_ORDER.indexOf(name)] ?? '');
  const row = (i: number) => Object.fromEntries(REQUEST_ORDER.map((k) => [k, field(i, k)]));
  return {
    sandbox, fetches, logs, propertyReads, tabReads, rangeReads, lock, triggers, rows, row,
    poll: () => sandbox.pollSyncRequests(),
  };
}

const DISPATCH_URL = (wf: string) =>
  `https://api.github.com/repos/luketmoss/thrive/actions/workflows/${wf}/dispatches`;

describe('AC1: the field lists in types.js', () => {
  it('declares SYNC_REQUEST_FIELDS (A:I), statuses and vendors', () => {
    const { sandbox } = harness();
    expect([...sandbox.SYNC_REQUEST_FIELDS]).toEqual(REQUEST_ORDER);
    expect(sandbox.SYNC_REQUEST_COLUMN_COUNT).toBe(9);
    expect([...sandbox.SYNC_REQUEST_STATUSES]).toEqual([
      'requested', 'started', 'done', 'cancelled', 'failed', 'not_reported', 'skipped', 'expired',
    ]);
    expect([...sandbox.SYNC_REQUEST_VENDORS]).toEqual(['coros', 'withings']);
  });

  it('pins the timing constants', () => {
    const { sandbox } = harness();
    expect(sandbox.SYNC_POLL_MINUTES).toBe(5);
    expect(sandbox.SYNC_COOLDOWN_MINUTES).toBe(10);
    expect(sandbox.SYNC_CEILING_MINUTES).toBe(20);
  });
});

describe('AC2: an idle tick is cheap and silent', () => {
  it('reads SyncRequests once, fetches nothing, reads no token, no other tab, writes nothing', () => {
    const finals = [
      req({ status: 'done', workflow_run_id: '1', dispatched_at: minutesAgo(30), finished_at: minutesAgo(28) }),
      req({ request_id: 'sr_2', status: 'failed', detail: 'x' }),
      req({ request_id: 'sr_3', status: 'expired' }),
      req({ request_id: 'sr_4', status: 'Requested' }), // not exactly an open status
    ];
    const before = JSON.stringify(finals);
    const h = harness({ requests: finals, syncLog: [] });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.rangeReads).toEqual(['SyncRequests!2,1,4,9']);
    expect(h.tabReads).toEqual(['SyncRequests']);
    expect(h.propertyReads).toEqual(['SPREADSHEET_ID']);
    expect(JSON.stringify(h.rows)).toBe(before);
    expect(h.logs).toEqual([]);
    expect(h.lock.held).toBe(false);
  });

  it('an empty tab is idle too', () => {
    const h = harness({ requests: [] });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.propertyReads).toEqual(['SPREADSHEET_ID']);
  });

  it('with no SyncRequests tab: no write, no fetch, no throw, one fixed log line', () => {
    const h = harness({ requests: null });
    expect(() => h.poll()).not.toThrow();
    expect(h.fetches).toEqual([]);
    expect(h.logs).toEqual(['pollSyncRequests: no SyncRequests tab; nothing to poll.']);
    expect(h.lock.held).toBe(false);
  });

  it('takes the script lock with tryLock(5000) and releases it', () => {
    const h = harness({ requests: [req()], syncLog: [] });
    h.poll();
    expect(h.lock.tryWaits).toEqual([5000]);
    expect(h.lock.acquired).toBe(1);
    expect(h.lock.held).toBe(false);
  });

  it('does nothing at all when the lock is busy', () => {
    const h = harness({ requests: [req()], syncLog: [], lockHeld: true });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.tabReads).toEqual([]);
    expect(h.row(0).status).toBe('requested');
    expect(h.lock.held).toBe(true); // still the other holder's
  });
});

describe('AC3: a request starts its workflow with a fixed payload', () => {
  it('POSTs exactly {"ref":"main"} to coros-sync.yml with the three headers', () => {
    const h = harness({ requests: [req()], syncLog: [] });
    h.poll();
    expect(h.fetches).toHaveLength(1);
    const f = h.fetches[0];
    expect(f.url).toBe(DISPATCH_URL('coros-sync.yml'));
    expect(f.method).toBe('post');
    expect(f.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
    });
    const body = JSON.parse(f.payload!);
    expect(body).toEqual({ ref: 'main' });
    expect(body).not.toHaveProperty('inputs');
  });

  it('withings dispatches withings-sync.yml', () => {
    const h = harness({ requests: [req({ vendor: 'withings' })], withingsLog: [] });
    h.poll();
    expect(h.fetches.map((f) => f.url)).toEqual([DISPATCH_URL('withings-sync.yml')]);
  });

  it('no cell of the row reaches the URL, headers or body', () => {
    const marks = {
      request_id: 'sr_deadbeef', requested_by: 'leak-me@example.com',
      detail: 'inputs=backfill', workflow_run_id: '', finished_at: '',
    };
    const h = harness({ requests: [req(marks)], syncLog: [] });
    h.poll();
    const sent = JSON.stringify(h.fetches.map((f) => [f.url, f.headers, f.payload]));
    for (const v of ['sr_deadbeef', 'leak-me@example.com', 'backfill', 'example.com', 'coros"']) {
      expect(sent).not.toContain(v);
    }
  });

  it('writes started, the run id and dispatched_at back, and leaves A:D alone', () => {
    const h = harness({ requests: [req()], syncLog: [] });
    const ad = h.rows[0].slice(0, 4);
    h.poll();
    expect(h.row(0)).toMatchObject({
      status: 'started', workflow_run_id: '987654', dispatched_at: NOW.toISOString(),
      finished_at: '', detail: '',
    });
    expect(h.rows[0].slice(0, 4)).toEqual(ad);
    // Stored as text, not parsed into a number.
    expect(h.rows[0][5]).toBe('987654');
  });

  it('a 2xx with no numeric run id still starts, with the run id blank and a detail', () => {
    for (const reply of [
      { status: 204, body: '' },
      { status: 200, body: JSON.stringify({ workflow_run_id: 'abc' }) },
      { status: 200, body: '{}' },
    ]) {
      const h = harness({ requests: [req()], syncLog: [], reply: github({ dispatch: reply }) });
      h.poll();
      expect(h.row(0)).toMatchObject({
        status: 'started', workflow_run_id: '', dispatched_at: NOW.toISOString(),
        detail: "GitHub started the run but did not return its id, so its result can't be matched.",
      });
    }
  });

  it.each([
    ['COROS', 'Not started: "COROS" is not a vendor Thrive can sync. Use coros or withings.'],
    ['garmin', 'Not started: "garmin" is not a vendor Thrive can sync. Use coros or withings.'],
    ['', 'Not started: "" is not a vendor Thrive can sync. Use coros or withings.'],
  ])('vendor %j fails with no fetch', (vendor, detail) => {
    const h = harness({ requests: [req({ vendor })], syncLog: [] });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(0)).toMatchObject({ status: 'failed', detail, finished_at: NOW.toISOString() });
  });

  it('a blank request_id or a requested_at that is not an ISO instant fails with no fetch', () => {
    const h = harness({
      requests: [
        req({ request_id: '' }),
        req({ request_id: 'sr_2', requested_at: '2026-10-02 07:28' }),
        req({ request_id: 'sr_3', requested_at: '' }),
      ],
      syncLog: [],
    });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(0)).toMatchObject({ status: 'failed', detail: 'Not started: request_id is blank.' });
    expect(h.row(1)).toMatchObject({ status: 'failed', detail: 'Not started: requested_at is not an ISO 8601 time.' });
    expect(h.row(2)).toMatchObject({ status: 'failed', detail: 'Not started: requested_at is not an ISO 8601 time.' });
  });

  it('the row-drift guard: a row whose A:C changed under the poller is not written', () => {
    let h: ReturnType<typeof harness>;
    h = harness({
      requests: [req()],
      syncLog: [],
      reply: (url) => {
        h.rows[0][0] = 'sr_moved00'; // a hand sort put another row here mid-tick
        return github()(url);
      },
    });
    h.poll();
    expect(h.fetches).toHaveLength(1);
    expect(h.row(0)).toMatchObject({ request_id: 'sr_moved00', status: 'requested', workflow_run_id: '' });
  });

  it('every write is escaped: a formula-looking value is stored as text', () => {
    const h = harness({ requests: [req({ vendor: '=IMPORTXML("x")' })], syncLog: [] });
    h.poll();
    expect(typeof h.rows[0][8]).toBe('string');
    expect(h.row(0).detail).toContain('"=IMPORTXML("x")"');
  });
});

describe('AC4: one run per vendor at a time', () => {
  it('a request 20 minutes old expires, with no fetch; 19 minutes still starts', () => {
    const h = harness({ requests: [req({ requested_at: minutesAgo(20) })], syncLog: [] });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(0)).toMatchObject({
      status: 'expired', finished_at: NOW.toISOString(),
      detail: 'Not started: this request was not picked up within 20 minutes. The next scheduled sync will run as usual.',
    });

    const h2 = harness({ requests: [req({ requested_at: minutesAgo(19) })], syncLog: [] });
    h2.poll();
    expect(h2.row(0).status).toBe('started');
  });

  it('dispatches at most once per vendor per tick, oldest first; the rest are skipped', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_b', requested_at: minutesAgo(1) }),
        req({ request_id: 'sr_a', requested_at: minutesAgo(3) }), // 7:27 AM, the oldest
        req({ request_id: 'sr_c', requested_at: minutesAgo(2) }),
      ],
      syncLog: [],
    });
    h.poll();
    expect(h.fetches).toHaveLength(1);
    expect(h.row(1).status).toBe('started');
    for (const i of [0, 2]) {
      expect(h.row(i)).toMatchObject({
        status: 'skipped',
        detail: 'Not started: a COROS sync asked for at 7:27 AM is already under way.',
      });
    }
  });

  it('a started row still open skips a new request, naming the open one\'s time', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_open', requested_at: minutesAgo(6), status: 'started',
          workflow_run_id: '555', dispatched_at: minutesAgo(5) }),
        req({ request_id: 'sr_new', requested_at: minutesAgo(1) }),
      ],
      syncLog: [],
    });
    h.poll();
    expect(h.fetches.map((f) => f.method)).toEqual(['get']); // the run check, no dispatch
    expect(h.row(0).status).toBe('started');
    expect(h.row(1)).toMatchObject({
      status: 'skipped', detail: 'Not started: a COROS sync asked for at 7:24 AM is already under way.',
    });
  });

  it('cooldown from the poller\'s own last dispatch', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_old', requested_at: minutesAgo(9), status: 'done',
          workflow_run_id: '11', dispatched_at: minutesAgo(8), finished_at: minutesAgo(6) }),
        req({ request_id: 'sr_new', requested_at: minutesAgo(1) }),
      ],
      syncLog: [],
    });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(1)).toMatchObject({
      status: 'skipped', detail: 'Not started: a COROS sync started at 7:22 AM. Ask again after 7:32 AM.',
    });
  });

  it('cooldown from the log tab\'s newest started_at, a scheduled run included', () => {
    const h = harness({
      requests: [req({ vendor: 'withings', requested_at: minutesAgo(1) })],
      withingsLog: [logRow('schedule-1-1', minutesAgo(40)), logRow('schedule-2-1', minutesAgo(4))],
    });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(0)).toMatchObject({
      status: 'skipped', detail: 'Not started: a Withings sync started at 7:26 AM. Ask again after 7:36 AM.',
    });
  });

  it('a run 10 minutes old is outside the cooldown; a missing log tab is no run', () => {
    const h = harness({ requests: [req()], syncLog: [logRow('schedule-1-1', minutesAgo(10))] });
    h.poll();
    expect(h.row(0).status).toBe('started');

    const h2 = harness({ requests: [req()], syncLog: null });
    h2.poll();
    expect(h2.row(0).status).toBe('started');
  });

  it('a dispatched row without a run id does not count toward the cooldown', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_old', status: 'not_reported', workflow_run_id: '', dispatched_at: minutesAgo(5) }),
        req({ request_id: 'sr_new', requested_at: minutesAgo(1) }),
      ],
      syncLog: [],
    });
    h.poll();
    expect(h.row(1).status).toBe('started');
  });

  it('COROS and Withings are independent: a skipped COROS row does not stop Withings', () => {
    const h = harness({
      requests: [
        req({ request_id: 'sr_c', vendor: 'coros' }),
        req({ request_id: 'sr_w', vendor: 'withings' }),
      ],
      syncLog: [logRow('schedule-9-1', minutesAgo(3))],
      withingsLog: [],
    });
    h.poll();
    expect(h.row(0).status).toBe('skipped');
    expect(h.row(1).status).toBe('started');
    expect(h.fetches.map((f) => f.url)).toEqual([DISPATCH_URL('withings-sync.yml')]);
  });

  it('both vendors may start in one tick', () => {
    const h = harness({
      requests: [req({ request_id: 'sr_c' }), req({ request_id: 'sr_w', vendor: 'withings' })],
      syncLog: [], withingsLog: [],
    });
    h.poll();
    expect(h.fetches.map((f) => f.url)).toEqual([DISPATCH_URL('coros-sync.yml'), DISPATCH_URL('withings-sync.yml')]);
  });
});

describe('AC5: the poller closes every row it started', () => {
  const startedRow = (o: Record<string, string> = {}) => req({
    status: 'started', requested_at: minutesAgo(6), workflow_run_id: '123', dispatched_at: minutesAgo(5), ...o,
  });

  it('done by its log row, naming the run_id and status, with no GitHub call', () => {
    const h = harness({ requests: [startedRow()], syncLog: [logRow('workflow_dispatch-123-1', minutesAgo(5), 'partial')] });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(0)).toMatchObject({
      status: 'done', finished_at: NOW.toISOString(), workflow_run_id: '123', dispatched_at: minutesAgo(5),
      detail: 'Finished: the run logged partial in SyncLog (workflow_dispatch-123-1).',
    });
  });

  it('a Withings run names WithingsSyncLog, and a re-run attempt matches', () => {
    const h = harness({
      requests: [startedRow({ vendor: 'withings' })],
      withingsLog: [logRow('workflow_dispatch-123-2', minutesAgo(5), 'failed')],
    });
    h.poll();
    expect(h.row(0).detail).toBe('Finished: the run logged failed in WithingsSyncLog (workflow_dispatch-123-2).');
  });

  it('run 12 does not match workflow_dispatch-123-1', () => {
    const h = harness({
      requests: [startedRow({ workflow_run_id: '12' })],
      syncLog: [logRow('workflow_dispatch-123-1', minutesAgo(5)), logRow('schedule-12-1', minutesAgo(50))],
    });
    h.poll();
    expect(h.row(0).status).toBe('started');
    expect(h.fetches.map((f) => f.url)).toEqual(['https://api.github.com/repos/luketmoss/thrive/actions/runs/12']);
    expect(h.fetches[0].method).toBe('get');
    expect(h.fetches[0].headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
    });
  });

  it('a run GitHub cancelled becomes cancelled', () => {
    const h = harness({
      requests: [startedRow()], syncLog: [],
      reply: github({ run: { status: 200, body: JSON.stringify({ status: 'completed', conclusion: 'cancelled' }) } }),
    });
    h.poll();
    expect(h.row(0)).toMatchObject({
      status: 'cancelled', finished_at: NOW.toISOString(),
      detail: 'GitHub cancelled the run, usually because a scheduled sync took its place.',
    });
  });

  it.each([
    ['failure', 'failed'],
    ['timed_out', 'timed out'],
    ['startup_failure', 'failed to start'],
    ['action_required', 'action_required'],
    ['success', 'success'],
  ])('a run that concluded %s without a log row fails, in words', (conclusion, words) => {
    const h = harness({
      requests: [startedRow()], syncLog: [],
      reply: github({ run: { status: 200, body: JSON.stringify({ status: 'completed', conclusion }) } }),
    });
    h.poll();
    expect(h.row(0)).toMatchObject({
      status: 'failed', detail: `The run ended without logging a result (GitHub: ${words}).`,
    });
  });

  it.each([
    ['queued', { status: 200, body: JSON.stringify({ status: 'queued', conclusion: null }) }],
    ['in progress', { status: 200, body: JSON.stringify({ status: 'in_progress', conclusion: null }) }],
    ['a 404', { status: 404, body: '{"message":"Not Found"}' }],
    ['a 500', { status: 500, body: 'oops' }],
    ['a throw', { throws: 'Address unavailable' }],
    ['bad JSON', { status: 200, body: 'not json' }],
  ] as [string, Reply][])('a run that is %s is left started, unwritten', (_name, run) => {
    const h = harness({ requests: [startedRow()], syncLog: [], reply: github({ run }) });
    const before = JSON.stringify(h.rows);
    h.poll();
    expect(JSON.stringify(h.rows)).toBe(before);
  });

  it('20 minutes after dispatched_at a row still open becomes not_reported', () => {
    const h = harness({ requests: [startedRow({ requested_at: minutesAgo(21), dispatched_at: minutesAgo(20) })], syncLog: [] });
    h.poll();
    expect(h.row(0)).toMatchObject({
      status: 'not_reported', finished_at: NOW.toISOString(),
      detail: 'No result 20 minutes after the run was started. The next scheduled sync will try again.',
    });
  });

  it('the ceiling counts from dispatched_at, not requested_at', () => {
    const h = harness({ requests: [startedRow({ requested_at: minutesAgo(38), dispatched_at: minutesAgo(19) })], syncLog: [] });
    h.poll();
    expect(h.row(0).status).toBe('started');
  });

  it('a started row with no run id is closed by the ceiling, and GitHub is never asked', () => {
    const h = harness({ requests: [startedRow({ workflow_run_id: '', dispatched_at: minutesAgo(5) })], syncLog: [] });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(0).status).toBe('started');

    const h2 = harness({ requests: [startedRow({ workflow_run_id: '', dispatched_at: minutesAgo(25) })], syncLog: [] });
    h2.poll();
    expect(h2.fetches).toEqual([]);
    expect(h2.row(0).status).toBe('not_reported');
  });

  it('a final row is never asked about again', () => {
    const h = harness({ requests: [startedRow({ status: 'not_reported' })], syncLog: [] });
    h.poll();
    expect(h.fetches).toEqual([]);
  });

  it('without a token, the log row and the ceiling still close rows, with no fetch', () => {
    const h = harness({
      token: null,
      requests: [
        startedRow(),
        startedRow({ request_id: 'sr_2', workflow_run_id: '200', dispatched_at: minutesAgo(25) }),
        startedRow({ request_id: 'sr_3', workflow_run_id: '300' }),
      ],
      syncLog: [logRow('workflow_dispatch-123-1', minutesAgo(5))],
    });
    h.poll();
    expect(h.fetches).toEqual([]);
    expect(h.row(0).status).toBe('done');
    expect(h.row(1).status).toBe('not_reported');
    expect(h.row(2).status).toBe('started');
  });
});

describe('AC6: every failure in words', () => {
  const NO_TOKEN = 'Not started: no GitHub token is set. Store one as the script property ' +
    'GITHUB_DISPATCH_TOKEN (Apps Script → Project Settings → Script Properties, as luketmossbot).';

  it.each([[null], [''], ['   ']])('token %j: every request fails with no fetch and no throw', (token) => {
    const h = harness({
      token: token as string | null,
      requests: [req(), req({ request_id: 'sr_w', vendor: 'withings' }), req({ request_id: 'sr_c2', requested_at: minutesAgo(1) })],
      syncLog: [], withingsLog: [],
    });
    expect(() => h.poll()).not.toThrow();
    expect(h.fetches).toEqual([]);
    for (const i of [0, 1, 2]) expect(h.row(i)).toMatchObject({ status: 'failed', detail: NO_TOKEN });
  });

  it.each([
    [401, 'Not started: GitHub refused the token (401). It has expired or been revoked. Store a new one as ' +
      'GITHUB_DISPATCH_TOKEN (Apps Script → Project Settings → Script Properties, as luketmossbot).'],
    [403, 'Not started: GitHub refused the request (403). The token may lack Actions: Read and write on ' +
      "luketmoss/thrive, or GitHub's rate limit was hit."],
    [404, 'Not started: GitHub could not find coros-sync.yml (404). The token may not include luketmoss/thrive.'],
    [422, 'Not started: GitHub would not start coros-sync.yml (422). The workflow may be disabled.'],
    [502, 'Not started: GitHub answered 502. Ask again later.'],
    [302, 'Not started: GitHub answered 302. Ask again later.'],
  ])('a %i fails with a fixed detail and no retry', (status, detail) => {
    const h = harness({
      requests: [req(), req({ request_id: 'sr_dup', requested_at: minutesAgo(1) })],
      syncLog: [],
      reply: github({ dispatch: { status, body: JSON.stringify({ message: 'body text ' + TOKEN }) } }),
    });
    h.poll();
    expect(h.fetches).toHaveLength(1);
    expect(h.row(0)).toMatchObject({ status: 'failed', detail, workflow_run_id: '', dispatched_at: '' });
    // A duplicate press in the same tick gets the same answer, not a second dispatch.
    expect(h.row(1)).toMatchObject({ status: 'failed', detail });
  });

  it('a 404 for Withings names withings-sync.yml', () => {
    const h = harness({
      requests: [req({ vendor: 'withings' })], withingsLog: [],
      reply: github({ dispatch: { status: 404, body: '' } }),
    });
    h.poll();
    expect(h.row(0).detail).toBe('Not started: GitHub could not find withings-sync.yml (404). The token may not include luketmoss/thrive.');
  });

  it('a fetch that throws fails in words', () => {
    const h = harness({ requests: [req()], syncLog: [], reply: github({ dispatch: { throws: 'DNS error for ' + TOKEN } }) });
    h.poll();
    expect(h.row(0)).toMatchObject({ status: 'failed', detail: 'Not started: GitHub could not be reached. Ask again later.' });
  });

  it('a per-row error is recorded on that row; the other vendor carries on', () => {
    const h = harness({
      requests: [req(), req({ request_id: 'sr_w', vendor: 'withings' })],
      syncLog: [], withingsLog: [],
    });
    // UrlFetchApp throwing is "could not be reached"; force an error past it instead.
    const real = h.sandbox.syncDispatch;
    h.sandbox.syncDispatch = (token: string, workflow: string) => {
      if (workflow === 'coros-sync.yml') throw new Error('boom ' + TOKEN);
      return real(token, workflow);
    };
    h.poll();
    expect(h.row(0)).toMatchObject({
      status: 'failed', detail: 'The poller hit an unexpected error on this request. Ask again later.',
    });
    expect(h.row(1).status).toBe('started');
    expect(h.logs.join('\n')).not.toContain(TOKEN);
    expect(h.logs.join('\n')).toContain('[redacted]');
  });

  it('a tick-level error propagates, without the token in its message', () => {
    const h = harness({
      requests: [req()], syncLog: [logRow('schedule-1-1', minutesAgo(90))], logFails: 'Service error reading ' + TOKEN,
    });
    let thrown: Error | undefined;
    try { h.poll(); } catch (err) { thrown = err as Error; }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('Service error');
    expect(thrown!.message).not.toContain(TOKEN);
    expect(thrown!.message).not.toContain(encodeURIComponent(TOKEN));
    expect(h.lock.held).toBe(false);
  });
});

describe('AC6: the token appears only in the Authorization header', () => {
  const echo = { status: 200, body: JSON.stringify({ workflow_run_id: TOKEN, message: TOKEN }) };
  const scenarios: [string, Parameters<typeof harness>[0]][] = [
    ['a dispatch that echoes the token', { requests: [req()], syncLog: [], reply: github({ dispatch: echo }) }],
    ['a refused dispatch echoing it', {
      requests: [req()], syncLog: [], reply: github({ dispatch: { status: 401, body: TOKEN } }),
    }],
    ['a run check echoing it', {
      requests: [req({ status: 'started', workflow_run_id: '9', dispatched_at: minutesAgo(3) })], syncLog: [],
      reply: github({ run: { status: 200, body: JSON.stringify({ status: 'completed', conclusion: TOKEN }) } }),
    }],
    ['a run check echoing it as a word', {
      requests: [req({ status: 'started', workflow_run_id: '9', dispatched_at: minutesAgo(3) })], syncLog: [],
      reply: github({ run: { status: 200, body: JSON.stringify({ status: 'completed', conclusion: 'github_pat_x' }) } }),
    }],
    ['a throw quoting it', { requests: [req()], syncLog: [], reply: github({ dispatch: { throws: TOKEN } }) }],
    ['a full tick', {
      requests: [
        req(), req({ request_id: 'sr_w', vendor: 'withings' }),
        req({ request_id: 'sr_s', status: 'started', workflow_run_id: '77', dispatched_at: minutesAgo(25) }),
      ],
      syncLog: [], withingsLog: [],
    }],
  ];

  for (const [name, opts] of scenarios) {
    it(`after ${name}`, () => {
      const h = harness(opts);
      try { h.poll(); } catch { /* the sweep is about what was written */ }
      const spellings = [TOKEN, encodeURIComponent(TOKEN)];
      for (const s of spellings) {
        expect(JSON.stringify(h.rows)).not.toContain(s);
        expect(h.logs.join('\n')).not.toContain(s);
        for (const f of h.fetches) {
          expect(f.url).not.toContain(s);
          expect(String(f.payload ?? '')).not.toContain(s);
          const { Authorization, ...rest } = f.headers;
          expect(Authorization).toBe(`Bearer ${TOKEN}`);
          expect(JSON.stringify(rest)).not.toContain(s);
        }
      }
    });
  }

  it('GITHUB_DISPATCH_TOKEN is named in sync-requests.js and nowhere else in src/', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.js') || f.endsWith('.json'));
    const naming = files.filter((f) => readFileSync(path.join(SRC, f), 'utf8').includes('GITHUB_DISPATCH_TOKEN'));
    expect(naming).toEqual(['sync-requests.js']);
  });

  it('main.js has no case for the poller or its setup functions', () => {
    const main = readFileSync(path.join(SRC, 'main.js'), 'utf8');
    for (const name of ['pollSyncRequests', 'installSyncRequestTrigger', 'removeSyncRequestTrigger']) {
      expect(main).not.toContain(name);
    }
  });

  it.each(['pollSyncRequests', 'installSyncRequestTrigger', 'removeSyncRequestTrigger'])(
    'doGet with action=%s answers Unknown action to a key caller, and runs nothing',
    (action) => {
      const api = loadApi({});
      for (const entry of ['doGet', 'doPost'] as const) {
        const { res } = callEntry(api.sandbox, entry, { action, key: 'test-key' });
        expect(res).toEqual({ success: false, error: `Unknown action: "${action}"` });
      }
      expect(api.fetches).toEqual([]);
    });

  it.each(['pollSyncRequests', 'installSyncRequestTrigger', 'removeSyncRequestTrigger'])(
    'a token caller asking for %s is refused before dispatch (read_only), and runs nothing',
    (action) => {
      const CLIENT_ID = 'spa.apps.googleusercontent.com';
      const api = loadApi({}, {
        properties: { TOKEN_CLIENT_ID: CLIENT_ID, TOKEN_ALLOWED_EMAIL: 'owner@example.com' },
        tokeninfo: () => ({
          status: 200,
          body: JSON.stringify({
            aud: CLIENT_ID, azp: CLIENT_ID, email: 'owner@example.com', email_verified: 'true', expires_in: '3599',
          }),
        }),
      });
      const { res } = callEntry(api.sandbox, 'doPost', { action, access_token: 'ya29.test' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('read_only');
      // Only tokeninfo was asked; nothing reached GitHub.
      expect(api.fetches.every((u) => u.startsWith('https://oauth2.googleapis.com/tokeninfo'))).toBe(true);
    });
});

describe('AC7: install and remove the trigger', () => {
  const unrelated = (): Trigger => ({ handler: 'someOtherJob', minutes: 15 });

  it('installs exactly one 5-minute pollSyncRequests trigger, and twice still leaves one', () => {
    const triggers = [unrelated()];
    const h = harness({ triggers });
    h.sandbox.installSyncRequestTrigger();
    expect(triggers).toEqual([unrelated(), { handler: 'pollSyncRequests', minutes: 5 }]);
    expect(h.logs).toEqual(['Installed 1 trigger: pollSyncRequests every 5 minutes (replaced 0).']);

    h.logs.length = 0;
    h.sandbox.installSyncRequestTrigger();
    expect(triggers).toEqual([unrelated(), { handler: 'pollSyncRequests', minutes: 5 }]);
    expect(h.logs).toEqual(['Installed 1 trigger: pollSyncRequests every 5 minutes (replaced 1).']);
  });

  it('replaces duplicates left behind', () => {
    const triggers = [{ handler: 'pollSyncRequests', minutes: 1 }, unrelated(), { handler: 'pollSyncRequests', minutes: 5 }];
    const h = harness({ triggers });
    h.sandbox.installSyncRequestTrigger();
    expect(triggers).toEqual([unrelated(), { handler: 'pollSyncRequests', minutes: 5 }]);
    expect(h.logs[0]).toBe('Installed 1 trigger: pollSyncRequests every 5 minutes (replaced 2).');
  });

  it.each([[null], [''], ['  ']])('warns when the token is %j, never logging a value', (token) => {
    const h = harness({ token: token as string | null });
    h.sandbox.installSyncRequestTrigger();
    expect(h.logs).toEqual([
      'Installed 1 trigger: pollSyncRequests every 5 minutes (replaced 0).',
      'GITHUB_DISPATCH_TOKEN is not set: every request will be marked failed until it is.',
    ]);
  });

  it('with the token set, logs only the install line and never the token', () => {
    const h = harness();
    h.sandbox.installSyncRequestTrigger();
    expect(h.logs).toEqual(['Installed 1 trigger: pollSyncRequests every 5 minutes (replaced 0).']);
    expect(h.logs.join()).not.toContain(TOKEN);
  });

  it('accepts only 1 or 5 minutes', () => {
    const triggers: Trigger[] = [];
    const h = harness({ triggers });
    h.sandbox.SYNC_POLL_MINUTES = 10;
    expect(() => h.sandbox.installSyncRequestTrigger()).toThrow(/1 or 5/);
    expect(triggers).toEqual([]);
    h.sandbox.SYNC_POLL_MINUTES = 1;
    h.sandbox.installSyncRequestTrigger();
    expect(triggers).toEqual([{ handler: 'pollSyncRequests', minutes: 1 }]);
    expect(h.logs[0]).toBe('Installed 1 trigger: pollSyncRequests every 1 minute (replaced 0).');
  });

  it('remove deletes only pollSyncRequests triggers', () => {
    const triggers = [{ handler: 'pollSyncRequests', minutes: 5 }, unrelated()];
    const h = harness({ triggers });
    h.sandbox.removeSyncRequestTrigger();
    expect(triggers).toEqual([unrelated()]);
    expect(h.logs).toEqual(['Removed 1 pollSyncRequests trigger(s). Other triggers untouched.']);

    h.logs.length = 0;
    h.sandbox.removeSyncRequestTrigger();
    expect(triggers).toEqual([unrelated()]);
    expect(h.logs).toEqual(['Removed 0 pollSyncRequests trigger(s). Other triggers untouched.']);
  });

  it('appsscript.json pins script.scriptapp, and nothing else changes', () => {
    const manifest = JSON.parse(readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
    expect(manifest.oauthScopes).toEqual([
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/script.scriptapp',
    ]);
    expect(manifest.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
    expect(manifest.timeZone).toBe('America/Denver');
  });
});
