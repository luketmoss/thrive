#!/usr/bin/env node
/**
 * migrate-100-drop-dead-columns.mjs — One-time sheet migration for issue #100.
 *
 * Deletes the empty `Config` tab, `Sets!K "Notes"`, and `Templates!I/J`
 * "Created"/"Updated". Run this only AFTER the #100 code is deployed: new code
 * reading `A:J` against an 11-column sheet is safe, whereas old code appending
 * 11 values to a 10-column sheet would silently recreate the removed column.
 *
 * Idempotent by header guard — each deletion is skipped if the column is
 * already gone, so a second run is a no-op rather than eating a live column.
 *
 * Usage:
 *   node scripts/migrate-100-drop-dead-columns.mjs --dry-run
 *   node scripts/migrate-100-drop-dead-columns.mjs
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const DRY_RUN = process.argv.includes('--dry-run');
const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

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

const col = (i) => String.fromCharCode(65 + i);

const meta = await api('?fields=sheets.properties');
const tabs = new Map(meta.sheets.map((s) => [s.properties.title, s.properties]));

const headerOf = async (title) => {
  const r = await api(`/values/${encodeURIComponent(`${title}!1:1`)}`);
  return r.values?.[0] ?? [];
};

const requests = [];
const plan = [];
const skipped = [];

// --- Config tab -----------------------------------------------------
const config = tabs.get('Config');
if (!config) {
  skipped.push('Config tab already deleted');
} else {
  // Guard: refuse to drop a tab that has grown data since the issue was written.
  const rows = await api(`/values/${encodeURIComponent('Config!A2:B')}`);
  const dataRows = rows.values?.length ?? 0;
  if (dataRows > 0) {
    console.error(`REFUSING: Config has ${dataRows} data row(s); #100 asserts it is empty.`);
    process.exit(1);
  }
  requests.push({ deleteSheet: { sheetId: config.sheetId } });
  plan.push('delete tab  Config (0 data rows)');
}

// --- Column deletions ------------------------------------------------
// Right-to-left within a tab so earlier indices stay valid.
for (const [title, expected] of [
  ['Sets', [['Notes', 10]]],
  ['Templates', [['Updated', 9], ['Created', 8]]],
]) {
  const header = await headerOf(title);
  for (const [name, index] of expected) {
    if (header[index] === name) {
      requests.push({
        deleteDimension: {
          range: { sheetId: tabs.get(title).sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
        },
      });
      plan.push(`delete col  ${title}!${col(index)} "${name}"`);
    } else if (header[index] === undefined) {
      skipped.push(`${title}!${col(index)} "${name}" already deleted`);
    } else {
      console.error(
        `REFUSING: expected ${title}!${col(index)} to be "${name}", found "${header[index]}". ` +
          'The sheet does not match what #100 describes.',
      );
      process.exit(1);
    }
  }
}

for (const s of skipped) console.log(`skip        ${s}`);
for (const p of plan) console.log(p);

if (requests.length === 0) {
  console.log('\nNothing to do — migration already applied.');
  process.exit(0);
}
if (DRY_RUN) {
  console.log(`\n--dry-run: ${requests.length} request(s) not sent.`);
  process.exit(0);
}

await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
console.log(`\nApplied ${requests.length} request(s).`);

// --- Verify ----------------------------------------------------------
const after = await api('?fields=sheets.properties');
console.log('\nTabs now:', after.sheets.map((s) => s.properties.title).join(', '));
for (const t of ['Sets', 'Templates']) {
  console.log(`${t} header:`, (await headerOf(t)).join(', '));
}
