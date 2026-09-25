// Sandboxed loader for Apps Script sources.
//
// Apps Script files are plain `.js` evaluated into one shared global scope —
// no modules, no exports. A test that transcribes a function into the test
// file stays green when the real source breaks, so instead we read the real
// `src/*.js` files and evaluate them into a `node:vm` context with the Google
// globals stubbed. Ported from the harness in luketmoss/hive, which was
// written after exactly that failure.
//
// This is safe because no source file touches a Google global at load time:
// `PropertiesService`, `ContentService`, `SpreadsheetApp` and `Utilities`
// appear only inside function bodies.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// The sandbox holds the globals the `.js` sources declared. Its shape is only
// knowable at runtime — the sources are plain Apps Script JS with no types to
// import — so `any` is the honest type here rather than a shortcut.
export type Sandbox = Record<string, any>;

/** A value as a Sheets range hands it back. */
export type CellValue = string | number | boolean | Date | SheetFormula;

/** What a cell holds when a write began with `=`: a live formula, not text. */
export class SheetFormula {
  constructor(public source: string) {}
}

// A parsed date remembers how it was typed, because that is what Sheets
// displays: "2026-03-04" typed into a cell shows as "2026-03-04".
const typedAs = new WeakMap<Date, string>();

/**
 * What Sheets stores when a script writes `value` with appendRow/setValues.
 *
 * Those behave like typing into the cell, NOT like the REST API's RAW mode
 * the SPA uses (#132). A date- or time-shaped string becomes a date, a
 * number-shaped one a number, a leading `=` a formula. A leading apostrophe is
 * the escape: the rest is stored as literal text and the apostrophe dropped.
 *
 * The fake used to store whatever it was handed, which is how 94 DailySummary
 * rows went out with real dates in column A and nothing noticed.
 */
