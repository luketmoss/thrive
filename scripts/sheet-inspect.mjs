#!/usr/bin/env node
/**
 * sheet-inspect.mjs — Read-only structural view of the Groundwork sheet, plus
 * an optional reversible write probe.
 *
 * The migrations in #100 and #101 add and delete columns, which is a
 * spreadsheets.batchUpdate call rather than a values write. This confirms the
 * service account can actually make structural changes before a migration
 * depends on it.
 *
 * Usage:
 *   node scripts/sheet-inspect.mjs              # list tabs + header rows
 *   node scripts/sheet-inspect.mjs --probe      # also add and delete a temp tab
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const PROBE = process.argv.includes('--probe');
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
const auth = { Authorization: `Bearer ${token}` };

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...auth, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.status}: ${body.error.message}`);
  return body;
}

const meta = await api('?fields=sheets.properties');

console.log('TABS');
for (const { properties: p } of meta.sheets) {
  console.log(
    `  ${p.title.padEnd(12)} sheetId=${String(p.sheetId).padEnd(12)} ` +
      `cols=${p.gridProperties.columnCount} rows=${p.gridProperties.rowCount}`,
  );
}

const titles = meta.sheets.map((s) => s.properties.title);
const headers = await api(
  `/values:batchGet?${titles.map((t) => `ranges=${encodeURIComponent(`${t}!1:1`)}`).join('&')}`,
);

console.log('\nHEADERS');
for (const [i, r] of headers.valueRanges.entries()) {
  const cells = r.values?.[0] ?? [];
  const labelled = cells.map((c, j) => `${String.fromCharCode(65 + j)}:${c}`);
  console.log(`  ${titles[i]} (${cells.length}) ${labelled.join('  ') || '(empty)'}`);
}

if (PROBE) {
  const add = await api(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: '__probe_tmp__' } } }] }),
  });
  const sheetId = add.replies[0].addSheet.properties.sheetId;
  await api(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
  });
  console.log('\nWRITE PROBE: addSheet + deleteSheet OK — structural writes are available');
}
