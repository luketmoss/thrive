// #234 — narration for thrive_journal. Pure; run with `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeJournalDay, describeJournalRange } from './journal.js';

const entry = (date, note) => ({ date, note, created: '', updated: '' });

test('a one-line note is one line; later lines are indented under it', () => {
  assert.equal(describeJournalDay(entry('2026-09-22', 'Easy ride.')), '- 2026-09-22: Easy ride.');
  assert.equal(
    describeJournalDay(entry('2026-09-22', 'Legs heavy.\r\n\nSlept badly.')),
    '- 2026-09-22: Legs heavy.\n  \n  Slept badly.',
  );
});

test('a range lists notes in the order given, and the days with none as runs', () => {
  const out = describeJournalRange(
    [entry('2026-09-21', 'a'), entry('2026-09-23', 'b')],
    { from: '2026-09-20', to: '2026-09-24' },
  );
  assert.match(out, /^Journal, 2026-09-20 to 2026-09-24: 2 days with a note\./);
  assert.match(out, /No note for 3 days: 2026-09-20, 2026-09-22, 2026-09-24\. No note means nothing was written/);
  assert.ok(out.indexOf('2026-09-21: a') < out.indexOf('2026-09-23: b'));
});

test('a full range has no missing-days line, and an empty one says so', () => {
  const full = describeJournalRange([entry('2026-09-20', 'x')], { from: '2026-09-20', to: '2026-09-20' });
  assert.equal(full, 'Journal, 2026-09-20 to 2026-09-20: 1 day with a note.\n\n- 2026-09-20: x');
  const none = describeJournalRange([], { from: '2026-09-20', to: '2026-09-21' });
  assert.match(none, /0 days with a note\.\nNo note for 2 days: 2026-09-20 to 2026-09-21\./);
});
