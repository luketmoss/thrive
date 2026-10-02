// Journal domain API (#233) — one free-text note per local day.
//
// A day with a note has exactly one row; a day without has none, never a row
// with a blank note. `JOURNAL_FIELDS` mirrors JOURNAL_FIELDS in
// apps-script/src/types.js (CLAUDE.md: change both together); journal-api.test.ts
// fails if they drift. The API reaches this tab too, through getJournal and
// upsertJournal (apps-script/src/journal.js, #234), which mirror upsertJournalEntry.

import type { JournalEntry, JournalEntryWithRow } from './types';
import { sheetsGet, sheetsAppend, sheetsUpdate, sheetsDeleteRow, getSheetId, withReauth } from './sheets';
import { isDemo, shiftDemoJournal } from './demo-data';

/** Journal's A:D order. */
export const JOURNAL_FIELDS = ['date', 'note', 'created', 'updated'] as const;

function rowToEntry(row: any[], i: number): JournalEntryWithRow {
  return {
    date: row[0] || '',
    note: row[1] || '',
    created: row[2] || '',
    updated: row[3] || '',
    sheetRow: i + 2,
  };
}

/**
 * Every journal row, unfiltered, in sheet order. Consumers narrow to the range
 * they need client-side. In demo mode the fixture, dated relative to today.
 */
export async function fetchJournal(token: string): Promise<JournalEntryWithRow[]> {
  if (isDemo()) return shiftDemoJournal(new Date());

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Journal!A2:D', t);
    return rows.map(rowToEntry);
  });
}

/**
 * Writes or clears a day's note.
 *  - non-blank note, no row for `date`: append (created = updated = now)
 *  - non-blank note, row exists: rewrite it in place, keep `created`
 *  - blank or whitespace-only note: delete the row if there is one
 * Returns the stored entry, or null when the day now has no note.
 */
export async function upsertJournalEntry(
  date: string,
  note: string,
  token: string,
): Promise<JournalEntry | null> {
  const blank = note.trim() === '';
  const now = new Date().toISOString();

  if (isDemo()) {
    return blank ? null : { date, note, created: now, updated: now };
  }

  return withReauth(token, async (t) => {
    const rows = await sheetsGet('Journal!A2:D', t);
    const index = rows.findIndex((r) => r[0] === date);
    const existing = index >= 0 ? rowToEntry(rows[index], index) : null;

    if (blank) {
      if (existing) {
        const sheetId = await getSheetId('Journal', t);
        await sheetsDeleteRow(sheetId, existing.sheetRow, t);
      }
      return null;
    }

    const entry: JournalEntry = {
      date,
      note,
      created: existing?.created || now,
      updated: now,
    };
    const values = [[entry.date, entry.note, entry.created, entry.updated]];
    if (existing) {
      await sheetsUpdate(`Journal!A${existing.sheetRow}:D${existing.sheetRow}`, values, t);
    } else {
      await sheetsAppend('Journal!A:D', values, t);
    }
    return entry;
  });
}
