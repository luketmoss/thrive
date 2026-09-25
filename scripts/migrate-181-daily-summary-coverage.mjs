#!/usr/bin/env node
/**
 * migrate-181-daily-summary-coverage.mjs — One-time sheet migration for #181.
 *
 * Adds columns S, `moving_withdata`, and T, `elapsed_withdata`, to the
 * `DailySummary` tab: how many of the day's activities (B) contributed to
 * `total_moving_s` (D) and `total_elapsed_s` (E). #131 created the tab with an
 * 18-column grid, so the columns are added to the grid first, then S1:T1 are
 * written.
 *
 * They are **appended**, not placed beside D and E: almanac (luketmoss/keel)
 * reads this tab by column, and no letter A:R may move.
 *
 * Run it **before** deploying the API version that writes 20 columns. That
 * version rewrites a row with `getRange(row, 1, 1, 20).setValues`, which fails
 * on an 18-column grid. The old version keeps writing A:R and leaves S:T
 * blank, so running this while it is live is safe.
 *
 * Idempotency: the header is the guard. A tab whose header is already A:T is
 * left alone. A header other than #131's A:R, or A:T, is refused, never
 * rewritten.
 *
 * Usage:
 *   node scripts/migrate-181-daily-summary-coverage.mjs --dry-run
 *   node scripts/migrate-181-daily-summary-coverage.mjs
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const TAB = 'DailySummary';

/**
 * A:T. Must stay in step with DAILY_SUMMARY_FIELDS in
 * apps-script/src/types.js; apps-script/tests/daily-summary.test.ts holds the
 * two lists together.
 */
const HEADERS = [
  'date',                  // A
  'activity_count',        // B
  'activity_types',        // C
  'total_moving_s',        // D
  'total_elapsed_s',       // E
  'total_distance_m',      // F  outdoor only
  'total_ascent_m',        // G  outdoor only
  'cardio_activity_count', // H
  'distance_withdata',     // I
  'ascent_withdata',       // J
  'max_effort',            // K
  'effort_counts',         // L
  'steps',                 // M  from DailyHealth
  'resting_hr',            // N
  'hrv',                   // O
  'sleep_total_s',         // P
  'training_load',         // Q
  'computed_at',           // R
  'moving_withdata',       // S  #181
  'elapsed_withdata',      // T  #181
];
const BEFORE = HEADERS.slice(0, 18);
const ADDED = HEADERS.slice(18);

const creds = JSON.parse(
  readFileSync(new URL('../mcp-server/thrive-sa.json', import.meta.url), 'utf8')
);
const client = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const { token } = await client.getAccessToken();

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
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

const values = async (range) =>
  (await api(`/values/${encodeURIComponent(range)}`)).values ?? [];

const meta = await api('?fields=sheets.properties');
const tab = meta.sheets.find((s) => s.properties.title === TAB);
if (!tab) {
  console.error(`REFUSING: there is no "${TAB}" tab. Run scripts/migrate-131-daily-summary-tab.mjs first.`);
  process.exit(1);
}

const same = (a, b) => a.length === b.length && a.every((h, i) => h === b[i]);
const header = (await values(`${TAB}!1:1`))[0] ?? [];

if (same(header, HEADERS)) {
  console.log(`skip   "${TAB}" already has the A1:T1 header`);
  console.log('\nNothing to do — migration already applied.');
  process.exit(0);
}
if (!same(header, BEFORE)) {
  console.error(
    `REFUSING: "${TAB}"'s header is not #131's A:R.\n` +
    `  found:    ${header.join(', ') || '(empty)'}\n` +
    `  expected: ${BEFORE.join(', ')}\n` +
    'Inspect it by hand. This script will not rewrite a header it does not recognize.'
  );
  process.exit(1);
}

const columns = tab.properties.gridProperties?.columnCount ?? 0;
const add = Math.max(0, HEADERS.length - columns);
console.log(`grid   ${columns} columns`);
if (add) console.log(`plan   add ${add} column(s) to the grid (${columns} -> ${HEADERS.length})`);
console.log(`plan   write S1:T1: ${ADDED.join(', ')}`);

if (DRY_RUN) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
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
  console.log(`wrote  ${add} column(s)`);
}

await api(`/values/${encodeURIComponent(`${TAB}!S1:T1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  body: JSON.stringify({ values: [ADDED] }),
});
console.log('wrote  S1:T1');

const after = (await values(`${TAB}!1:1`))[0] ?? [];
console.log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
console.log(
  '\nS and T are blank on every existing row until the rebuild. Deploy the API, then run:\n' +
  '  THRIVE_API_URL=... THRIVE_API_KEY=... node scripts/backfill-131-daily-summary.mjs --restart'
);
