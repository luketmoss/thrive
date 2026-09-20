#!/usr/bin/env node
/**
 * migrate-128-workouts-a-to-z.mjs — One-time sheet migration for issue #128.
 *
 * Two changes to the `Workouts` tab, both additive:
 *   1. Appends nine nullable columns, R through Z: sub_type, source,
 *      source_activity_id, raw_ref, fit_ref, fit_fetched_at, synced_at,
 *      started_at_utc, calories.
 *   2. Backfills `started_at_utc` (Y) on existing rows from `Date` (B) and
 *      `Time` (C), applying the `America/Denver` offset *for that row's own
 *      date* — a history spanning January and July crosses MST and MDT.
 *
 * Nothing in A:Q is read back out and rewritten: the only writes are R1:Z1
 * and column Y. A row with a blank `Time` keeps a blank `started_at_utc`;
 * midnight is not assumed (AC5).
 *
 * Idempotency (AC1): R1 is the guard. A second run finds it populated and
 * exits without writing. The backfill is separately guarded per row — an
 * already-filled Y is left alone, so a partial run is safe to resume.
 *
 * Usage:
 *   node scripts/migrate-128-workouts-a-to-z.mjs --dry-run
 *   node scripts/migrate-128-workouts-a-to-z.mjs
 */

import { JWT } from '../mcp-server/node_modules/google-auth-library/build/src/index.js';
import { readFileSync } from 'node:fs';
import { startedAtUtc } from '../mcp-server/domain.js';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const NEW_COLUMNS = [
  'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref',
  'fit_fetched_at', 'synced_at', 'started_at_utc', 'calories',
];
const LAST_OLD_HEADER = 'Avg HR (bpm)';   // Q, from #101
const TOTAL_COLUMNS = 26;                 // A:Z
const STARTED_AT_INDEX = 24;              // Y, zero-based

const creds = JSON.parse(readFileSync(new URL('../mcp-server/thrive-sa.json', import.meta.url), 'utf8'));
const client = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const { token } = await client.getAccessToken();

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.status}: ${body.error.message}`);
  return body;
}

const values = async (range) => (await api(`/values/${encodeURIComponent(range)}`)).values ?? [];

const meta = await api('?fields=sheets.properties');
const sheet = meta.sheets.find((s) => s.properties.title === 'Workouts');
if (!sheet) throw new Error('No Workouts tab found.');

const header = (await values('Workouts!1:1'))[0] ?? [];
console.log(`Workouts header is ${header.length} columns: ${header.join(', ')}\n`);

// --- Guard: the tab must be the A:Q shape #101 left behind ----------
if (header[16] !== LAST_OLD_HEADER) {
  console.error(`REFUSING: expected Q1 to be "${LAST_OLD_HEADER}", found "${header[16]}".`);
  console.error('Run scripts/migrate-101-elapsed-seconds.mjs first.');
  process.exit(1);
}

// --- 1. The nine new columns ----------------------------------------
const headersPresent = NEW_COLUMNS.every((name, i) => header[17 + i] === name);
if (headersPresent) {
  console.log('skip   all nine columns R-Z already present');
} else if (header.length > 17 && header.slice(17).some(Boolean)) {
  console.error(`REFUSING: columns past Q are not the expected ones: ${header.slice(17).join(', ')}`);
  process.exit(1);
} else {
  console.log(`plan   add columns R-Z: ${NEW_COLUMNS.join(', ')}`);
}

// --- 2. The started_at_utc backfill ---------------------------------
// B, C and Y only. A:Q is never rewritten — it is read to decide, not to
// echo back, so no existing cell can be disturbed by this script.
const rows = await values('Workouts!A2:Z');
const backfill = [];
let alreadyFilled = 0;
let noTime = 0;

rows.forEach((row, i) => {
  const sheetRow = i + 2;
  const existing = row[STARTED_AT_INDEX] || '';
  if (existing !== '') { alreadyFilled += 1; return; }

  const instant = startedAtUtc(row[1], row[2]);
  if (instant === '') {
    // AC5: a date with no time has no instant. Leave Y blank.
    if ((row[0] || '') !== '') noTime += 1;
    return;
  }
  backfill.push({ sheetRow, instant, date: row[1], time: row[2] });
});

console.log(`plan   backfill started_at_utc on ${backfill.length} of ${rows.length} rows`);
if (alreadyFilled) console.log(`       ${alreadyFilled} already had a value and are left alone`);
if (noTime) console.log(`       ${noTime} have no Time and stay blank — midnight is not assumed`);
if (backfill.length > 0) {
  const sample = backfill.slice(0, 3).map((b) => `${b.date} ${b.time} -> ${b.instant}`);
  console.log(`       e.g. ${sample.join(' | ')}`);
}

if (headersPresent && backfill.length === 0) {
  console.log('\nNothing to do — migration already applied.');
  process.exit(0);
}
if (DRY_RUN) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

// --- Apply ----------------------------------------------------------
if (!headersPresent) {
  const gridCols = sheet.properties.gridProperties.columnCount;
  if (gridCols < TOTAL_COLUMNS) {
    await api(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          appendDimension: {
            sheetId: sheet.properties.sheetId,
            dimension: 'COLUMNS',
            length: TOTAL_COLUMNS - gridCols,
          },
        }],
      }),
    });
  }
  await api(`/values/${encodeURIComponent('Workouts!R1:Z1')}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [NEW_COLUMNS] }),
  });
  console.log('wrote  headers R1:Z1');
}

if (backfill.length > 0) {
  // One batch, addressing each row individually: the rows needing a value are
  // not contiguous, and a contiguous Y2:Y<n> write would blank the ones that
  // already have one.
  await api('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: backfill.map((b) => ({ range: `Workouts!Y${b.sheetRow}`, values: [[b.instant]] })),
    }),
  });
  console.log(`wrote  ${backfill.length} started_at_utc values`);
}

// --- Verify -----------------------------------------------------------
const after = (await values('Workouts!1:1'))[0] ?? [];
console.log(`\nWorkouts header is now ${after.length} columns:\n  ${after.join(', ')}`);
const sampleAfter = (await values('Workouts!A2:Z4'))
  .map((r) => `${r[1]} ${r[2] || '(no time)'} ${r[4]}: Y=${r[STARTED_AT_INDEX] || '(empty)'}`);
console.log('Sample rows:\n  ' + sampleAfter.join('\n  '));
