#!/usr/bin/env node
/**
 * migrate-101-elapsed-seconds.mjs — One-time sheet migration for issue #101.
 *
 * Two changes to the `Workouts` tab:
 *   1. Appends six nullable columns: L "Moving (s)", M "Effort",
 *      N "Distance (m)", O "Ascent (m)", P "Descent (m)", Q "Avg HR (bpm)".
 *   2. Repurposes H in place: every non-empty value is multiplied by 60 and
 *      the header becomes "Elapsed (s)".
 *
 * AC2: the ×60 pass is guarded by the H1 header. A second run detects
 * "Elapsed (s)" and refuses — running ×60 twice would turn 35 min into
 * 126,000 s and is unrecoverable without the backup.
 *
 * Deploy and migrate in one sitting, with no workout in progress: while the
 * sheet holds minutes and the code reads seconds (or the reverse) every
 * duration mis-renders.
 *
 * Usage:
 *   node scripts/migrate-101-elapsed-seconds.mjs --dry-run
 *   node scripts/migrate-101-elapsed-seconds.mjs
 */

import { JWT } from 'google-auth-library';
import { readFileSync, writeFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

const NEW_COLUMNS = [
  'Moving (s)', 'Effort', 'Distance (m)', 'Ascent (m)', 'Descent (m)', 'Avg HR (bpm)',
];
const OLD_HEADER = 'Duration (min)';
const NEW_HEADER = 'Elapsed (s)';

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

// --- Guard: the ×60 pass must never run twice -----------------------
const h1 = header[7];
const alreadyMigrated = h1 === NEW_HEADER;
if (!alreadyMigrated && h1 !== OLD_HEADER) {
  console.error(`REFUSING: expected H1 to be "${OLD_HEADER}" or "${NEW_HEADER}", found "${h1}".`);
  process.exit(1);
}

// --- 1. The six new columns -----------------------------------------
const missing = NEW_COLUMNS.filter((name, i) => header[11 + i] !== name);
if (missing.length === 0) {
  console.log('skip   all six attribute columns already present');
} else if (header.length > 11 && header.slice(11).some(Boolean)) {
  console.error(`REFUSING: columns past K are not the expected ones: ${header.slice(11).join(', ')}`);
  process.exit(1);
} else {
  console.log(`plan   add columns L-Q: ${NEW_COLUMNS.join(', ')}`);
}

// --- 2. The ×60 pass -------------------------------------------------
const rows = await values('Workouts!H2:H');
const converted = rows.map(([v]) => {
  if (v === undefined || String(v).trim() === '') return [''];
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(`REFUSING: non-numeric duration ${JSON.stringify(v)} in column H.`);
    process.exit(1);
  }
  return [String(Math.round(n * 60))];
});
const nonEmpty = converted.filter(([v]) => v !== '').length;

if (alreadyMigrated) {
  console.log(`skip   H already reads "${NEW_HEADER}" — the ×60 pass will NOT run again`);
} else {
  console.log(`plan   multiply ${nonEmpty} of ${rows.length} H values by 60, rename H1 to "${NEW_HEADER}"`);
  const sample = rows.slice(0, 3).map(([v], i) => `${v || '(empty)'} -> ${converted[i][0] || '(empty)'}`);
  console.log(`       e.g. ${sample.join(' | ')}`);
}

if (alreadyMigrated && missing.length === 0) {
  console.log('\nNothing to do — migration already applied.');
  process.exit(0);
}
if (DRY_RUN) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

// --- Back up column H before overwriting it -------------------------
if (!alreadyMigrated) {
  const backup = `scripts/.migrate-101-backup-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify({ header, H: rows }, null, 1));
  console.log(`\nbackup ${backup}`);
}

// --- Apply ------------------------------------------------------------
if (missing.length > 0) {
  const gridCols = sheet.properties.gridProperties.columnCount;
  if (gridCols < 17) {
    await api(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          appendDimension: { sheetId: sheet.properties.sheetId, dimension: 'COLUMNS', length: 17 - gridCols },
        }],
      }),
    });
  }
  await api(`/values/${encodeURIComponent('Workouts!L1:Q1')}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [NEW_COLUMNS] }),
  });
  console.log('wrote  headers L1:Q1');
}

if (!alreadyMigrated) {
  if (converted.length > 0) {
    await api(`/values/${encodeURIComponent(`Workouts!H2:H${converted.length + 1}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: converted }),
    });
  }
  // Header last: it is the guard, so it must only flip once the data is in.
  await api(`/values/${encodeURIComponent('Workouts!H1')}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[NEW_HEADER]] }),
  });
  console.log(`wrote  ${nonEmpty} converted durations and the "${NEW_HEADER}" header`);
}

// --- Verify -----------------------------------------------------------
const after = (await values('Workouts!1:1'))[0] ?? [];
console.log(`\nWorkouts header is now ${after.length} columns:\n  ${after.join(', ')}`);
const sampleAfter = (await values('Workouts!A2:H4')).map((r) => `${r[1]} ${r[4]}: H=${r[7] || '(empty)'}`);
console.log('Sample rows:\n  ' + sampleAfter.join('\n  '));
