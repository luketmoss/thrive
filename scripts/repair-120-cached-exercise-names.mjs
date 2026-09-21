#!/usr/bin/env node
/**
 * repair-120-cached-exercise-names.mjs — One-time data repair for issue #120.
 *
 * `Templates!E` and `Sets!C` cache the exercise name beside its id. Renames
 * made through the app or the MCP server cascade to both, but edits made
 * directly in the Exercises tab don't, so some cached names went stale. This
 * rewrites every stale cached name from the library entry for the row's id.
 *
 * Rows whose id isn't in the library at all are reported, never touched: there
 * is no correct name to write, and guessing one by name would silently fuse
 * or split training history.
 *
 * Dry run by default. Re-running after --apply reports 0 changes.
 *
 * Usage:
 *   node scripts/repair-120-cached-exercise-names.mjs           # report only
 *   node scripts/repair-120-cached-exercise-names.mjs --apply   # write
 */

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';
import { findStaleExerciseNames } from '../mcp-server/domain.js';

const APPLY = process.argv.includes('--apply');
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
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.status}: ${body.error.message}`);
  return body;
}

const values = async (range) => (await api(`/values/${encodeURIComponent(range)}`)).values ?? [];

/** Every cached-name cell, tagged with where it lives and a label for the report. */
async function scan() {
  const [exerciseRows, templateRows, setRows] = await Promise.all([
    values('Exercises!A2:B'), values('Templates!A2:H'), values('Sets!A2:J'),
  ]);
  const exercises = exerciseRows.map((r) => ({ id: r[0] || '', name: r[1] || '' }));
  const rows = [
    ...templateRows.map((r, i) => ({
      cell: `Templates!E${i + 2}`, label: r[1] || r[0], exercise_id: r[3] || '', exercise_name: r[4] || '',
    })),
    ...setRows.map((r, i) => ({
      cell: `Sets!C${i + 2}`, label: r[0], exercise_id: r[1] || '', exercise_name: r[2] || '',
    })),
  ];
  return { ...findStaleExerciseNames(rows, exercises), total: rows.length };
}

const { stale, orphans, total } = await scan();
console.log(`Scanned ${total} cached exercise names (Templates!E, Sets!C).\n`);

for (const { row, name } of stale) {
  console.log(`stale   ${row.cell.padEnd(14)} [${row.label}]  "${row.exercise_name}" -> "${name}"`);
}
for (const row of orphans) {
  console.log(`orphan  ${row.cell.padEnd(14)} [${row.label}]  "${row.exercise_name}" (${row.exercise_id || 'no id'}) — not in library, left alone`);
}
console.log(`\n${stale.length} stale, ${orphans.length} orphaned.`);

if (!stale.length) {
  console.log('Nothing to repair.');
  process.exit(0);
}
if (!APPLY) {
  console.log('Dry run — nothing written. Re-run with --apply to rewrite the stale names.');
  process.exit(0);
}

await api('/values:batchUpdate', {
  method: 'POST',
  body: JSON.stringify({
    valueInputOption: 'RAW',
    data: stale.map(({ row, name }) => ({ range: row.cell, values: [[name]] })),
  }),
});
console.log(`wrote   ${stale.length} cells in one batch`);

const after = await scan();
console.log(`verify  ${after.stale.length} stale remaining`);
process.exit(after.stale.length ? 1 : 0);
