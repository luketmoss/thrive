#!/usr/bin/env node
/**
 * backfill-131-daily-summary.mjs — One-time historical backfill for #131.
 *
 * Rebuilds `DailySummary` across all existing `Workouts` history by calling
 * the Apps Script API's `rebuildDailySummary` action in **chunks**.
 *
 * Why chunks rather than one call: Apps Script has an execution-time ceiling
 * per request, and a rebuild over a year of history will exceed it. Each
 * chunk is a complete, idempotent rebuild of its own date range, so the
 * backfill is **resumable** — a run that dies halfway has simply done fewer
 * chunks, and re-running it redoes them harmlessly. That is the same property
 * AC1 gives the rebuild itself; this script inherits it rather than
 * reimplementing it.
 *
 * Progress is written to a state file after every successful chunk, so a
 * resumed run skips what already landed. Deleting the state file forces a
 * full rebuild, which is always safe.
 *
 * Usage:
 *   THRIVE_API_URL=... THRIVE_API_KEY=... node scripts/backfill-131-daily-summary.mjs --dry-run
 *   THRIVE_API_URL=... THRIVE_API_KEY=... node scripts/backfill-131-daily-summary.mjs
 *   ... --from 2026-01-01 --to 2026-03-31   # an explicit range
 *   ... --chunk-days 14                      # smaller chunks if one times out
 *   ... --restart                            # ignore saved progress
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY_RUN = has('--dry-run');
const RESTART = has('--restart');
const CHUNK_DAYS = Number(value('--chunk-days', '30'));
/** Apps Script is rate-limited per minute; a short pause keeps well inside. */
const PAUSE_MS = Number(value('--pause-ms', '1000'));
const STATE_FILE = new URL('./.backfill-131-progress.json', import.meta.url);

const API_URL = process.env.THRIVE_API_URL;
const API_KEY = process.env.THRIVE_API_KEY;

if (!API_URL || !API_KEY) {
  console.error(
    'REFUSING: set THRIVE_API_URL and THRIVE_API_KEY.\n' +
    'They are the deployed web app URL and the API_KEY script property — see apps-script/README.md.'
  );
  process.exit(1);
}
if (!Number.isInteger(CHUNK_DAYS) || CHUNK_DAYS < 1) {
  console.error(`REFUSING: --chunk-days must be a whole number of at least 1, got "${CHUNK_DAYS}".`);
  process.exit(1);
}

/** One API call. Every response uses the same envelope, so this is uniform. */
async function api(action, params = {}, payload = null) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  if (payload) url.searchParams.set('payload', JSON.stringify(payload));

  const res = await fetch(url, { redirect: 'follow' });
  const body = await res.json();
  if (!body.success) throw new Error(`${action}: ${body.error}`);
  return body.data;
}

const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Range ------------------------------------------------------------
let from = value('--from', null);
let to = value('--to', null);

if (!from || !to) {
  const span = await api('getHistoryDateRange');
  if (!span.from) {
    console.log('No workout history to summarize. Nothing to do.');
    process.exit(0);
  }
  from = from || span.from;
  to = to || span.to;
  console.log(`History spans ${span.from} to ${span.to}`);
}

for (const [label, d] of [['--from', from], ['--to', to]]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    console.error(`REFUSING: ${label} must be YYYY-MM-DD, got "${d}".`);
    process.exit(1);
  }
}
if (from > to) {
  console.error(`REFUSING: --from must not be after --to (${from} > ${to}).`);
  process.exit(1);
}

// --- Chunks -----------------------------------------------------------
const chunks = [];
for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
  const end = addDays(start, CHUNK_DAYS - 1);
  chunks.push({ from: start, to: end > to ? to : end });
}

// --- Resume -----------------------------------------------------------
let done = new Set();
if (RESTART && existsSync(STATE_FILE)) {
  unlinkSync(STATE_FILE);
  console.log('--restart: cleared saved progress');
} else if (existsSync(STATE_FILE)) {
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    // Progress only applies to the same plan; a different range or chunk size
    // is a different plan, and resuming into it would skip the wrong days.
    if (saved.from === from && saved.to === to && saved.chunkDays === CHUNK_DAYS) {
      done = new Set(saved.done);
      console.log(`Resuming: ${done.size} of ${chunks.length} chunks already done`);
    } else {
      console.log('Saved progress is for a different range — starting fresh');
    }
  } catch {
    console.log('Saved progress unreadable — starting fresh');
  }
}

const remaining = chunks.filter((c) => !done.has(c.from));

console.log(
  `\nplan   ${chunks.length} chunk${chunks.length > 1 ? 's' : ''} of up to ${CHUNK_DAYS} days, ` +
  `${remaining.length} to run\n       ${from} -> ${to}`
);
if (remaining.length) {
  console.log(`       first: ${remaining[0].from}..${remaining[0].to}`);
}

if (DRY_RUN) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}
if (!remaining.length) {
  console.log('\nNothing to do — every chunk is already done.');
  process.exit(0);
}

// --- Apply ------------------------------------------------------------
// One computed_at for the whole backfill, so every row it writes carries the
// same stamp and a partial run is visible as a gap rather than a gradient.
const computedAt = new Date().toISOString();
const totals = { written: 0, updated: 0, skipped: 0 };

for (const [i, chunk] of remaining.entries()) {
  const label = `[${i + 1}/${remaining.length}] ${chunk.from}..${chunk.to}`;
  try {
    const result = await api('rebuildDailySummary', {}, {
      from: chunk.from,
      to: chunk.to,
      computed_at: computedAt,
    });
    totals.written += result.written;
    totals.updated += result.updated;
    totals.skipped += result.skipped;
    console.log(
      `${label}  ${result.written} new, ${result.updated} updated, ${result.skipped} empty`
    );

    done.add(chunk.from);
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ from, to, chunkDays: CHUNK_DAYS, done: [...done] }, null, 1)
    );
  } catch (err) {
    console.error(`\n${label}  FAILED: ${err.message}`);
    console.error(
      `\n${done.size} of ${chunks.length} chunks completed and saved. ` +
      'Re-run to resume from here; each chunk is idempotent, so nothing is duplicated.\n' +
      'If a chunk times out, retry with a smaller --chunk-days.'
    );
    process.exit(1);
  }

  if (i < remaining.length - 1) await sleep(PAUSE_MS);
}

console.log(
  `\ndone   ${totals.written} rows written, ${totals.updated} updated, ` +
  `${totals.skipped} days had nothing to report`
);
console.log(`       computed_at ${computedAt}`);

unlinkSync(STATE_FILE);
console.log('       progress file removed — the backfill is complete');
