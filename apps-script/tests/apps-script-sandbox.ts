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
export function makeSheet(rows: CellValue[][], columnCount = 26) {
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
  options: { apiKey?: string; now?: Date; uuids?: string[] } = {},
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
      'daily-summary.js', 'main.js'],
    {
    ContentService: makeContentService(),
    PropertiesService: makePropertiesService({ API_KEY: apiKey, SPREADSHEET_ID: 'sheet-id' }),
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
  if (fixtures.dailyHealth) sheets.DailyHealth = makeSheet(fixtures.dailyHealth, 6);

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

  return { sandbox, rows: workoutRows, exerciseRows, templateRows, setRows, summaryRows };
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
 * A full 26-cell Workouts row, with only the named fields set.
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
