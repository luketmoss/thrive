#!/usr/bin/env node
/**
 * migrate-156-sync-log-tab.mjs — One-time sheet migration for issue #156.
 *
 * Creates the `SyncLog` tab and writes its A1:M1 header row: sync plan §5's
 * layout. The COROS sync appends one row per run, through the API's
 * `appendSyncLog` action; the dead-man's switch reads it through `getSyncLog`.
 *
 * Idempotency: the tab's existence is the guard. A second run finds it with the
 * expected header and exits without writing. A tab with any other header is
 * refused, never rewritten: this script does not own rows it did not create.
 *
 * Usage:
 *   node scripts/migrate-156-sync-log-tab.mjs --dry-run
 *   node scripts/migrate-156-sync-log-tab.mjs
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const TAB = 'SyncLog';

/**
 * A:M. Must stay in step with SYNC_LOG_FIELDS in apps-script/src/types.js,
 * which the API writes rows by; apps-script/tests/sync-log.test.ts holds the
 * two lists together.
 */
const HEADERS = [
  'run_id',        // A
  'started_at',    // B
  'finished_at',   // C
  'window_start',  // D
  'window_end',    // E
  'n_seen',        // F
  'n_new',         // G
  'n_updated',     // H
  'n_enriched',    // I  #155
  'n_fit_fetched', // J  #154
  'n_errors',      // K
  'status',        // L  ok | partial | failed
  'error_detail',  // M
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
    console.log(`skip   "${TAB}" already exists with the expected A1:M1 header`);
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
console.log(`plan   write A1:M1: ${HEADERS.join(', ')}`);

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

await api(`/values/${encodeURIComponent(`${TAB}!A1:M1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  body: JSON.stringify({ values: [HEADERS] }),
});
console.log('wrote  headers A1:M1');

const after = (await values(`${TAB}!1:1`))[0] ?? [];
console.log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
console.log('\nThe tab is empty. Each COROS sync run (sync/run.mjs) appends one row.');
