/**
 * backfill-260-workouts-sport-type.mjs — One-time, re-runnable backfill for #260.
 *
 * Fills `Workouts!AB` (`sport_type`, the COROS sport code) on COROS rows
 * written before the sync sent it: synced rows (`source = 'coros'`) and
 * enriched rows (`source = ''` with a `source_activity_id`). Each row's
 * `raw_ref` is the Drive file ID of the archived activity it came from; this
 * re-reads that file and takes the code from `args.sportType`, else
 * `list_entry.sportType`, exactly where the sync reads it.
 *
 * A single-field patch, never a re-sync:
 *
 * - Each row is written through the API's `updateWorkout` as
 *   `{ sport_type }` alone. That action changes only the keys it is sent, so
 *   no other cell moves, `synced_at` included. (`upsertSyncedWorkout` would
 *   need `incoming` and would move `synced_at`.)
 * - It only fills: a row whose `sport_type` already holds a value is left
 *   alone. `garmin_import` and hand-logged rows are never touched.
 * - The file's `activity_id` must equal the row's `source_activity_id`, or
 *   the row is not written: a `raw_ref` pointing at another activity is a
 *   problem to look at, not a code to copy.
 * - Capped per run (`--max-rows`, default 20) and paced (`--batch` writes,
 *   default 5, then `--pause-ms`, default 1000). Re-run until it says there is
 *   nothing to write; each run starts from what the sheet holds.
 *
 * Every row it cannot fill is listed by workout id and date, with why: no
 * `raw_ref`, a `raw_ref` Drive will not read, a file that is not an activity
 * file, an activity ID mismatch, or no whole-number code. Nothing is guessed.
 *
 * Run it **after** migrate-260 and after the API version that knows
 * `sport_type` is deployed: it refuses to write if `getWorkouts` does not
 * return the field. `updateWorkout` does not take the script lock, so run it
 * outside a scheduled sync run.
 *
 * Credentials are the ones the sync already uses: the bot account's Drive
 * credential (sync/.google-credentials.json locally, or the GOOGLE_* env
 * variables) to read the archive, and THRIVE_API_URL / THRIVE_API_KEY to
 * read and write the sheet through the API.
 *
 * Usage:
 *   node scripts/backfill-260-workouts-sport-type.mjs --dry-run
 *   node scripts/backfill-260-workouts-sport-type.mjs
 *   ... --max-rows 40 --batch 5 --pause-ms 1000
 */

import { pathToFileURL } from 'node:url';

export const DEFAULTS = { maxRows: 20, batch: 5, pauseMs: 1000 };

const text = (v) => String(v ?? '').trim();
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 200);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1);

/** A COROS row: synced, or enriched (a hand-logged row linked to an activity). */
export function isCorosRow(row) {
  const source = text(row.source);
  return source === 'coros' || (source === '' && text(row.source_activity_id) !== '');
}

const isActivityFile = (f) =>
  !!f && typeof f === 'object' && typeof f.activity_id === 'string' &&
  (typeof f.args === 'object' || typeof f.list_entry === 'object');

/** The code as the sync reads it, as digits, or null. */
function codeOf(file) {
  const code = file.args?.sportType ?? file.list_entry?.sportType;
  const s = typeof code === 'number' ? String(code) : typeof code === 'string' ? code.trim() : '';
  return /^\d+$/.test(s) ? s : null;
}

/**
 * What each row needs, from the sheet's rows and the archive. Reads only.
 *
 * @returns {Promise<{ fills: { id: string, date: string, sport_type: string }[],
 *   alreadySet: number, problems: { id: string, date: string, reason: string }[] }>}
 */
export async function planBackfill({ rows, readFile }) {
  const fills = [];
  const problems = [];
  let alreadySet = 0;
  const cache = new Map();

  for (const row of rows.filter(isCorosRow).sort(byDate)) {
    if (text(row.sport_type) !== '') { alreadySet += 1; continue; }
    const id = text(row.id);
    const date = text(row.date);
    const problem = (reason) => problems.push({ id, date, reason });
    const ref = text(row.raw_ref);
    if (!ref) { problem('no raw_ref: the row names no archived activity'); continue; }

    if (!cache.has(ref)) {
      cache.set(ref, readFile(ref).then((f) => ({ f }), (err) => ({ err })));
    }
    const { f, err } = await cache.get(ref);
    if (err) { problem(`raw_ref ${ref} is unreadable: ${oneLine(err.message || err)}`); continue; }
    if (!isActivityFile(f)) { problem(`raw_ref ${ref} is not an activity file`); continue; }
    const want = text(row.source_activity_id);
    if (f.activity_id !== want) {
      problem(`raw_ref ${ref} is activity ${f.activity_id}, but the row is activity ${want}`);
      continue;
    }
    const code = codeOf(f);
    if (!code) { problem(`raw_ref ${ref} carries no whole-number sportType`); continue; }
    fills.push({ id, date, sport_type: code });
  }
  return { fills, alreadySet, problems };
}

