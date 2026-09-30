#!/usr/bin/env node
/**
 * migrate-233-journal-tab.mjs — One-time sheet migration for issue #233.
 *
 * Creates the `Journal` tab and writes its A1:D1 header row: one free-text
 * note per local day, keyed by `date`. The SPA reads and writes it directly
 * (frontend/src/api/journal-api.ts); the API actions arrive with #234.
 *
 * Additive only: it creates one tab and one header row, and never touches
 * another tab or any existing row.
 *
 * Idempotency: the tab's existence is the guard. A second run finds it with the
 * expected header and exits without writing. A tab with any other header is
 * refused, never rewritten: this script does not own rows it did not create.
 *
 * Usage:
 *   node scripts/migrate-233-journal-tab.mjs --dry-run
 *   node scripts/migrate-233-journal-tab.mjs
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';

export const TAB = 'Journal';

/**
 * A:D. Must stay in step with JOURNAL_FIELDS in apps-script/src/types.js and
 * JOURNAL_FIELDS in frontend/src/api/journal-api.ts.
 */
export const HEADERS = [
  'date',    // A  local YYYY-MM-DD, the key: one row per day
  'note',    // B  free text, never blank (a cleared note deletes its row)
  'created', // C  ISO 8601, set on first write and kept
  'updated', // D  ISO 8601, set on every write
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
      log(`skip   "${TAB}" already exists with the expected A1:D1 header`);
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
  log(`plan   write A1:D1: ${HEADERS.join(', ')}`);

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

  await api(`/values/${encodeURIComponent(`${TAB}!A1:D1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADERS] }),
  });
  log('wrote  headers A1:D1');

  const after = (await values(`${TAB}!1:1`))[0] ?? [];
  log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
  log('\nThe tab is empty. The SPA writes notes to it.');
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
