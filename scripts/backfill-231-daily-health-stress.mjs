/**
 * backfill-231-daily-health-stress.mjs — One-time, re-runnable backfill for #231.
 *
 * Fills `DailyHealth!S` (`stress_avg`) on rows written before the sync parsed
 * it. Each row's `raw_ref` is the Drive file ID of the archived health bundle
 * it was parsed from; this re-reads that bundle and re-parses it with the
 * sync's own parser (sync/src/normalize-health.mjs), so the backfill and the
 * nightly run can never disagree about what a line means.
 *
 * A single-field patch, never a re-parse-and-overwrite:
 *
 * - Each row is sent to `upsertDailyHealth` as `{ date, stress_avg }` alone.
 *   The upsert writes only the fields a row names, so every other field is
 *   left exactly as it is.
 * - `synced_at` is one value per call, stamped on every row the call touches.
 *   Rows are grouped by the `synced_at` they already carry and each group is
 *   sent with that value, so it does not change either. (A row with a blank
 *   `synced_at` gets this run's time.)
 * - It only fills: a row whose `stress_avg` already holds a value is left
 *   alone, and a bundle with no Stress line for a date writes nothing.
 * - Capped per run (`--max-rows`, default 20) and paced (`--batch`, default 5
 *   rows per call, `--pause-ms` between calls), the way #215 caps its
 *   reconcile, rather than rewriting the tab in one call. Re-run until it says
 *   there is nothing left to do; each run starts from what the sheet holds.
 *
 * A row it cannot fill is reported by date, with why: no `raw_ref`, a
 * `raw_ref` Drive will not read, a bundle that is not a health bundle, a date
 * the bundle's text did not parse, or a date the bundle carries nothing for.
 * Nothing is guessed.
 *
 * Run it **after** migrate-231 and after the API version that knows
 * `stress_avg` is deployed: it refuses to write if `getDailyHealth` does not
 * return the field.
 *
 * Credentials are the ones the sync already uses: the bot account's Drive
 * credential (sync/.google-credentials.json locally, or the GOOGLE_* env
 * variables) to read the archive, and THRIVE_API_URL / THRIVE_API_KEY to
 * read and write the sheet through the API.
 *
 * Usage:
 *   node scripts/backfill-231-daily-health-stress.mjs --dry-run
 *   node scripts/backfill-231-daily-health-stress.mjs
 *   ... --max-rows 40 --batch 5 --pause-ms 1000
 */

import { pathToFileURL } from 'node:url';
import { parseHealthBundle } from '../sync/src/normalize-health.mjs';

export const DEFAULTS = { maxRows: 20, batch: 5, pauseMs: 1000 };

const isHealthBundle = (b) =>
  !!b && typeof b === 'object' && typeof b.run_date === 'string' &&
  !!b.window && typeof b.window.start === 'string' && Array.isArray(b.calls);

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * What each row needs, from the sheet's rows and the archive. Reads only.
 *
 * @returns {Promise<{ fills: { date: string, stress_avg: string, synced_at: string }[],
 *   alreadySet: string[], noStress: string[], problems: { date: string, reason: string }[] }>}
 */
