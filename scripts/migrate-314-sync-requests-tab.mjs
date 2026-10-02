/**
 * migrate-314-sync-requests-tab.mjs — One-time sheet migration for issue #314.
 *
 * Creates the `SyncRequests` tab and writes its frozen A1:I1 header row: one
 * row per vendor per "Sync now" press. The SPA appends A-E (#315); the Apps
 * Script poller, `pollSyncRequests` (apps-script/src/sync-requests.js), writes
 * every later value in E-I.
 *
 * Additive only: it creates one tab and one header row, and never touches
 * another tab or any existing row.
 *
 * Idempotency: the tab's existence is the guard. A second run finds it with the
 * expected header and exits without writing. A tab with any other header is
 * refused, never rewritten: this script does not own rows it did not create.
 *
 * No shebang line: vitest imports this file for its test, and a `#!` line
 * checked out with CRLF endings does not parse. Run it with `node`.
 *
 * Usage:
 *   node scripts/migrate-314-sync-requests-tab.mjs --dry-run
 *   node scripts/migrate-314-sync-requests-tab.mjs
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';

export const TAB = 'SyncRequests';

/**
 * A:I. Must stay in step with SYNC_REQUEST_FIELDS in apps-script/src/types.js
 * and SYNC_REQUEST_FIELDS in frontend/src/api/sync-requests-api.ts.
 */
export const HEADERS = [
  'request_id',      // A  sr_ + 8 hex, written by the SPA
  'vendor',          // B  coros | withings
  'requested_at',    // C  ISO 8601 instant, UTC
  'requested_by',    // D  the signed-in email; may be blank
  'status',          // E  requested, then the poller's values
  'workflow_run_id', // F  GitHub's run id, blank until dispatched
  'dispatched_at',   // G  ISO instant GitHub accepted the dispatch
  'finished_at',     // H  ISO instant the poller recorded a final status
  'detail',          // I  words; blank while requested / started
];

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
  const existing = meta.sheets.find((s) => s.properties.title === TAB);

  log(`Tabs: ${meta.sheets.map((s) => s.properties.title).join(', ')}\n`);

  if (existing) {
    const header = (await values(`${TAB}!1:1`))[0] ?? [];
    const matches =
      header.length === HEADERS.length && HEADERS.every((h, i) => header[i] === h);

    if (matches) {
      log(`skip   "${TAB}" already exists with the expected A1:I1 header`);
      log('\nNothing to do — migration already applied.');
      return 0;
    }

    error(
      `REFUSING: "${TAB}" exists but its header is not the expected one.\n` +
      `  found:    ${header.join(', ') || '(empty)'}\n` +
      `  expected: ${HEADERS.join(', ')}\n` +
      'Inspect it by hand. This script will not rewrite a tab it did not create.'
    );
    return 1;
  }

  log(`plan   create tab "${TAB}"`);
  log(`plan   write A1:I1: ${HEADERS.join(', ')}`);

  if (dryRun) {
    log('\n--dry-run: nothing written.');
    return 0;
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
  log(`wrote  tab "${TAB}"`);

  await api(`/values/${encodeURIComponent(`${TAB}!A1:I1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADERS] }),
  });
  log('wrote  headers A1:I1');

  const after = (await values(`${TAB}!1:1`))[0] ?? [];
  log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
  log('\nThe tab is empty. The SPA appends requests (#315); pollSyncRequests answers them.');
  return 0;
}

async function main() {
  const { JWT } = await import('google-auth-library');
  const creds = JSON.parse(
    readFileSync(new URL('../mcp-server/thrive-sa.json', import.meta.url), 'utf8')
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
