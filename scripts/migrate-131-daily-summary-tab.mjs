#!/usr/bin/env node
/**
 * migrate-131-daily-summary-tab.mjs — One-time sheet migration for issue #131.
 *
 * Creates the `DailySummary` tab and writes its A1:R1 header row.
 *
 * The tab is **derived, never authoritative**: every row is rebuildable from
 * `Workouts` + `DailyHealth` by the API's `rebuildDailySummary` action. This
 * script only creates the container — `scripts/backfill-131-daily-summary.mjs`
 * fills it.
 *
 * Idempotency: the tab's existence is the guard. A second run finds it and
 * exits without writing. It never deletes or rewrites an existing tab, since
 * doing so would discard rows a backfill had already placed — and while those
 * rows are rebuildable, silently throwing them away is not this script's
 * decision to make.
 *
 * Usage:
 *   node scripts/migrate-131-daily-summary-tab.mjs --dry-run
 *   node scripts/migrate-131-daily-summary-tab.mjs
 */

import { JWT } from '../mcp-server/node_modules/google-auth-library/build/src/index.js';
import { readFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const TAB = 'DailySummary';

/**
 * A:R. Must stay in step with DAILY_SUMMARY_FIELDS in
 * apps-script/src/types.js — the API writes rows in this order.
 *
 * Coverage (H-J) sits beside the totals it qualifies rather than appended at
 * the end: a sum over nullable fields is incomplete information without it.
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
];

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
const existing = meta.sheets.find((s) => s.properties.title === TAB);

console.log(`Tabs: ${meta.sheets.map((s) => s.properties.title).join(', ')}\n`);

if (existing) {
  const header = (await values(`${TAB}!1:1`))[0] ?? [];
  const matches =
    header.length === HEADERS.length && HEADERS.every((h, i) => header[i] === h);

  if (matches) {
    console.log(`skip   "${TAB}" already exists with the expected A1:R1 header`);
    console.log('\nNothing to do — migration already applied.');
    process.exit(0);
  }

  console.error(
    `REFUSING: "${TAB}" exists but its header is not the expected one.\n` +
    `  found:    ${header.join(', ') || '(empty)'}\n` +
    `  expected: ${HEADERS.join(', ')}\n` +
    'Inspect it by hand. This script will not rewrite a tab it did not create.'
  );
  process.exit(1);
}

console.log(`plan   create tab "${TAB}"`);
console.log(`plan   write A1:R1: ${HEADERS.join(', ')}`);

if (DRY_RUN) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

await api(':batchUpdate', {
  method: 'POST',
  body: JSON.stringify({
    requests: [{
      addSheet: {
        properties: {
          title: TAB,
          gridProperties: { rowCount: 1000, columnCount: HEADERS.length, frozenRowCount: 1 },
        },
      },
    }],
  }),
});
console.log(`wrote  tab "${TAB}"`);

await api(`/values/${encodeURIComponent(`${TAB}!A1:R1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  body: JSON.stringify({ values: [HEADERS] }),
});
console.log('wrote  headers A1:R1');

const after = (await values(`${TAB}!1:1`))[0] ?? [];
console.log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
console.log(
  '\nThe tab is empty. Fill it with:\n' +
  '  THRIVE_API_URL=... THRIVE_API_KEY=... node scripts/backfill-131-daily-summary.mjs --dry-run'
);
