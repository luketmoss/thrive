/**
 * migrate-231-daily-health-stress.mjs — One-time sheet migration for #231.
 *
 * Appends column S, `stress_avg`, to the `DailyHealth` tab: COROS's daily
 * average stress, parsed from the `Stress: Avg <n>` line the sync already
 * fetches. Appended after `synced_at`, never placed beside another metric:
 * DailyHealth's later columns are only ever appended, so no letter A:R moves.
 *
 * Additive only: it may widen the grid by one column and writes one header
 * cell, S1. It never touches A1:R1 or any data row; S stays blank on every
 * existing row until the sync or `backfill-231-daily-health-stress.mjs`
 * fills it.
 *
 * Run it **before** deploying the API version that writes 19 columns. That
 * version rewrites a row with `getRange(row, 1, 1, 19).setValues`, which fails
 * on an 18-column grid. The old version keeps writing A:R and leaves S blank,
 * so running this while it is live is safe (the `migrate-181` rule).
 *
 * Idempotency: the header is the guard. A tab whose header is already A:S is
 * left alone. A header other than #165's A:R, or A:S, is refused, never
 * rewritten.
 *
 * Usage:
 *   node scripts/migrate-231-daily-health-stress.mjs --dry-run
 *   node scripts/migrate-231-daily-health-stress.mjs
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';

export const TAB = 'DailyHealth';

/**
 * A:S. Must stay in step with DAILY_HEALTH_FIELDS in apps-script/src/types.js;
 * apps-script/tests/daily-health-upsert.test.ts holds the two lists together.
 */
export const HEADERS = [
  'date',          // A
  'resting_hr',    // B
  'hrv',           // C
  'steps',         // D
  'calories',      // E
  'sleep_total_s', // F
  'sleep_deep_s',  // G
  'sleep_rem_s',   // H
  'sleep_light_s', // I
  'sleep_awake_s', // J
  'sleep_score',   // K
  'vo2max',        // L
  'recovery',      // M
  'training_load', // N
  'bed_time',      // O
  'wake_time',     // P
  'raw_ref',       // Q
  'synced_at',     // R
  'stress_avg',    // S  #231
];
export const BEFORE = HEADERS.slice(0, 18);
const ADDED = HEADERS.slice(18);

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
    error(`REFUSING: there is no "${TAB}" tab. Run scripts/migrate-165-daily-health-tab.mjs first.`);
    return 1;
  }

  const same = (a, b) => a.length === b.length && a.every((h, i) => h === b[i]);
  const header = (await values(`${TAB}!1:1`))[0] ?? [];

  if (same(header, HEADERS)) {
    log(`skip   "${TAB}" already has the A1:S1 header`);
    log('\nNothing to do — migration already applied.');
    return 0;
  }
  if (!same(header, BEFORE)) {
    error(
      `REFUSING: "${TAB}"'s header is not #165's A:R.\n` +
      `  found:    ${header.join(', ') || '(empty)'}\n` +
      `  expected: ${BEFORE.join(', ')}\n` +
      'Inspect it by hand. This script will not rewrite a header it does not recognize.'
    );
    return 1;
  }

  const columns = tab.properties.gridProperties?.columnCount ?? 0;
  const add = Math.max(0, HEADERS.length - columns);
  log(`grid   ${columns} columns`);
  if (add) log(`plan   add ${add} column(s) to the grid (${columns} -> ${HEADERS.length})`);
  log(`plan   write S1: ${ADDED.join(', ')}`);

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

  await api(`/values/${encodeURIComponent(`${TAB}!S1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [ADDED] }),
  });
  log('wrote  S1');

  const after = (await values(`${TAB}!1:1`))[0] ?? [];
  log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
  log(
    '\nS is blank on every existing row. Deploy the API, then fill it from the archive:\n' +
    '  node scripts/backfill-231-daily-health-stress.mjs --dry-run'
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
