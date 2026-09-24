// The run's activity step (#166): every activity the window's list named is
// read back from the archive, normalized, and merged into Workouts through
// `upsertSyncedWorkout`, which applies sync plan §8's three-way merge inside
// one Apps Script execution. What the sheet then holds is written back to the
// archive's `normalized`, so the next run compares against the truth.
//
// Every activity is merged on every run, not only those whose payload changed:
// the merge is idempotent, and a parser fix then re-applies without a replay.

import { ActivityFormatError, ACTIVITY_FIELDS, normalizeActivity } from './normalize-activity.mjs';
import { redact } from './redact.mjs';
import { classifySport } from './sport-codes.mjs';

export const SOURCE = 'coros';

/**
 * `normalized` as the archive holds it: every merged field as the sheet holds
 * it, plus `edited`, the fields the user has changed in Thrive (which the
 * action keeps from then on). Compared so an unchanged value is not rewritten.
 */
const sameNormalized = (a, b) =>
  !!a && !!b &&
  ACTIVITY_FIELDS.every((f) => String(a[f] ?? '') === String(b[f] ?? '')) &&
  JSON.stringify(a.edited ?? []) === JSON.stringify(b.edited ?? []);

/**
 * @param {{ archive: object, api: object, activityIds: string[], syncedAt: string,
 *   log?: (line: string) => void }} opts
 * @returns {Promise<{ created: number, updated: number, unchanged: number, deleted: number,
 *   skipped: number, failures: string[] }>}  `failures` fails the run; a skip or a deleted
 *   row does not. `updated` counts rows whose merged fields changed (SyncLog's
 *   `n_updated`, #156); the API answers `updated` for every existing row, because
 *   `synced_at` always moves, so a row that held what it already held is `unchanged`.
 */
export async function syncActivities({ archive, api, activityIds, syncedAt, log = console.log }) {
  const out = { created: 0, updated: 0, unchanged: 0, deleted: 0, skipped: 0, failures: [] };
  const fail = (message) => {
    out.failures.push(message);
    log(`  FAILED ${message}`);
  };

  for (const id of activityIds) {
    try {
      const file = await archive.readActivity(id);
      // Ingest has already reported why: its detail call failed on a first fetch.
      if (!file) continue;
      const code = file.data?.args?.sportType ?? file.data?.list_entry?.sportType;

      const sport = classifySport(code);
      if (sport.kind === 'strength') {
        out.skipped += 1;
        log(`  activity ${id}: strength (${code}), archived and left to #155`);
        continue;
      }
      if (sport.kind === 'unmapped') {
        out.skipped += 1;
        log(`  activity ${id}: sport code ${code} is not mapped, so no row was written (archived)`);
        continue;
      }

      let incoming;
      try {
        incoming = normalizeActivity(file.data, sport);
      } catch (err) {
        if (!(err instanceof ActivityFormatError)) throw err;
        // Names the activity and the line, so the parser fix is obvious.
        fail(`activity ${id}: not written, unrecognized format in getActivityDetail: ${err.message}`);
        continue;
      }

      const lastWritten = file.data.normalized ?? null;
      const result = await api.upsertSyncedWorkout({
        source: SOURCE,
        source_activity_id: id,
        incoming,
        last_written: lastWritten,
        raw_ref: file.fileId,
        synced_at: syncedAt,
      });

      if (result.status === 'deleted') {
        out.deleted += 1;
        log(`  activity ${id}: its row was deleted in Thrive, so it was not recreated`);
        continue;
      }
      const changed = !sameNormalized(result.written, lastWritten);
      const status = result.status === 'updated' && !changed ? 'unchanged' : result.status;
      out[status] += 1;
      const kept = result.kept?.length ? `; kept Thrive edits to ${result.kept.join(', ')}` : '';
      log(`  activity ${id} (${incoming.type}${incoming.sub_type ? `/${incoming.sub_type}` : ''}): ${status} ${result.id}${kept}`);

      if (changed) {
        await archive.writeNormalized(file.fileId, result.written);
      }
    } catch (err) {
      fail(`activity ${id}: ${redact(err.message || String(err))}`);
    }
  }
  return out;
}