/**
 * The backfill, over the sync's own clients: `api` is sync/src/thrive-api.mjs's
 * (`get`, `write`), `drive` is sync/src/drive.mjs's (`readJson`).
 *
 * @returns {Promise<number>} the exit code: 1 if the API is not ready or a write failed
 */
export async function backfill({
  api, drive, dryRun = false, maxRows = DEFAULTS.maxRows, batch = DEFAULTS.batch,
  pauseMs = DEFAULTS.pauseMs, wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log, error = console.error,
}) {
  const rows = await api.get('getWorkouts', {});
  const coros = rows.filter(isCorosRow);
  log(`Workouts: ${rows.length} row(s), ${coros.length} COROS (synced or enriched)`);
  if (rows.length && !rows.every((r) => Object.prototype.hasOwnProperty.call(r, 'sport_type'))) {
    error(
      'REFUSING: getWorkouts does not return sport_type, so the deployed API predates #260.\n' +
      'Run scripts/migrate-260-workouts-sport-type.mjs, deploy the API, then re-run this.'
    );
    return 1;
  }

  const { fills, alreadySet, problems } = await planBackfill({
    rows, readFile: (ref) => drive.readJson(ref),
  });
  const thisRun = fills.slice(0, maxRows);
  const later = fills.length - thisRun.length;

  log(`already set: ${alreadySet}`);
  log(`to fill: ${fills.length}${later ? ` (${thisRun.length} this run, capped by --max-rows ${maxRows}; ${later} for a later run)` : ''}`);
  for (const f of thisRun) log(`  ${f.id}  ${f.date}  sport_type ${f.sport_type}`);
  if (problems.length) {
    log(`NOT FILLED, needs a look: ${problems.length}`);
    for (const p of problems) log(`  ${p.id}  ${p.date}  ${p.reason}`);
  }

  if (!thisRun.length) {
    log('\nNothing to write.');
    return 0;
  }
  if (dryRun) {
    log('\n--dry-run: nothing written.');
    return 0;
  }

  let written = 0;
  for (const f of thisRun) {
    if (written > 0 && written % batch === 0 && pauseMs > 0) await wait(pauseMs);
    try {
      const res = await api.write('updateWorkout', { id: f.id, changes: { sport_type: f.sport_type } });
      if (res && res.sport_type !== undefined && res.sport_type !== f.sport_type) {
        error(`UNEXPECTED: ${f.id} reads back sport_type "${res.sport_type}", not "${f.sport_type}".`);
        return 1;
      }
    } catch (err) {
      error(`FAILED writing ${f.id} (${f.date}): ${oneLine(err.message || err)}`);
      error(`${written} row(s) were written before it. Re-run to continue: written rows are skipped.`);
      return 1;
    }
    written += 1;
    log(`wrote  ${f.id}  ${f.date}  sport_type ${f.sport_type}`);
  }
  log(`\nFilled ${written} row(s).${later ? ` ${later} left: re-run to continue.` : ''}`);
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const num = (flag, fallback) => {
    const i = args.indexOf(flag);
    if (i === -1) return fallback;
    const n = Number(args[i + 1]);
    if (!Number.isInteger(n) || n < (flag === '--pause-ms' ? 0 : 1)) {
      console.error(`REFUSING: ${flag} must be a whole number, got "${args[i + 1]}".`);
      process.exit(1);
    }
    return n;
  };
  const maxRows = num('--max-rows', DEFAULTS.maxRows);
  const batch = num('--batch', DEFAULTS.batch);
  const pauseMs = num('--pause-ms', DEFAULTS.pauseMs);

  const { createThriveApi, loadThriveApiConfig } = await import('../sync/src/thrive-api.mjs');
  const { createDrive } = await import('../sync/src/drive.mjs');
  const { googleTokenProvider, loadGoogleCredentials } = await import('../sync/src/google.mjs');
  const { redact } = await import('../sync/src/redact.mjs');

  try {
    const api = createThriveApi(loadThriveApiConfig());
    const drive = createDrive({ getToken: googleTokenProvider(loadGoogleCredentials()) });
    process.exitCode = await backfill({
      api, drive, dryRun: args.includes('--dry-run'), maxRows, batch, pauseMs,
    });
  } catch (err) {
    console.error(`${err.name ?? 'Error'}: ${redact(err.message || String(err))}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
