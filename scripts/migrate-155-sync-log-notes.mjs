#!/usr/bin/env node
/**
 * migrate-155-sync-log-notes.mjs — One-time sheet migration for issue #155.
 *
 * Adds column N, `notes`, to the `SyncLog` tab: what a run noted that is not
 * a failure, such as a COROS strength session with no hand-logged workout to
 * enrich. #156 created the tab with a 13-column grid, so the column is added
 * to the grid first, then N1 is written.
 *
 * Run it before deploying the API version that writes `notes`.
 *
 * Idempotency: the header is the guard. A tab whose header already ends in
 * `notes` is left alone. A tab whose header is anything other than #156's
 * A:M, or A:N, is refused, never rewritten.
 *
 * Usage:
 *   node scripts/migrate-155-sync-log-notes.mjs --dry-run
 *   node scripts/migrate-155-sync-log-notes.mjs
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const TAB = 'SyncLog';

/**
 * A:N. Must stay in step with SYNC_LOG_FIELDS in apps-script/src/types.js;
 * apps-script/tests/sync-log.test.ts holds the two lists together.
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
  'notes',         // N  #155
];
const BEFORE = HEADERS.slice(0, 13);

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
  console.error(`REFUSING: there is no "${TAB}" tab. Run scripts/migrate-156-sync-log-tab.mjs first.`);
  process.exit(1);
}

const same = (a, b) => a.length === b.length && a.every((h, i) => h === b[i]);
const header = (await values(`${TAB}!1:1`))[0] ?? [];

if (same(header, HEADERS)) {
  console.log(`skip   "${TAB}" already has the A1:N1 header`);
  console.log('\nNothing to do — migration already applied.');
  process.exit(0);
}
if (!same(header, BEFORE)) {
  console.error(
    `REFUSING: "${TAB}"'s header is not #156's A:M.\n` +
    `  found:    ${header.join(', ') || '(empty)'}\n` +
    `  expected: ${BEFORE.join(', ')}\n` +
    'Inspect it by hand. This script will not rewrite a header it does not recognize.'
  );
  process.exit(1);
}

const columns = tab.properties.gridProperties?.columnCount ?? 0;
const add = Math.max(0, HEADERS.length - columns);
if (add) console.log(`plan   add ${add} column(s) to the grid (${columns} -> ${HEADERS.length})`);
console.log('plan   write N1: notes');

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

await api(`/values/${encodeURIComponent(`${TAB}!N1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  body: JSON.stringify({ values: [['notes']] }),
});
console.log('wrote  N1');

const after = (await values(`${TAB}!1:1`))[0] ?? [];
console.log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
