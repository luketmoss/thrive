#!/usr/bin/env node
/**
 * migrate-145-estimated-seconds.mjs — One-time sheet migration for issue #145.
 *
 * Adds column AA, `estimated_seconds`, to the `Workouts` tab: how long a
 * planned session is meant to take, in seconds. Nullable, so every existing
 * row's AA stays blank. #128 left the grid at 26 columns, and a write to AA on
 * a 26-column grid fails ("exceeds grid limits"), so the grid is widened
 * first, then AA1 is written. Nothing else is touched: no data row is read
 * back out and rewritten.
 *
 * Run it before deploying the API version that reads A:AA, and before the SPA
 * that does: both address AA, and both fail on a grid without it.
 *
 * Idempotency: the header is the guard. A tab whose header already ends in
 * `estimated_seconds` at AA is left alone. A tab whose header is not #128's
 * A:Z, or anything past Z that is not exactly `estimated_seconds`, is refused,
 * never rewritten.
 *
 * Usage:
 *   node scripts/migrate-145-estimated-seconds.mjs --dry-run
 *   node scripts/migrate-145-estimated-seconds.mjs
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const TAB = 'Workouts';
const NEW_HEADER = 'estimated_seconds';  // AA — WORKOUT_FIELDS[26] in apps-script/src/types.js
const LAST_OLD_HEADER = 'calories';      // Z, from #128
const TOTAL_COLUMNS = 27;                // A:AA

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
  console.error(`REFUSING: there is no "${TAB}" tab.`);
  process.exit(1);
}

const header = (await values(`${TAB}!1:1`))[0] ?? [];
const columns = tab.properties.gridProperties?.columnCount ?? 0;
console.log(`"${TAB}" header is ${header.length} columns, grid is ${columns} wide.`);

if (header[25] !== LAST_OLD_HEADER) {
  console.error(
    `REFUSING: expected Z1 to be "${LAST_OLD_HEADER}", found "${header[25] ?? '(empty)'}".\n` +
    'Run scripts/migrate-128-workouts-a-to-z.mjs first, or inspect the tab by hand.'
  );
  process.exit(1);
}

if (header.length === TOTAL_COLUMNS && header[26] === NEW_HEADER && columns >= TOTAL_COLUMNS) {
  console.log(`skip   AA1 is already "${NEW_HEADER}"`);
  console.log('\nNothing to do — migration already applied.');
  process.exit(0);
}
if (header.length > 26 && !(header.length === TOTAL_COLUMNS && header[26] === NEW_HEADER)) {
  console.error(
    `REFUSING: "${TAB}" has columns past Z that are not the expected one: ${header.slice(26).join(', ')}\n` +
    'This script will not rewrite a header it does not recognize.'
  );
  process.exit(1);
}

// Blank AA on every data row is the whole backfill; confirm nothing is there.
const lastRow = (await values(`${TAB}!A:A`)).length;
const occupied = (await values(`${TAB}!AA2:AA`).catch(() => [])).filter((r) => (r[0] ?? '') !== '');
if (occupied.length) {
  console.error(`REFUSING: ${occupied.length} data row(s) already hold a value in AA. Inspect them by hand.`);
  process.exit(1);
}

const add = Math.max(0, TOTAL_COLUMNS - columns);
if (add) console.log(`plan   add ${add} column(s) to the grid (${columns} -> ${TOTAL_COLUMNS})`);
if (header[26] !== NEW_HEADER) console.log(`plan   write AA1: ${NEW_HEADER}`);
console.log(`       ${Math.max(0, lastRow - 1)} existing rows keep a blank AA — nobody estimated them`);

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

if (header[26] !== NEW_HEADER) {
  await api(`/values/${encodeURIComponent(`${TAB}!AA1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[NEW_HEADER]] }),
  });
  console.log('wrote  AA1');
}

const after = (await values(`${TAB}!1:1`))[0] ?? [];
const metaAfter = await api('?fields=sheets.properties');
const colsAfter = metaAfter.sheets.find((s) => s.properties.title === TAB).properties.gridProperties.columnCount;
console.log(`\n"${TAB}" header is now ${after.length} columns (grid ${colsAfter} wide); Z1..AA1 = ${after.slice(25).join(', ')}`);
