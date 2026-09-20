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
export type CellValue = string | number | boolean | Date;

/**
 * A fake Sheet covering the surface `utils.js` and `workouts.js` use.
 *
 * `rows` is the live backing array, so a test asserts on what the sheet holds
 * afterwards rather than on what the code claims it did.
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
      rows.push(row);
    },
    getRange(startRow: number, startCol: number, numRows: number, numCols: number) {
      return {
        getValues() {
          return rows
            .slice(startRow - 2, startRow - 2 + numRows)
            .map((r) => r.slice(startCol - 1, startCol - 1 + numCols));
        },
        setValues(values: CellValue[][]) {
          for (let i = 0; i < numRows; i++) {
            const target = startRow - 2 + i;
            if (!rows[target]) rows[target] = [];
            for (let c = 0; c < numCols; c++) {
              rows[target][startCol - 1 + c] = values[i][c];
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
}

/**
 * Load the whole API with the Workouts tab backed by `workoutRows`.
 *
 * Only the sheet accessor is replaced. `getAllRows`, `rowToWorkout` and
 * `workoutToRow` stay the real source, so column mapping is exercised by
 * every test rather than stubbed past.
 */
export function loadApi(
  workoutRows: CellValue[][] = [],
  options: { apiKey?: string; now?: Date; uuids?: string[] } = {},
): LoadedApi {
  const apiKey = options.apiKey ?? 'test-key';

  // A fixed clock where one is needed, so `created` and "today" are assertable.
  const FixedDate = options.now
    ? new Proxy(Date, {
        construct(target, args) {
          return args.length ? new target(...(args as [])) : new target(options.now!);
        },
      })
    : Date;

  const sandbox = loadSources(['types.js', 'utils.js', 'workouts.js', 'main.js'], {
    ContentService: makeContentService(),
    PropertiesService: makePropertiesService({ API_KEY: apiKey, SPREADSHEET_ID: 'sheet-id' }),
    Utilities: makeUtilities(options.uuids),
    Date: FixedDate,
  });

  const sheet = makeSheet(workoutRows, sandbox.WORKOUT_COLUMN_COUNT);
  sandbox.getSheet = (name: string) => {
    if (name !== 'Workouts') throw new Error('Sheet "' + name + '" not stubbed');
    return sheet;
  };

  return { sandbox, rows: workoutRows };
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
