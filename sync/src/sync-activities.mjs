// The run's activity step (#166): every activity the window's list named is
// read back from the archive, normalized, and merged into Workouts through
// `upsertSyncedWorkout`, which applies sync plan §8's three-way merge inside
// one Apps Script execution. What the sheet then holds is written back to the
// archive's `normalized`, so the next run compares against the truth.
//
// Every activity is merged on every run, not only those whose payload changed:
// the merge is idempotent, and a parser fix then re-applies without a replay.
//
// Before its merge, each activity passes the run's FIT step (#154,
// src/fit.mjs), whose `fit_ref` / `fit_fetched_at` ride on the same upsert as
// sync-owned fields.
//
// A strength session (402) never gets a row of its own (#155, sync plan §7).
// It goes to `enrichWorkout`, which fills blanks on the matching hand-logged
// `weight` row, and gets no FIT. No match, or an ambiguous one, is a note for
// SyncLog, not a failure. The archive's `normalized` for it is
// `{ enrichment: { workout_id, filled } }`, the fields it has filled there,
// which are never written again. Hybrid Fitness (1200) takes the same path
// (#194), without moving time: its `Workout Time` includes the rests.

import { ActivityFormatError, ACTIVITY_FIELDS, normalizeActivity } from './normalize-activity.mjs';
import { redact } from './redact.mjs';
import { classifySport } from './sport-codes.mjs';

export const SOURCE = 'coros';

/** Parsed like any activity: `Workout Time`, `Total Time`, HR, calories. `Sets:` is unused. */
const STRENGTH_MAPPING = { type: 'weight', sub_type: '' };

/**
 * What a strength session offers the hand-logged row: its local start, and the
 * fields it may fill. A blank is never written, so withholding moving time
 * leaves the row's cell as it is (#194).
 */
export const strengthActivity = (incoming, { workoutTimeIncludesRests = false } = {}) => ({
  date: incoming.date,
  time: incoming.time,
  elapsed_seconds: incoming.elapsed_seconds,
  moving_seconds: workoutTimeIncludesRests ? '' : incoming.moving_seconds,
  avg_hr: incoming.avg_hr,
  calories: incoming.calories,
});

/** The SyncLog note for a session left unmatched: private detail, never the public log. */
export function unmatchedNote(id, activity, result) {
  const who = result.candidates?.length
    ? ` (candidates: ${result.candidates.map((c) => `${c.id}${c.time ? ` at ${c.time}` : ' with no time'}`).join(', ')})`
    : '';
  return `strength ${id} on ${activity.date} at ${activity.time}: ${result.reason}${who}; no workout enriched`;
}

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
 *   skipped: number, enriched: number, unmatched: number, notes: string[], failures: string[] }>}
 *   `failures` fails the run; a skip, a deleted row or an unmatched strength
 *   session (`notes`) does not. `enriched` counts hand-logged rows written to
 *   (SyncLog's `n_enriched`); an enriched row with nothing new is `unchanged`.
 *   `updated` counts rows whose merged fields changed (SyncLog's `n_updated`, #156); the API answers `updated` for every existing row, because
 *   `synced_at` always moves, so a row that held what it already held is `unchanged`.
 */
export async function syncActivities({ archive, api, activityIds, syncedAt, fit = null, log = console.log }) {
  const out = {
    created: 0, updated: 0, unchanged: 0, deleted: 0, skipped: 0,
    enriched: 0, unmatched: 0, notes: [], failures: [],
  };
  const fail = (message) => {
    out.failures.push(message);
    log(`  FAILED ${message}`);
  };

  // Read, classify and normalize every activity first, then write them oldest
  // first. The order only matters for FITs (#154): when the budget runs out,
  // the activities left waiting are the newest, which stay in the window
  // longest and so get the most later runs to be fetched in.
  const ready = [];
  for (const id of activityIds) {
    try {
      const file = await archive.readActivity(id);
      // Ingest has already reported why: its detail call failed on a first fetch.
      if (!file) continue;
      const code = file.data?.args?.sportType ?? file.data?.list_entry?.sportType;

      const sport = classifySport(code);
      if (sport.kind === 'unmapped') {
        out.skipped += 1;
        log(`  activity ${id}: sport code ${code} is not mapped, so no row was written (archived)`);
        continue;
      }

      const strength = sport.kind === 'strength';
      let incoming;
      try {
        incoming = normalizeActivity(file.data, strength ? STRENGTH_MAPPING : sport);
      } catch (err) {
        if (!(err instanceof ActivityFormatError)) throw err;
        // Names the activity and the line, so the parser fix is obvious.
        fail(`activity ${id}: not written, unrecognized format in getActivityDetail: ${err.message}`);
        continue;
      }
      ready.push({ id, file, incoming, strength, sport });
    } catch (err) {
      fail(`activity ${id}: ${redact(err.message || String(err))}`);
    }
  }
  ready.sort((a, b) => a.file.data.list_entry.startTimestamp - b.file.data.list_entry.startTimestamp);

  for (const { id, file, incoming, strength, sport } of ready) {
    try {
      if (strength) {
        await enrich({ id, file, incoming, sport });
        continue;
      }

      // The FIT first, so a new activity's row is created with its fit_ref in
      // one write, and every later run re-sends what the archive records.
      const fitFields = fit
        ? await fit.ensure({
          activityId: id, fileId: file.fileId, record: file.data.fit, args: file.data.args, localDate: incoming.date,
        })
        : {};

      const lastWritten = file.data.normalized ?? null;
      const result = await api.upsertSyncedWorkout({
        source: SOURCE,
        source_activity_id: id,
        incoming,
        last_written: lastWritten,
        raw_ref: file.fileId,
        synced_at: syncedAt,
        ...fitFields,
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

  /** One strength session: enrich its hand-logged row, or note why not. */
  async function enrich({ id, file, incoming, sport }) {
    const activity = strengthActivity(incoming, sport);
    const lastWritten = file.data.normalized?.enrichment ?? null;
    const result = await api.enrichWorkout({
      source_activity_id: id,
      activity,
      last_written: lastWritten,
      raw_ref: file.fileId,
      synced_at: syncedAt,
    });

    if (result.status === 'unmatched') {
      out.unmatched += 1;
      const note = unmatchedNote(id, activity, result);
      out.notes.push(note);
      log(`  activity ${id} (strength): ${note}`);
      return;
    }
    if (result.status === 'enriched') {
      out.enriched += 1;
      const how = result.linked ? 'linked' : 'already linked';
      const what = result.filled.length ? `filled ${result.filled.join(', ')}` : 'nothing blank to fill';
      log(`  activity ${id} (strength): enriched ${result.id} (${how}; ${what})`);
    } else {
      out.unchanged += 1;
      log(`  activity ${id} (strength): unchanged ${result.id}, nothing left to fill`);
    }
    if (JSON.stringify(result.written) !== JSON.stringify(lastWritten)) {
      await archive.writeNormalized(file.fileId, { enrichment: result.written });
    }
  }
}