export function storeAsTyped(value: CellValue): CellValue {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'")) return value.slice(1);
  if (value.startsWith('=')) return new SheetFormula(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
    const d = new Date(/^\d{4}/.test(value) ? `${value}T00:00:00` : `1899-12-30T${value.padStart(5, '0')}`);
    typedAs.set(d, value);
    return d;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** What getDisplayValues — and the SPA's FORMATTED_VALUE read — shows. */
export function displayOf(value: CellValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (value instanceof SheetFormula) return '#FORMULA';
  if (value instanceof Date) return typedAs.get(value) ?? value.toString();
  return String(value);
}

/**
 * A fake Sheet covering the surface the sources use.
 *
 * `rows` is the live backing array, so a test asserts on what the sheet holds
 * afterwards rather than on what the code claims it did. Fixture rows stand
 * for data the SPA already wrote with RAW, so they are kept exactly as given;
 * every write through the script API goes through `storeAsTyped`, as it would
 * in Sheets.
 */
export function makeSheet(rows: CellValue[][], columnCount = 27) {
  return {
    rows,
    getLastRow() {
      return rows.length + 1; // +1 for the header row
    },
    getLastColumn() {
      return columnCount;
    },
    appendRow(row: CellValue[]) {
      rows.push(row.map(storeAsTyped));
    },
    // 1-based sheet row, header included — `deleteRow(2)` removes the first
    // data row. Modelling the shift is the point: a delete that re-used a
    // stale row number would silently hit the wrong record here too, which is
    // why `replaceTemplate` deletes bottom-to-top.
    deleteRow(rowNum: number) {
      rows.splice(rowNum - 2, 1);
    },
    getRange(startRow: number, startCol: number, numRows: number, numCols: number) {
      const slice = () => rows
        .slice(startRow - 2, startRow - 2 + numRows)
        .map((r) => r.slice(startCol - 1, startCol - 1 + numCols));
      return {
        // Raw stored values: Date objects and numbers where Sheets parsed.
        getValues() {
          return slice();
        },
        getDisplayValues() {
          return slice().map((r) => {
            const out: string[] = [];
            for (let c = 0; c < numCols; c++) out.push(displayOf(r[c]));
            return out;
          });
        },
        setValues(values: CellValue[][]) {
          for (let i = 0; i < numRows; i++) {
            const target = startRow - 2 + i;
            if (!rows[target]) rows[target] = [];
            for (let c = 0; c < numCols; c++) {
              rows[target][startCol - 1 + c] = storeAsTyped(values[i][c]);
            }
          }
        },
      };
    },
  };
}

/**
 * `Utilities` stub covering the surface the sources use.
 *
 * `formatDate` is the load-bearing one: the real Apps Script method resolves a
 * named IANA zone including its DST transitions, so the stub does the same
 * through `Intl` rather than hard-coding an offset — a fixed -6 or -7 would
 * make an MST/MDT boundary test pass for the wrong reason.
 */
export function makeUtilities(uuids: string[] = []) {
  let nextUuid = 0;
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    /**
     * The real SHA-256, returned as Apps Script returns it: signed bytes,
     * -128..127, so the source's conversion to hex is exercised for real.
     */
    computeDigest(algorithm: string, value: string, charset: string) {
      if (algorithm !== 'SHA_256' || charset !== 'UTF_8') {
        throw new Error('Utilities.computeDigest stub only supports SHA_256 over UTF_8');
      }
      return Array.from(createHash('sha256').update(value, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));
    },
    getUuid() {
      return uuids[nextUuid++] ?? 'uuid-' + ++nextUuid;
    },
    formatDate(date: Date, timeZone: string, format: string) {
      if (format !== 'yyyy-MM-dd') {
        throw new Error('Utilities.formatDate stub only supports yyyy-MM-dd, got: ' + format);
      }
      // 'en-CA' renders YYYY-MM-DD, which is what Apps Script's 'yyyy-MM-dd'
      // produces.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    },
  };
}

/** ContentService stub — captures the text passed to `createTextOutput`. */
export function makeContentService() {
  return {
    MimeType: { JSON: 'application/json' },
    createTextOutput(text: string) {
      const output = {
        getContent() {
          return text;
        },
        setMimeType() {
          return output;
        },
      };
      return output;
    },
  };
}

/**
 * LockService stub (#156): one script lock, counted so a test can assert a
 * write took it, and refusing re-entry so a nested acquire fails loudly.
 */
export function makeLockService(state: { acquired: number; held: boolean }) {
  return {
    getScriptLock() {
      return {
        waitLock() {
          if (state.held) throw new Error('Lock timeout: the script lock is already held');
          state.held = true;
          state.acquired += 1;
        },
        releaseLock() {
          state.held = false;
        },
      };
    },
  };
}

/** One entry in the fake script cache, with the TTL it was put with. */
export interface CacheEntry {
  value: string;
  ttl: number;
}

/**
 * CacheService stub (#144). `store` is the live backing map, so a test
 * asserts on the keys and values actually written — which is where a leaked
 * token would show up.
 */
export function makeCacheService(store: Map<string, CacheEntry>) {
  return {
    getScriptCache() {
      return {
        get(key: string) {
          return store.get(key)?.value ?? null;
        },
        put(key: string, value: string, ttl: number) {
          if (key.length > 250) throw new Error('Cache key over 250 characters');
          store.set(key, { value, ttl });
        },
      };
    },
  };
}

/** What a fake tokeninfo answers: an HTTP status and a body, or a throw. */
export type FetchReply = { status: number; body: string } | { throws: string };

/**
 * UrlFetchApp stub (#144). Records every URL fetched, and answers each with
 * `reply(url)`. Absent unless a test supplies it, like every stub that
 * affects behaviour.
 */
export function makeUrlFetchApp(calls: string[], reply: (url: string) => FetchReply) {
  return {
    fetch(url: string, options: { muteHttpExceptions?: boolean } = {}) {
      calls.push(url);
      const r = reply(url);
      if ('throws' in r) throw new Error(r.throws);
      if (!options.muteHttpExceptions && r.status >= 400) {
        throw new Error('Request failed for ' + url + ' returned code ' + r.status);
      }
      return {
        getResponseCode: () => r.status,
        getContentText: () => r.body,
      };
    },
  };
}

/** A folder or file in the fake Drive (#179). `parents` are ids. */
export interface DriveNode {
  name: string;
  parents: string[];
  /** Files only: the content, and optionally its MIME type and trash state. */
  content?: string;
  trashed?: boolean;
}

/**
 * DriveApp stub (#179) over `nodes`, keyed by id. Records every id asked for,
 * so a test can assert that a refusal made no Drive call at all. `fail`, when
 * given, is thrown from `getFileById` instead — Drive's real permission and
 * not-found messages.
 */
export function makeDriveApp(nodes: Record<string, DriveNode>, calls: string[], fail?: string) {
  const wrap = (id: string): any => {
    const node = nodes[id];
    return {
      getName: () => node.name,
      isTrashed: () => !!node.trashed,
      getSize: () => Buffer.byteLength(node.content ?? '', 'utf8'),
      getParents() {
        const ids = [...node.parents];
        return { hasNext: () => ids.length > 0, next: () => wrap(ids.shift()!) };
      },
      getBlob: () => ({
        getDataAsString(charset: string) {
          if (charset !== 'UTF-8') throw new Error('DriveApp stub reads UTF-8 only');
          return node.content ?? '';
        },
      }),
    };
  };
  return {
    getFileById(id: string) {
      calls.push(id);
      if (fail) throw new Error(fail);
      const node = nodes[id];
      if (!node || node.content === undefined) {
        throw new Error('No item with the given ID could be found. Possibly because you have not ' +
          'edited this item or you do not have permission to access it.');
      }
      return wrap(id);
    },
  };
}

/** PropertiesService stub backed by a plain object of script properties. */
export function makePropertiesService(properties: Record<string, string>) {
  return {
    getScriptProperties() {
      return {
        getProperty(key: string) {
          return Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null;
        },
      };
    },
  };
}

/**
 * Evaluate the named files from `apps-script/src` into one shared sandbox, in
 * order, with `globals` injected first.
 *
 * `Logger` and `console` are diagnostics only, so they are defaulted.
 * Anything that affects behaviour is left to the caller on purpose: a missing
 * stub should fail loudly rather than quietly return a default.
 */
export function loadSources(files: string[], globals: Sandbox = {}): Sandbox {
  const context = createContext({ Logger: { log() {} }, console, ...globals });
  for (const file of files) {
    const filename = path.join(SRC_DIR, file);
    runInContext(readFileSync(filename, 'utf8'), context, { filename, displayErrors: true });
  }
  return context;
}

export interface LoadedApi {
  sandbox: Sandbox;
  /** The live Workouts backing array — assert against this after a write. */
  rows: CellValue[][];
  /** The other tabs' live backing arrays (#134). */
  exerciseRows: CellValue[][];
  templateRows: CellValue[][];
  setRows: CellValue[][];
  summaryRows: CellValue[][];
  /** DailyHealth's backing array, or undefined when the tab does not exist. */
  healthRows?: CellValue[][];
  /** SyncLog's backing array, or undefined when the tab does not exist (#156). */
  syncLogRows?: CellValue[][];
  /** How many times the script lock was taken, and whether it is held now. */
  lock: { acquired: number; held: boolean };
  /** The script cache's live backing map (#144). */
  cache: Map<string, CacheEntry>;
  /** Every URL UrlFetchApp was asked for, in order (#144). */
  fetches: string[];
  /** Every Drive file id DriveApp was asked for, in order (#179). */
  driveCalls: string[];
}

/** Tab fixtures for `loadApi`. Each defaults to empty. */
export interface Fixtures {
  workouts?: CellValue[][];
  exercises?: CellValue[][];
  templates?: CellValue[][];
  sets?: CellValue[][];
  dailySummary?: CellValue[][];
  /** Omit entirely to model the tab not existing yet — the pre-sync state. */
  dailyHealth?: CellValue[][];
  /** As dailyHealth: omit to model the tab not existing yet (#156). */
  syncLog?: CellValue[][];
}

/**
 * Load the whole API with the Workouts tab backed by `workoutRows`.
 *
 * Only the sheet accessor is replaced. `getAllRows`, `rowToWorkout` and
 * `workoutToRow` stay the real source, so column mapping is exercised by
 * every test rather than stubbed past.
 */
export function loadApi(
  workoutRowsOrFixtures: CellValue[][] | Fixtures = [],
  options: {
    apiKey?: string;
    now?: Date;
    uuids?: string[];
    /** Extra script properties, e.g. TOKEN_CLIENT_ID (#144). */
    properties?: Record<string, string>;
    /** How the fake tokeninfo answers. Without it, any fetch fails the test. */
    tokeninfo?: (url: string) => FetchReply;
    /** The fake Drive (#179). Without it, any Drive call finds nothing. */
    drive?: Record<string, DriveNode>;
    /** Thrown by DriveApp.getFileById instead of looking anything up. */
    driveFails?: string;
  } = {},
): LoadedApi {
  const apiKey = options.apiKey ?? 'test-key';

  // Callers from #130 pass Workouts rows positionally; #134 needs four tabs.
  const fixtures: Fixtures = Array.isArray(workoutRowsOrFixtures)
    ? { workouts: workoutRowsOrFixtures }
    : workoutRowsOrFixtures;
  const workoutRows = fixtures.workouts ?? [];
  const exerciseRows = fixtures.exercises ?? [];
  const templateRows = fixtures.templates ?? [];
  const setRows = fixtures.sets ?? [];
  const summaryRows = fixtures.dailySummary ?? [];
  const lock = { acquired: 0, held: false };
  const cache = new Map<string, CacheEntry>();
  const fetches: string[] = [];
  const driveCalls: string[] = [];
  const tokeninfo = options.tokeninfo ?? ((url: string): FetchReply => {
    throw new Error('Unexpected UrlFetchApp.fetch: ' + url);
  });

  // A fixed clock where one is needed, so `created` and "today" are assertable.
  const FixedDate = options.now
    ? new Proxy(Date, {
        construct(target, args) {
          return args.length ? new target(...(args as [])) : new target(options.now!);
        },
      })
    : Date;

  const sandbox = loadSources(
    ['types.js', 'utils.js', 'workouts.js', 'exercises.js', 'templates.js', 'sets.js',
      'daily-summary.js', 'daily-health.js', 'sync-log.js', 'payload.js', 'auth.js', 'main.js'],
    {
      LockService: makeLockService(lock),
      ContentService: makeContentService(),
      PropertiesService: makePropertiesService({
        API_KEY: apiKey, SPREADSHEET_ID: 'sheet-id', ...options.properties,
      }),
      CacheService: makeCacheService(cache),
      UrlFetchApp: makeUrlFetchApp(fetches, tokeninfo),
      DriveApp: makeDriveApp(options.drive ?? {}, driveCalls, options.driveFails),
      Utilities: makeUtilities(options.uuids),
      Date: FixedDate,
    }
  );

  const sheets: Record<string, ReturnType<typeof makeSheet>> = {
    Workouts: makeSheet(workoutRows, sandbox.WORKOUT_COLUMN_COUNT),
    Exercises: makeSheet(exerciseRows, sandbox.EXERCISE_COLUMN_COUNT),
    Templates: makeSheet(templateRows, sandbox.TEMPLATE_COLUMN_COUNT),
    Sets: makeSheet(setRows, sandbox.SET_COLUMN_COUNT),
    DailySummary: makeSheet(summaryRows, sandbox.DAILY_SUMMARY_COLUMN_COUNT),
  };
  // DailyHealth is absent unless a fixture supplies it, which is the real
  // pre-sync state: the tab does not exist, and that is not a tab of zeros.
  if (fixtures.dailyHealth) {
    sheets.DailyHealth = makeSheet(fixtures.dailyHealth, sandbox.DAILY_HEALTH_COLUMN_COUNT);
  }
  if (fixtures.syncLog) {
    sheets.SyncLog = makeSheet(fixtures.syncLog, sandbox.SYNC_LOG_COLUMN_COUNT);
  }

  sandbox.getSheet = (name: string) => {
    const sheet = sheets[name];
    if (!sheet) throw new Error('Sheet "' + name + '" not stubbed');
    return sheet;
  };
  // `getSpreadsheet().getSheetByName` returns null for an absent tab rather
  // than throwing — daily-summary.js relies on that to detect no DailyHealth.
  sandbox.getSpreadsheet = () => ({
    getSheetByName: (name: string) => sheets[name] ?? null,
  });

  return {
    sandbox, rows: workoutRows, exerciseRows, templateRows, setRows, summaryRows,
    healthRows: fixtures.dailyHealth, syncLogRows: fixtures.syncLog, lock, cache, fetches,
    driveCalls,
  };
}

/** A workout as the API returns it. */
export interface ApiWorkout {
  id: string;
  sheetRow: number;
  [field: string]: CellValue;
}

/** The envelope every action returns. `data` is absent on failure. */
export interface ApiResponse<T = ApiWorkout[]> {
  success: boolean;
  data: T;
  error?: string;
  /** Present only on the failures that carry one (#144). */
  code?: 'token_invalid' | 'token_forbidden' | 'token_unavailable' | 'read_only';
}

/** Call the sandbox's `doGet` with `params` and return the parsed body. */
export function callDoGet<T = ApiWorkout[]>(
  sandbox: Sandbox,
  params: Record<string, string | undefined>,
): ApiResponse<T> {
  const output = sandbox.doGet({ parameter: { key: 'test-key', ...params } });
  return JSON.parse(output.getContent()) as ApiResponse<T>;
}

/**
 * Call the sandbox's `doGet` or `doPost` with exactly `params` — no key added —
 * and return the raw body text alongside the parsed envelope (#144).
 */
export function callEntry<T = ApiWorkout[]>(
  sandbox: Sandbox,
  entry: 'doGet' | 'doPost',
  params: Record<string, string>,
): { text: string; res: ApiResponse<T> } {
  const text: string = sandbox[entry]({ parameter: params }).getContent();
  return { text, res: JSON.parse(text) as ApiResponse<T> };
}

/**
 * A full 27-cell Workouts row, with only the named fields set.
 *
 * Defaults mirror a hand-logged weight session: everything nullable empty.
 */
export function workoutRow(overrides: Record<string, CellValue> = {}): CellValue[] {
  const fields: Record<string, CellValue> = {
    id: 'w_001',
    date: '2026-09-15',
    time: '07:00',
    type: 'weight',
    name: 'Upper Push A',
    ...overrides,
  };
  const ORDER = [
    'id', 'date', 'time', 'type', 'name', 'template_id', 'notes',
    'elapsed_seconds', 'created', 'copied_from', 'status',
    'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr',
    'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
    'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
    'estimated_seconds',
  ];
  return ORDER.map((f) => fields[f] ?? '');
}

/** An Exercises row (A:E), with only the named fields set. */
export function exerciseRow(overrides: Record<string, CellValue> = {}): CellValue[] {
  const f: Record<string, CellValue> = {
    id: 'ex_001', name: 'Bench Press', tags: 'Push,Chest', notes: '', created: '',
    ...overrides,
  };
  return ['id', 'name', 'tags', 'notes', 'created'].map((k) => f[k] ?? '');
}

/** A Templates row (A:H). */
export function templateRow(overrides: Record<string, CellValue> = {}): CellValue[] {
  const f: Record<string, CellValue> = {
    template_id: 'tpl_001', template_name: 'Upper Push A', order: 1,
    exercise_id: 'ex_001', exercise_name: 'Bench Press', section: 'primary',
    sets: '4', reps: '6',
    ...overrides,
  };
  return ['template_id', 'template_name', 'order', 'exercise_id', 'exercise_name',
    'section', 'sets', 'reps'].map((k) => f[k] ?? '');
}

/** A Sets row (A:J) — ten cells, no column K (#100). */
export function setRow(overrides: Record<string, CellValue> = {}): CellValue[] {
  const f: Record<string, CellValue> = {
    workout_id: 'w_001', exercise_id: 'ex_001', exercise_name: 'Bench Press',
    section: 'primary', exercise_order: 1, set_number: 1,
    planned_reps: '6', weight: '', reps: '', effort: '',
    ...overrides,
  };
  return ['workout_id', 'exercise_id', 'exercise_name', 'section', 'exercise_order',
    'set_number', 'planned_reps', 'weight', 'reps', 'effort'].map((k) => f[k] ?? '');
}

/** DailyHealth's A:R order (#165). Mirrors DAILY_HEALTH_FIELDS in types.js. */
export const DAILY_HEALTH_ORDER = [
  'date', 'resting_hr', 'hrv', 'steps', 'calories',
  'sleep_total_s', 'sleep_deep_s', 'sleep_rem_s', 'sleep_light_s', 'sleep_awake_s',
  'sleep_score', 'vo2max', 'recovery', 'training_load',
  'bed_time', 'wake_time', 'raw_ref', 'synced_at',
];

/** A DailyHealth row (A:R), with only the named fields set. */
export function healthRow(overrides: Record<string, CellValue> = {}): CellValue[] {
  return DAILY_HEALTH_ORDER.map((k) => overrides[k] ?? '');
}
