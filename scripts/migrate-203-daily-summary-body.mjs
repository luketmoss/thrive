#!/usr/bin/env node
/**
 * migrate-203-daily-summary-body.mjs — One-time sheet migration for #203.
 *
 * Adds columns U, `weight_kg`, V, `fat_ratio_pct`, W, `systolic_mmhg`, X,
 * `diastolic_mmhg`, and Y, `bp_count`, to the `DailySummary` tab: the day's
 * morning weight and body fat, and its mean blood pressure with the count of
 * readings behind it, both rolled up from `BodyMeasurements` (#198).
 *
 * They are **appended**, not placed near any related column: almanac
 * (luketmoss/keel) reads this tab by column, and no letter A:T may move.
 *
 * Run it **before** deploying the API version that writes 25 columns. That
 * version rewrites a row with `getRange(row, 1, 1, 25).setValues`, which fails
 * on a 20-column grid. The old version keeps writing A:T and leaves U:Y
 * blank, so running this while it is live is safe (the `migrate-181` rule).
 *
 * Idempotency: the header is the guard. A tab whose header is already A:Y is
 * left alone. A header other than #181's A:T, or A:Y, is refused, never
 * rewritten.
 *
 * Usage:
 *   node scripts/migrate-203-daily-summary-body.mjs --dry-run
 *   node scripts/migrate-203-daily-summary-body.mjs
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const TAB = 'DailySummary';

/**
 * A:Y. Must stay in step with DAILY_SUMMARY_FIELDS in
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
  'weight_kg',             // U  #203
  'fat_ratio_pct',         // V  #203
  'systolic_mmhg',         // W  #203
  'diastolic_mmhg',        // X  #203
  'bp_count',              // Y  #203
];
const BEFORE = HEADERS.slice(0, 20);
const ADDED = HEADERS.slice(20);

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
  console.log(`skip   "${TAB}" already has the A1:Y1 header`);
  console.log('\nNothing to do — migration already applied.');
  process.exit(0);
}
if (!same(header, BEFORE)) {
  console.error(
    `REFUSING: "${TAB}"'s header is not #181's A:T.\n` +
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
console.log(`plan   write U1:Y1: ${ADDED.join(', ')}`);

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

await api(`/values/${encodeURIComponent(`${TAB}!U1:Y1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  body: JSON.stringify({ values: [ADDED] }),
});
console.log('wrote  U1:Y1');

const after = (await values(`${TAB}!1:1`))[0] ?? [];
console.log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
console.log(
  '\nU:Y are blank on every existing row until the rebuild. Deploy the API, then run:\n' +
  '  THRIVE_API_URL=... THRIVE_API_KEY=... node scripts/backfill-131-daily-summary.mjs --restart'
);
