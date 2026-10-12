/**
 * import-159-garmin-activities.mjs — One-time, re-runnable import of the Garmin
 * Connect export's activity history into `Workouts` as `source = 'garmin_import'`
 * (#159, sync plan §11).
 *
 * Reads an EXTRACTED export folder (`--export <dir>`, anywhere under which are
 * the `*_summarizedActivities.json` files) and writes through the API, like
 * import-160. The JSON summaries are the source; FIT files are not imported.
 * No schema change.
 *
 * Per activity (oldest first):
 * - its JSON object is archived in the bot account's Drive (`raw_ref`);
 * - strength tries `enrichWorkout` on a hand-logged `weight` row (§7: 30 min,
 *   fill blanks only). Ambiguous: skipped and reported. No match: a Sets-less
 *   `weight` row, since there is nothing to enrich;
 * - anything else goes through `upsertSyncedWorkout`, which never claims a
 *   plan for this source (history is not a plan's completion, #403).
 *
 * Idempotent: activities already in Workouts under this source, or already
 * linked to a hand-logged row, are skipped, so a second run writes nothing.
 * `--max-rows` caps writes per run; re-run until it says there is nothing left.
 * Writes no SyncLog row and does not rebuild DailySummary (#162).
 *
 * Usage:
 *   node scripts/import-159-garmin-activities.mjs --export <dir> --dry-run
 *   node scripts/import-159-garmin-activities.mjs --export <dir> --max-rows 200
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SOURCE, mapActivity, strengthOffer } from '../sync/src/normalize-garmin.mjs';

export const DEFAULTS = { maxRows: 300, pauseMs: 300 };

/** Every activity object under `dir`, oldest first. */
export function readExport(dir) {
  const acts = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/_summarizedActivities\.json$/.test(name)) continue;
      for (const block of JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''))) {
        acts.push(...(block.summarizedActivitiesExport ?? []));
      }
    }
  };
  walk(dir);
  return acts.sort((a, b) => a.startTimeLocal - b.startTimeLocal);
}

/** Garmin ids already in Thrive: this source's rows, and hand-logged rows linked by enrichment. */
export const presentIds = (workouts) => new Set(
  workouts
    .filter((w) => (w.source === SOURCE || w.source === '') && String(w.source_activity_id ?? '') !== '')
    .map((w) => String(w.source_activity_id)),
);

const count = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/** @returns {Promise<number>} the exit code */
export async function importActivities({
  api, archive, activities, dryRun = false, maxRows = DEFAULTS.maxRows, pauseMs = DEFAULTS.pauseMs,
  now = () => new Date().toISOString(), wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log, error = console.error,
}) {
  const have = presentIds(await api.get('getWorkouts', {}));
  const skipped = {};
  const todo = [];
  let present = 0;
  for (const a of activities) {
    const m = mapActivity(a);
    if (m.kind === 'skipped') { count(skipped, m.reason); continue; }
    if (have.has(String(a.activityId))) { present += 1; continue; }
    todo.push({ a, incoming: m.incoming });
  }
  log(`activities in export: ${activities.length}`);
  log(`already in Thrive: ${present}`);
  log(`not imported: ${JSON.stringify(skipped)}`);
  log(`to import: ${todo.length}`);
  if (!todo.length) { log('\nNothing to write.'); return 0; }
  if (dryRun) { log('\n--dry-run: nothing written.'); return 0; }

  const syncedAt = now();
  const out = { created: 0, enriched: 0, ambiguous: [], errors: 0 };
  let writes = 0;
  for (const { a, incoming } of todo) {
    if (writes >= maxRows) break;
    const id = String(a.activityId);
    try {
      if (writes > 0 && pauseMs > 0) await wait(pauseMs);
      const file = await archive.upsertActivity(a, incoming.date);
      if (incoming.type === 'weight') {
        const r = await api.enrichWorkout({
          source_activity_id: id, activity: strengthOffer(incoming), last_written: null,
          raw_ref: file.fileId, synced_at: syncedAt,
        });
        if (r.status === 'enriched' || r.status === 'unchanged') { out.enriched += 1; writes += 1; continue; }
        if (r.reason === 'ambiguous') {
          out.ambiguous.push(`${id} on ${incoming.date} at ${incoming.time}`);
          continue;
        }
      }
      const r = await api.upsertSyncedWorkout({
        source: SOURCE, source_activity_id: id, incoming, last_written: null,
        raw_ref: file.fileId, synced_at: syncedAt,
      });
      if (r.status !== 'created') throw new Error(`upsertSyncedWorkout answered "${r.status}"`);
      out.created += 1;
      writes += 1;
    } catch (err) {
      out.errors += 1;
      error(`FAILED activity ${id} (${incoming.date}): ${String(err.message || err).slice(0, 200)}`);
      error('Stopping; re-run to continue: imported activities are skipped.');
      break;
    }
  }
  log(`\ncreated ${out.created}, enriched ${out.enriched}, ambiguous ${out.ambiguous.length}, errors ${out.errors}`);
  for (const line of out.ambiguous) log(`  ambiguous, no row written: strength ${line}`);
  const left = todo.length - writes - out.ambiguous.length;
  if (left > 0 && !out.errors) log(`${left} left: re-run to continue.`);
  return out.errors ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
  const num = (flag, fallback) => {
    const v = val(flag);
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < (flag === '--pause-ms' ? 0 : 1)) {
      console.error(`REFUSING: ${flag} must be a whole number, got "${v}".`);
      process.exit(1);
    }
    return n;
  };
  const dir = val('--export');
  if (!dir) { console.error('REFUSING: --export <extracted export folder> is required.'); process.exit(1); }

  const { createThriveApi, loadThriveApiConfig } = await import('../sync/src/thrive-api.mjs');
  const { createDrive } = await import('../sync/src/drive.mjs');
  const { googleTokenProvider, loadGoogleCredentials } = await import('../sync/src/google.mjs');
  const { createGarminArchive } = await import('../sync/src/garmin-archive.mjs');
  const { redact } = await import('../sync/src/redact.mjs');
  try {
    const dryRun = args.includes('--dry-run');
    const archive = dryRun
      ? null
      : createGarminArchive(createDrive({ getToken: googleTokenProvider(loadGoogleCredentials(process.env)) }));
    process.exitCode = await importActivities({
      api: createThriveApi(loadThriveApiConfig()), archive, activities: readExport(dir), dryRun,
      maxRows: num('--max-rows', DEFAULTS.maxRows), pauseMs: num('--pause-ms', DEFAULTS.pauseMs),
    });
  } catch (err) {
    console.error(`${err.name ?? 'Error'}: ${redact(err.message || String(err))}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