export async function planBackfill({ rows, readBundle }) {
  const fills = [];
  const alreadySet = [];
  const noStress = [];
  const problems = [];

  const byRef = new Map();
  for (const row of [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (String(row.stress_avg ?? '').trim() !== '') { alreadySet.push(row.date); continue; }
    const ref = String(row.raw_ref ?? '').trim();
    if (!ref) { problems.push({ date: row.date, reason: 'no raw_ref: the row names no archived bundle' }); continue; }
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(row);
  }

  for (const [ref, group] of byRef) {
    let bundle;
    try {
      bundle = await readBundle(ref);
    } catch (err) {
      const reason = `raw_ref ${ref} is unreadable: ${oneLine(err.message || err)}`;
      for (const row of group) problems.push({ date: row.date, reason });
      continue;
    }
    if (!isHealthBundle(bundle)) {
      for (const row of group) problems.push({ date: row.date, reason: `raw_ref ${ref} is not a health bundle` });
      continue;
    }

    const parsed = parseHealthBundle(bundle, { rawRef: ref });
    const parsedByDate = new Map(parsed.rows.map((r) => [r.date, r]));
    for (const row of group) {
      const failure = parsed.failures.find((f) => f.date === row.date);
      if (failure) {
        problems.push({ date: row.date, reason: `bundle ${ref} did not parse for this date: ${oneLine(failure.message)}` });
        continue;
      }
      const p = parsedByDate.get(row.date);
      if (!p) {
        problems.push({
          date: row.date,
          reason: `bundle ${ref} (run ${bundle.run_date}, window ${bundle.window.start} on) carries nothing for this date`,
        });
        continue;
      }
      if (!p.stress_avg) { noStress.push(row.date); continue; }
      fills.push({ date: row.date, stress_avg: p.stress_avg, synced_at: String(row.synced_at ?? '').trim() });
    }
  }

  fills.sort((a, b) => (a.date < b.date ? -1 : 1));
  problems.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { fills, alreadySet, noStress, problems };
}

/**
 * The backfill, over the sync's own clients: `api` is sync/src/thrive-api.mjs's
 * (`get`, `upsertDailyHealth`), `drive` is sync/src/drive.mjs's (`readJson`).
 *
 * @returns {Promise<number>} the exit code: 1 if the API is not ready or a write failed
 */
export async function backfill({
  api, drive, dryRun = false, maxRows = DEFAULTS.maxRows, batch = DEFAULTS.batch,
  pauseMs = DEFAULTS.pauseMs, now = () => new Date().toISOString(),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, error = console.error,
}) {
  const rows = await api.get('getDailyHealth', {});
  log(`DailyHealth: ${rows.length} row(s)`);
  if (rows.length && !rows.every((r) => Object.prototype.hasOwnProperty.call(r, 'stress_avg'))) {
    error(
      'REFUSING: getDailyHealth does not return stress_avg, so the deployed API predates #231.\n' +
      'Run scripts/migrate-231-daily-health-stress.mjs, deploy the API, then re-run this.'
    );
    return 1;
  }

  const { fills, alreadySet, noStress, problems } = await planBackfill({
    rows, readBundle: (ref) => drive.readJson(ref),
  });
  const thisRun = fills.slice(0, maxRows);
  const later = fills.length - thisRun.length;

  log(`already set: ${alreadySet.length}`);
  log(`no Stress line in the bundle (left blank): ${noStress.length}${noStress.length ? ` — ${noStress.join(', ')}` : ''}`);
  log(`to fill: ${fills.length}${later ? ` (${thisRun.length} this run, capped by --max-rows ${maxRows}; ${later} for a later run)` : ''}`);
  for (const f of thisRun) log(`  ${f.date}  stress_avg ${f.stress_avg}`);
  if (problems.length) {
    log(`NOT FILLED, needs a look: ${problems.length}`);
    for (const p of problems) log(`  ${p.date}  ${p.reason}`);
  }

  if (!thisRun.length) {
    log('\nNothing to write.');
    return 0;
  }
  if (dryRun) {
    log('\n--dry-run: nothing written.');
    return 0;
  }

  // One call per (synced_at, batch): each call's synced_at is the one its rows
  // already carry, so the patch changes stress_avg and nothing else.
  const groups = new Map();
  for (const f of thisRun) {
    const at = f.synced_at || now();
    if (!groups.has(at)) groups.set(at, []);
    groups.get(at).push({ date: f.date, stress_avg: f.stress_avg });
  }
  let written = 0;
  let calls = 0;
  for (const [syncedAt, group] of groups) {
    for (let i = 0; i < group.length; i += batch) {
      const chunk = group.slice(i, i + batch);
      if (calls > 0 && pauseMs > 0) await wait(pauseMs);
      try {
        const res = await api.upsertDailyHealth(chunk, syncedAt);
        if (res.appended) {
          error(`UNEXPECTED: ${res.appended} row(s) appended for ${chunk.map((c) => c.date).join(', ')}; every date was read from the sheet.`);
          return 1;
        }
      } catch (err) {
        error(`FAILED writing ${chunk.map((c) => c.date).join(', ')}: ${oneLine(err.message || err)}`);
        error(`${written} row(s) were written before it. Re-run to continue: written rows are skipped.`);
        return 1;
      }
      written += chunk.length;
      calls += 1;
      log(`wrote  ${chunk.map((c) => `${c.date}=${c.stress_avg}`).join(', ')}`);
    }
  }
  log(`\nFilled ${written} row(s) in ${calls} call(s).${later ? ` ${later} left: re-run to continue.` : ''}`);
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
