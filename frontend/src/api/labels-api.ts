// Labels domain API — wraps Sheets REST calls with demo-mode fallback.

import type { Label, LabelWithRow } from './types';
import { sheetsGet, sheetsAppend, sheetsUpdate, sheetsDeleteRow, getSheetId, withReauth } from './sheets';
import { isDemo, DEMO_LABELS } from './demo-data';

export async function fetchLabels(token: string): Promise<LabelWithRow[]> {
  if (isDemo()) return [...DEMO_LABELS];

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Labels!A2:D', t);
    return rows.map((row, i) => ({
      id: row[0] || '',
      name: row[1] || '',
      color_key: row[2] || '',
      created: row[3] || '',
      sheetRow: i + 2,
    }));
  });
}

export async function createLabel(
  data: { name: string; color_key: string },
  token: string,
): Promise<Label> {
  const id = `lbl_${crypto.randomUUID().slice(0, 8)}`;
  const created = new Date().toISOString();
  const label: Label = { id, name: data.name, color_key: data.color_key, created };

  if (isDemo()) return label;

  await withReauth(token, (t) =>
    sheetsAppend('Labels!A:D', [[id, data.name, data.color_key, created]], t),
  );
  return label;
}

export async function updateLabel(
  sheetRow: number,
  label: Label,
  token: string,
): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, (t) =>
    sheetsUpdate(
      `Labels!A${sheetRow}:D${sheetRow}`,
      [[label.id, label.name, label.color_key, label.created]],
      t,
    ),
  );
}

export async function deleteLabel(sheetRow: number, token: string): Promise<void> {
  if (isDemo()) return;

  await withReauth(token, async (t) => {
    const sheetId = await getSheetId('Labels', t);
    await sheetsDeleteRow(sheetId, sheetRow, t);
  });
}

export async function appendLabels(
  labelsData: { id: string; name: string; color_key: string; created: string }[],
  token: string,
): Promise<void> {
  if (isDemo()) return;

  const values = labelsData.map(l => [l.id, l.name, l.color_key, l.created]);
  await withReauth(token, (t) =>
    sheetsAppend('Labels!A:D', values, t),
  );
}
