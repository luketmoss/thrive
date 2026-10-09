/**
 * migrate-260-workouts-sport-type.mjs — One-time sheet migration for #260.
 *
 * Appends column AB, `sport_type`, to the `Workouts` tab: the COROS sport code
 * of a synced or enriched activity (e.g. 204 mountain bike), which the COROS
 * web portal needs alongside `source_activity_id` to open the activity.
 * Nullable: blank means unknown, never `0`.
 *
 * Additive only: it may widen the grid to 28 columns and writes one header
 * cell, AB1. It never touches A1:AA1 or any data row; AB stays blank on every
 * existing row until the sync or `backfill-260-workouts-sport-type.mjs` fills
 * it.
 *
 * Run it **before** deploying the API version that reads and writes 28
 * columns, and before merging the SPA that reads A:AB: both address AB, and
 * both fail on a 27-column grid ("exceeds grid limits"). The API and SPA live
 * today address A:AA only, so running this while they are live is safe.
 *
 * Idempotency: the header is the guard. A tab whose header is already A:AB
 * ending `sport_type` is left alone. A header other than #145's A:AA, or
 * A:AB, is refused, naming what it found, never rewritten.
 *
 * Usage:
 *   node scripts/migrate-260-workouts-sport-type.mjs --dry-run
 *   node scripts/migrate-260-workouts-sport-type.mjs
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';

export const TAB = 'Workouts';

/**
 * A:AB. Must stay in step with WORKOUT_FIELDS in apps-script/src/types.js;
 * apps-script/tests/sport-type-migration.test.ts holds the two lists together.
 */
export const HEADERS = [
  'id', 'Date', 'Time', 'Type', 'Name', 'template_id', 'Notes', 'Elapsed (s)',
  'Created', 'copied_from', 'status',
  'Moving (s)', 'Effort', 'Distance (m)', 'Ascent (m)', 'Descent (m)', 'Avg HR (bpm)',
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref', 'fit_fetched_at',
  'synced_at', 'started_at_utc', 'calories',
  'estimated_seconds', // AA  #145
  'sport_type',        // AB  #260
];
export const BEFORE = HEADERS.slice(0, 27);
const ADDED = HEADERS.slice(27);

/**
 * The migration itself, over `api(path, init)` — a Sheets REST call relative
 * to the spreadsheet, answering the parsed body. Separate from the service
 * account so a test can drive it with a fake.
 *
 * @returns {Promise<number>} the exit code
 */
export async function migrate({ api, dryRun = false, log = console.log, error = console.error }) {
  const values = async (range) =>
    (await api(`/values/${encodeURIComponent(range)}`)).values ?? [];

  const meta = await api('?fields=sheets.properties');
  const tab = meta.sheets.find((s) => s.properties.title === TAB);
  if (!tab) {
    error(`REFUSING: there is no "${TAB}" tab.`);
    return 1;
  }

  const same = (a, b) => a.length === b.length && a.every((h, i) => h === b[i]);
  const header = (await values(`${TAB}!1:1`))[0] ?? [];
  const columns = tab.properties.gridProperties?.columnCount ?? 0;
  log(`"${TAB}" header is ${header.length} columns, grid is ${columns} wide.`);

  if (same(header, HEADERS) && columns >= HEADERS.length) {
    log(`skip   AB1 is already "${ADDED[0]}"`);
    log('\nNothing to do — migration already applied.');
    return 0;
  }
  if (!same(header, BEFORE) && !same(header, HEADERS)) {
    error(
      `REFUSING: "${TAB}"'s header is not #145's A:AA (or A:AB ending "${ADDED[0]}").\n` +
      `  found:    ${header.join(', ') || '(empty)'}\n` +
      `  expected: ${BEFORE.join(', ')}\n` +
      'Inspect it by hand. This script will not rewrite a header it does not recognize.'
    );
    return 1;
  }

  const lastRow = (await values(`${TAB}!A:A`)).length;
  const add = Math.max(0, HEADERS.length - columns);
  if (add) log(`plan   add ${add} column(s) to the grid (${columns} -> ${HEADERS.length})`);
  if (!same(header, HEADERS)) log(`plan   write AB1: ${ADDED.join(', ')}`);
  log(`       ${Math.max(0, lastRow - 1)} existing rows keep a blank AB: unknown until the backfill`);

  if (dryRun) {
    log('\n--dry-run: nothing written.');
    return 0;
  }

  if (add) {
    await api(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          appendDimension: { sheetId: tab.properties.sheetId, dimension: 'COLUMNS', length: add },
        }],
      }),
    });
    log(`wrote  ${add} column(s)`);
  }

  if (!same(header, HEADERS)) {
    await api(`/values/${encodeURIComponent(`${TAB}!AB1`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [ADDED] }),
    });
    log('wrote  AB1');
  }

  const after = (await values(`${TAB}!1:1`))[0] ?? [];
  const metaAfter = await api('?fields=sheets.properties');
  const colsAfter = metaAfter.sheets.find((s) => s.properties.title === TAB)
    .properties.gridProperties?.columnCount;
  log(`\n"${TAB}" header is now ${after.length} columns (grid ${colsAfter} wide); AA1..AB1 = ${after.slice(26).join(', ')}`);
  log(
    '\nAB is blank on every existing row. Deploy the API, then fill it from the archive:\n' +
    '  node scripts/backfill-260-workouts-sport-type.mjs --dry-run'
  );
  return 0;
}

async function main() {
  const { JWT } = await import('google-auth-library');
  const creds = JSON.parse(
    readFileSync(new URL('thrive-sa.json', import.meta.url), 'utf8')
  );
  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const { token } = await client.getAccessToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

  async function api(path, init) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json();
    if (body.error) throw new Error(`${body.error.status}: ${body.error.message}`);
    return body;
  }

  process.exitCode = await migrate({ api, dryRun: process.argv.includes('--dry-run') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
