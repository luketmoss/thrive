// Narration for thrive_journal and thrive_set_journal_entry (#234): the user's
// day-by-day notes.
//
// Pure. Rows arrive from api.js as domain objects ({ date, note, created,
// updated }); nothing here knows a column. A day with no row has no note, and
// is listed as such rather than dropped, so a reader can tell "nothing
// written" from "range not read".

import { datesBetween, describeDateRuns } from './daily.js';

/** One entry -> "- 2026-09-22: note", continuation lines indented under it. */
export function describeJournalDay(entry) {
  const [first, ...rest] = String(entry.note).split(/\r?\n/);
  return [`- ${entry.date}: ${first}`, ...rest.map((l) => `  ${l}`)].join('\n');
}

/** The thrive_journal response. */
export function describeJournalRange(rows, { from, to }) {
  const out = [`Journal, ${from} to ${to}: ${rows.length} day${rows.length === 1 ? '' : 's'} with a note.`];
  const have = new Set(rows.map((r) => r.date));
  const missing = datesBetween(from, to).filter((d) => !have.has(d));
  if (missing.length) {
    out.push(
      `No note for ${missing.length} day${missing.length > 1 ? 's' : ''}: ${describeDateRuns(missing)}. ` +
      'No note means nothing was written, not that nothing happened.',
    );
  }
  if (rows.length) out.push('', ...rows.map(describeJournalDay));
  return out.join('\n');
}
