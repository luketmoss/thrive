#!/usr/bin/env node
/**
 * migrate-198-body-measurements-tab.mjs — One-time sheet migration for issue #198.
 *
 * Creates the `BodyMeasurements` tab and writes its A1:T1 header row: one row
 * per Withings measure group, scale and blood pressure alike, SI units. The
 * Withings sync fills it, through the API's `upsertBodyMeasurements` action.
 *
 * Idempotency: the tab's existence is the guard. A second run finds it with the
 * expected header and exits without writing. A tab with any other header is
 * refused, never rewritten: this script does not own rows it did not create.
 *
 * Run it BEFORE deploying the Apps Script that carries upsertBodyMeasurements:
 * the action refuses to write to a tab that does not exist.
 *
 * Usage:
 *   node scripts/migrate-198-body-measurements-tab.mjs --dry-run
 *   node scripts/migrate-198-body-measurements-tab.mjs
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SPREADSHEET_ID =
  process.env.THRIVE_SPREADSHEET_ID || '1YvFnJsY9KlKmbRZ4CrFc67pFwGgjUpHc_LgMVQm2zeQ';

export const TAB = 'BodyMeasurements';

/**
 * A:T. Must stay in step with BODY_MEASUREMENT_FIELDS in
 * apps-script/src/types.js, which the API writes rows by;
 * apps-script/tests/body-measurements.test.ts holds the two lists together.
 */
export const HEADERS = [
  'grpid',            // A  Withings group ID, the key
  'date',             // B  local YYYY-MM-DD, America/Denver
  'time',             // C  local HH:mm
  'measured_at_utc',  // D  ISO 8601 with the offset then in effect
  'kind',             // E  scale | bp
  'device_model',     // F
  'weight_kg',        // G  type 1
  'fat_ratio_pct',    // H  type 6
  'fat_mass_kg',      // I  type 8
  'fat_free_mass_kg', // J  type 5
  'muscle_mass_kg',   // K  type 76
  'hydration_kg',     // L  type 77
  'bone_mass_kg',     // M  type 88
  'systolic_mmhg',    // N  type 10
  'diastolic_mmhg',   // O  type 9
  'pulse_bpm',        // P  type 11
  'attrib',           // Q
  'source',           // R  always withings
  'raw_ref',          // S  Drive file ID of the group archive file
  'synced_at',        // T
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
      log(`skip   "${TAB}" already exists with the expected A1:T1 header`);
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
  log(`plan   write A1:T1: ${HEADERS.join(', ')}`);

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

  await api(`/values/${encodeURIComponent(`${TAB}!A1:T1`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADERS] }),
  });
  log('wrote  headers A1:T1');

  const after = (await values(`${TAB}!1:1`))[0] ?? [];
  log(`\n"${TAB}" header is now ${after.length} columns:\n  ${after.join(', ')}`);
  log('\nThe tab is empty. The Withings sync (sync/withings-run.mjs) fills it.');
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
