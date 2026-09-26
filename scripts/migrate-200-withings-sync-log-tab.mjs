#!/usr/bin/env node
/**
 * migrate-200-withings-sync-log-tab.mjs — One-time sheet migration for issue #200.
 *
 * Creates the `WithingsSyncLog` tab and writes its A1:N1 header row, identical
 * to SyncLog's: one row per Withings sync run, appended by
 * sync/withings-run.mjs through the API's `appendSyncLog` with
 * `log: "withings"`. A separate tab, not a source column on SyncLog, so nothing
 * that reads SyncLog (COROS's watchdog, the Settings line, the FIT budget) can
 * see a Withings run.
 *
 * Idempotency: the tab's existence is the guard. A second run finds it with the
 * expected header and exits without writing. A tab with any other header is
 * refused, never rewritten: this script does not own rows it did not create.
 *
 * Run it BEFORE the first scheduled Withings run: appendSyncLog refuses to
 * write to a tab that does not exist, and the watchdog reads an absent tab as
 * unreadable.
 *
 * Usage:
 *   node scripts/migrate-200-withings-sync-log-tab.mjs --dry-run
 *   node scripts/migrate-200-withings-sync-log-tab.mjs
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';

export const TAB = 'WithingsSyncLog';

/**
 * A:N, exactly SyncLog's. Must stay in step with SYNC_LOG_FIELDS in
 * apps-script/src/types.js, which the API writes both tabs by;
 * apps-script/tests/withings-sync-log.test.ts holds the lists together.
 */
export const HEADERS = [
  'run_id',        // A
  'started_at',    // B
  'finished_at',   // C
  'window_start',  // D  local date, D - 30
  'window_end',    // E  local date, D + 1
  'n_seen',        // F  measure groups fetched
  'n_new',         // G  BodyMeasurements rows appended
  'n_updated',     // H  BodyMeasurements rows changed
  'n_enriched',    // I  always 0 for Withings
  'n_fit_fetched', // J  always 0 for Withings
  'n_errors',      // K
  'status',        // L  ok | partial | failed
  'error_detail',  // M
  'notes',         // N  unattributed groups skipped
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
      log(`skip   "${TAB}" already exists with the expected A1:N1 header`);
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
  log(`plan   write A1:N1: ${HEADERS.join(', ')}`);

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

  await api(`/values/${encodeURIComponent(`${TAB}!A1:N1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADERS] }),
  });
  log('wrote  headers A1:N1');

  const after = (await values(`${TAB}!1:1`))[0] ?? [];
  log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
  log('\nThe tab is empty. Each Withings sync run (sync/withings-run.mjs) appends one row.');
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
