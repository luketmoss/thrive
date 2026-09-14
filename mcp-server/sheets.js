// Google Sheets REST wrapper for the Thrive MCP server.
//
// The Thrive SPA reaches the same sheet with the signed-in user's OAuth token
// (see frontend/src/api/sheets.ts). There is no backend to borrow that token
// from, so this server authenticates as a service account instead — share the
// Groundwork sheet with the service account's email to grant it access.

import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export const SPREADSHEET_ID = process.env.THRIVE_SPREADSHEET_ID;

export class SheetsApiError extends Error {
  constructor(status, message) {
    super(`Sheets API ${status}: ${message}`);
    this.name = 'SheetsApiError';
    this.status = status;
  }
}

function loadCredentials() {
  const inline = process.env.THRIVE_SERVICE_ACCOUNT_KEY;
  const file = process.env.THRIVE_SERVICE_ACCOUNT_KEY_FILE;
  if (inline) return JSON.parse(inline);
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  throw new Error(
    'Set THRIVE_SERVICE_ACCOUNT_KEY_FILE (path to the service account JSON) ' +
    'or THRIVE_SERVICE_ACCOUNT_KEY (the JSON itself).',
  );
}

let client;
/** google-auth-library caches and refreshes the access token internally. */
async function authHeaders() {
  if (!client) {
    const creds = loadCredentials();
    client = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: SCOPES,
    });
  }
  const { token } = await client.getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function request(url, init = {}) {
  const headers = { ...(await authHeaders()), ...(init.headers || {}) };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) {
      throw new SheetsApiError(
        403,
        `${body}\n\nThe service account likely lacks access — share the ` +
        `Groundwork sheet with its client_email as an Editor.`,
      );
    }
    throw new SheetsApiError(res.status, body);
  }
  return res.status === 204 ? null : res.json();
}

export async function sheetsGet(range) {
  const data = await request(`${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

export async function sheetsUpdate(range, values) {
  await request(
    `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    },
  );
}

export async function sheetsAppend(range, values) {
  if (!values.length) return;
  await request(
    `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    },
  );
}

/** First row of each range, in order, from one values:batchGet request. */
export async function sheetsBatchGetRows(ranges) {
  if (!ranges.length) return [];
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const data = await request(`${BASE}/${SPREADSHEET_ID}/values:batchGet?${qs}`);
  return (data.valueRanges || []).map((vr) => vr.values?.[0] ?? []);
}

/** Write many ranges in a single values:batchUpdate request. */
export async function sheetsBatchUpdate(data) {
  if (!data.length) return;
  await request(`${BASE}/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}

const sheetIdCache = new Map();
export async function getSheetId(sheetName) {
  if (sheetIdCache.has(sheetName)) return sheetIdCache.get(sheetName);
  const data = await request(`${BASE}/${SPREADSHEET_ID}?fields=sheets.properties`);
  for (const s of data.sheets || []) {
    sheetIdCache.set(s.properties.title, s.properties.sheetId);
  }
  if (!sheetIdCache.has(sheetName)) throw new Error(`Sheet tab "${sheetName}" not found`);
  return sheetIdCache.get(sheetName);
}

/**
 * Delete rows from one tab in a single atomic batchUpdate.
 *
 * The frontend deletes rows one call at a time; doing that here would leave
 * a partially-deleted workout behind if a call failed mid-cascade. Requests
 * are sorted descending so earlier deletions don't shift later row indexes.
 */
export async function deleteRows(sheetName, rowNumbers) {
  const rows = [...new Set(rowNumbers)].sort((a, b) => b - a);
  if (!rows.length) return 0;
  const sheetId = await getSheetId(sheetName);
  await request(`${BASE}/${SPREADSHEET_ID}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: rows.map((rowNumber) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      })),
    }),
  });
  return rows.length;
}
