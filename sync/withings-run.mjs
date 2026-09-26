#!/usr/bin/env node
// One Withings run (#197): get an access token (#196), fetch every measure
// group in the window, and land each one, unmodified, in the bot's Drive.
// Then (#198) normalize every group whose archive write succeeded and upsert
// the rows into BodyMeasurements through the Thrive API. #200 adds the log row
// and the schedule.
//
//   WITHINGS_CLIENT_ID=… WITHINGS_CLIENT_SECRET=… THRIVE_API_URL=… THRIVE_API_KEY=… \
//     node withings-run.mjs
//
// Needs the Google credential from google-authorize.mjs and a Withings token
// file from withings-authorize.mjs.
//
// Prints counts and grpids only, never a measurement. Exits non-zero if
// anything failed: a page Withings would not serve (naming the error class),
// a group that could not be written to Drive or normalized (naming its grpid),
// or the sheet write. Groups fetched before a failure are still archived, and
// a missing THRIVE_API_URL/THRIVE_API_KEY costs the sheet write, never the
// archive. A group skipped as unattributed is noted, and is not a failure.

import { pathToFileURL } from 'node:url';
import { withingsWindow } from './src/dates.mjs';
import { createDrive } from './src/drive.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './src/google.mjs';
import { normalizeWithingsGroups, skippedNotes } from './src/normalize-withings.mjs';
import { redact } from './src/redact.mjs';
import { createThriveApi, loadThriveApiConfig } from './src/thrive-api.mjs';
import { createWithingsTokenStore } from './src/token-store.mjs';
import { createWithingsArchive } from './src/withings-archive.mjs';
import { fetchMeasureGroups } from './src/withings-measures.mjs';
import { getWithingsAccessToken } from './src/withings-tokens.mjs';

const describe = (err) => `${err?.name ?? 'Error'}: ${redact(err?.message || String(err))}`;

export const defaultDeps = {
  createDrive: (env) => createDrive({ getToken: googleTokenProvider(loadGoogleCredentials(env)) }),
  createTokenStore: createWithingsTokenStore,
  getAccessToken: getWithingsAccessToken,
  fetchMeasureGroups,
  createArchive: createWithingsArchive,
  createApi: (env) => createThriveApi(loadThriveApiConfig(env)),
};

/**
 * @param {{ env?: object, now?: () => number, deps?: object, print?: Function,
 *   printError?: Function, window?: { startdate: number, enddate: number },
 *   fetchImpl?: typeof fetch, retry?: object }} [opts]
 *   `window` overrides the rolling window; the backfill (#199) passes
 *   `startdate: 0`.
 * @returns {Promise<{ exitCode: number, counts: object, failed: string[], error: Error|null,
 *   sheet: { rows: number, appended: number, updated: number,
 *     skipped: { grpid: string, attrib: string }[],
 *     failed: { grpid: string, type: number|undefined, reason: string }[],
 *     notes: string, error: Error|null } }>}
 *   `counts` and `failed` are the archive's; `sheet` is the BodyMeasurements write.
 */
export async function withingsRun({
  env = process.env,
  now = () => Date.now(),
  deps = {},
  print = console.log,
  printError = console.error,
  window,
  fetchImpl = fetch,
  retry,
} = {}) {
  const d = { ...defaultDeps, ...deps };
  const counts = { seen: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const failed = [];
  const sheet = { rows: 0, appended: 0, updated: 0, skipped: [], failed: [], notes: '', error: null };

  let drive;
  let accessToken;
  try {
    drive = d.createDrive(env);
    ({ accessToken } = await d.getAccessToken({
      store: d.createTokenStore(drive),
      clientId: env.WITHINGS_CLIENT_ID,
      clientSecret: env.WITHINGS_CLIENT_SECRET,
      fetchImpl,
      now,
      ...(retry ? { retry } : {}),
    }));
  } catch (err) {
    printError(`Withings run failed before fetching: ${describe(err)}`);
    return { exitCode: 1, counts, failed, error: err, sheet };
  }

  const w = window ?? withingsWindow(now());
  const range = w.start ? `${w.start} to ${w.end}` : `startdate ${w.startdate} to enddate ${w.enddate}`;
  const { groups, pages, error } = await d.fetchMeasureGroups({
    fetchImpl, accessToken, startdate: w.startdate, enddate: w.enddate, ...(retry ? { retry } : {}),
  });
  counts.seen = groups.length;
  print(`Withings: ${groups.length} measure groups in ${pages} page(s), ${range}.`);

  const archive = d.createArchive(drive, { now });
  const archived = [];
  for (const group of groups) {
    try {
      const { status, fileId } = await archive.upsertGroup(group);
      counts[status] += 1;
      // Only a group with an archive file has a raw_ref, so only it is sent.
      if (fileId) archived.push({ group, raw_ref: fileId });
    } catch (err) {
      counts.failed += 1;
      failed.push(String(group?.grpid));
      printError(`Could not archive Withings group ${group?.grpid}: ${describe(err)}`);
    }
  }
  print(`Archive: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged, ` +
    `${counts.failed} failed.`);

  if (error) {
    printError(`Withings fetch ended early with ${describe(error)} ` +
      `The ${groups.length} groups fetched before it were archived; nothing from the error was.`);
  }

  await writeSheet({ d, env, now, archived, sheet, print, printError });

  const exitCode = error || counts.failed || sheet.failed.length || sheet.error ? 1 : 0;
  return { exitCode, counts, failed, error, sheet };
}

/**
 * Normalize the archived groups and upsert the rows (#198 AC5). Mutates
 * `sheet`. Runs after the archive, so a missing THRIVE_API_URL/KEY costs
 * this write alone.
 */
async function writeSheet({ d, env, now, archived, sheet, print, printError }) {
  const { rows, skipped, failed } = normalizeWithingsGroups(archived);
  sheet.rows = rows.length;
  sheet.skipped = skipped;
  sheet.failed = failed;
  sheet.notes = skippedNotes(skipped);
  for (const f of failed) printError(`Could not normalize Withings ${f.reason}`);
  if (sheet.notes) print(sheet.notes);

  try {
    const api = d.createApi(env);
    const totals = await api.upsertBodyMeasurements(rows, new Date(now()).toISOString());
    sheet.appended = totals.appended;
    sheet.updated = totals.updated;
  } catch (err) {
    sheet.error = err;
    printError(`BodyMeasurements not written: ${describe(err)}`);
  }
  print(`Sheet: ${archived.length} archived groups seen, ${sheet.appended} rows appended, ` +
    `${sheet.updated} updated, ${skipped.length} skipped as unattributed, ${failed.length} failed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  withingsRun()
    .then(({ exitCode }) => { process.exitCode = exitCode; })
    .catch((err) => {
      console.error(`withings-run failed: ${describe(err)}`);
      process.exit(1);
    });
}
