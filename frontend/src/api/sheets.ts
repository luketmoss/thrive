// Google Sheets REST API wrapper using direct fetch.
// No gapi.client dependency — smaller, more control.
// Only generic utility functions — domain-specific modules import these.

import { attemptReauth } from '../auth/reauth';

const SPREADSHEET_ID = import.meta.env.VITE_SPREADSHEET_ID;
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsApiError extends Error {
  constructor(public status: number, message: string) {
    super(`Sheets API ${status}: ${message}`);
    this.name = 'SheetsApiError';
  }
}

/**
 * True for the 400 Sheets returns when a tab doesn't exist, e.g. before a
 * migration has created it. Shared by every read that treats a missing tab as
 * its own state rather than a failure (#210, #236).
 */
export function isMissingTabError(err: unknown): boolean {
  return err instanceof SheetsApiError && err.status === 400 && /unable to parse range/i.test(err.message);
}

/**
 * Wrap a Sheets API call with 401 retry logic.
 * On 401: attempt silent re-auth, then retry once with the new token.
 * The `callFn` receives a token and performs the actual API call.
 */
export async function withReauth<T>(token: string, callFn: (t: string) => Promise<T>): Promise<T> {
  try {
    return await callFn(token);
  } catch (err) {
    if (err instanceof SheetsApiError && err.status === 401) {
      // Attempt silent re-auth and retry once
      const newToken = await attemptReauth();
      return callFn(newToken);
    }
    throw err;
  }
}

export async function sheetsGet(range: string, token: string): Promise<any[][]> {
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new SheetsApiError(401, 'Token expired');
  if (!res.ok) throw new SheetsApiError(res.status, await res.text());
  const data = await res.json();
  return data.values || [];
}

export async function sheetsUpdate(range: string, values: any[][], token: string): Promise<void> {
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (res.status === 401) throw new SheetsApiError(401, 'Token expired');
  if (!res.ok) throw new SheetsApiError(res.status, await res.text());
}

export async function sheetsAppend(range: string, values: any[][], token: string): Promise<void> {
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (res.status === 401) throw new SheetsApiError(401, 'Token expired');
  if (!res.ok) throw new SheetsApiError(res.status, await res.text());
}

/**
 * One `spreadsheets:batchUpdate` call. Sheets applies the requests in order
 * and atomically: if any one fails, none of them is applied (#349).
 */
export async function sheetsBatchUpdate(requests: object[], token: string): Promise<void> {
  const url = `${BASE}/${SPREADSHEET_ID}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });
  if (res.status === 401) throw new SheetsApiError(401, 'Token expired');
  if (!res.ok) throw new SheetsApiError(res.status, await res.text());
}

export async function sheetsDeleteRow(sheetId: number, rowIndex: number, token: string): Promise<void> {
  await sheetsBatchUpdate([{
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowIndex - 1, // 0-based
        endIndex: rowIndex,
      },
    },
  }], token);
}

/**
 * Get the numeric sheet ID for a given sheet name.
 * Needed for batchUpdate operations like row deletion.
 */
export async function getSheetId(sheetName: string, token: string): Promise<number> {
  const url = `${BASE}/${SPREADSHEET_ID}?fields=sheets.properties`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new SheetsApiError(401, 'Token expired');
  if (!res.ok) throw new SheetsApiError(res.status, await res.text());
  const data = await res.json();
  const sheet = data.sheets?.find(
    (s: any) => s.properties.title === sheetName
  );
  return sheet?.properties?.sheetId ?? 0;
}
