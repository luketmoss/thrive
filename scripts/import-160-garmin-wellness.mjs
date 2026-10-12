/**
 * import-160-garmin-wellness.mjs — One-time, re-runnable import of the Garmin
 * Connect export's daily wellness history into `DailyHealth` (#160).
 *
 * Reads an EXTRACTED export folder (`--export <dir>`, the one holding
 * `DI-Connect-Aggregator/UDSFile_*.json` and `DI-Connect-Wellness/*_sleepData.json`)
 * and writes through the API (`upsertDailyHealth`), like backfill-231. No schema
 * change: DailyHealth already has its 19 columns.
 *
 * Blank means the export did not say, never `0`:
 *
 * - A day with no/zero steps AND no resting HR is a no-wear day: steps, calories
 *   and resting HR stay blank (its calories are resting burn only).
 * - Stress is `allDayStress.aggregatorList[type=TOTAL].averageStressLevel`;
 *   a negative value is the export's "no reading" and stays blank.
 * - Sleep: `UNCONFIRMED` windows are a default schedule and are skipped. Any
 *   other night gets bed/wake (local HH:mm, via that date's UDS UTC offset).
 *   Stages are written only when deep, light or REM is above 0 (REM only if
 *   the key exists); the total is then the stage sum, otherwise the window
 *   length. Both include awake time, like COROS's total.
 *
 * Fill-only: an existing row only gets cells that are blank, so a second run
 * writes nothing. Dates after LAST_DATE are never written (COROS owns them).
 * Writes are capped (`--max-rows`) and paced (`--batch`, `--pause-ms`); re-run
 * until it says there is nothing to write. It writes no SyncLog row and does
 * not rebuild DailySummary (#162).
 *
 * Usage:
 *   node scripts/import-160-garmin-wellness.mjs --export <dir> --dry-run
 *   node scripts/import-160-garmin-wellness.mjs --export <dir> --max-rows 200
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIRST_DATE = '2017-06-30';
export const LAST_DATE = '2026-09-19';
export const DEFAULTS = { maxRows: 500, batch: 20, pauseMs: 1000 };

const FIELDS = [
  'resting_hr', 'steps', 'calories', 'stress_avg', 'sleep_total_s', 'sleep_deep_s',
  'sleep_rem_s', 'sleep_light_s', 'sleep_awake_s', 'bed_time', 'wake_time',
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (n) => String(Math.round(n));
const gmtMs = (s) => Date.parse(`${String(s).replace(/\.\d+$/, '')}Z`);

/** Local - GMT, in ms, from a UDS row's day-start stamps; null when absent. */
export function utcOffsetMs(uds) {
  if (!uds || !uds.wellnessStartTimeLocal || !uds.wellnessStartTimeGmt) return null;
  const d = gmtMs(uds.wellnessStartTimeLocal) - gmtMs(uds.wellnessStartTimeGmt);
  return Number.isFinite(d) ? d : null;
}

const hhmm = (ms, offsetMs) => new Date(ms + offsetMs).toISOString().slice(11, 16);

/** The UDS-derived fields of one day. */
export function mapUds(uds) {
  const out = {};
  const hasHr = isNum(uds.restingHeartRate);
  const worn = hasHr || (isNum(uds.totalSteps) && uds.totalSteps > 0);
  if (hasHr) out.resting_hr = str(uds.restingHeartRate);
  if (worn) {
    if (isNum(uds.totalSteps)) out.steps = str(uds.totalSteps);
    if (isNum(uds.totalKilocalories) && uds.totalKilocalories > 0) out.calories = str(uds.totalKilocalories);
  }
  const total = (uds.allDayStress?.aggregatorList ?? []).find((a) => a.type === 'TOTAL');
  if (total && isNum(total.averageStressLevel) && total.averageStressLevel >= 0) {
    out.stress_avg = str(total.averageStressLevel);
  }
  return out;
}

/** The sleep fields of one night; `offsetMs` null leaves bed/wake blank. */
export function mapSleep(sleep, offsetMs) {
  const out = {};
  if (!sleep || sleep.sleepWindowConfirmationType === 'UNCONFIRMED') return out;
  const start = gmtMs(sleep.sleepStartTimestampGMT);
  const end = gmtMs(sleep.sleepEndTimestampGMT);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return out;

  if (offsetMs !== null) {
    out.bed_time = hhmm(start, offsetMs);
    out.wake_time = hhmm(end, offsetMs);
  }
  const staged = ['deepSleepSeconds', 'lightSleepSeconds', 'remSleepSeconds']
    .some((k) => isNum(sleep[k]) && sleep[k] > 0);
  if (!staged) {
    out.sleep_total_s = str((end - start) / 1000);
    return out;
  }
  const parts = {
    sleep_deep_s: sleep.deepSleepSeconds,
    sleep_light_s: sleep.lightSleepSeconds,
    sleep_rem_s: sleep.remSleepSeconds,
    sleep_awake_s: sleep.awakeSleepSeconds,
  };
  let sum = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (!isNum(v)) continue;
    out[k] = str(v);
    sum += v;
  }
  out.sleep_total_s = str(sum);
  return out;
}

/**
 * One entry per date in range with at least one value.
 * @returns {{ days: Map<string, object>, skipped: string[], byType: object }}
 */
export function buildDays(udsRows, sleepRows) {
  const udsByDate = new Map();
  const skipped = [];
  for (const u of udsRows) {
    const d = String(u.calendarDate ?? '').slice(0, 10);
    if (d < FIRST_DATE || d > LAST_DATE) { skipped.push(d); continue; }
    udsByDate.set(d, u);
  }
  const sleepByDate = new Map();
  for (const s of sleepRows) {
    const d = String(s.calendarDate ?? '').slice(0, 10);
    if (d < FIRST_DATE || d > LAST_DATE) { skipped.push(d); continue; }
    sleepByDate.set(d, s);
  }
  const byType = {};
  for (const s of sleepByDate.values()) {
    byType[s.sleepWindowConfirmationType] = (byType[s.sleepWindowConfirmationType] ?? 0) + 1;
  }

  const days = new Map();
  for (const d of [...new Set([...udsByDate.keys(), ...sleepByDate.keys()])].sort()) {
    const uds = udsByDate.get(d);
    const fields = {
      ...(uds ? mapUds(uds) : {}),
      ...mapSleep(sleepByDate.get(d), uds ? utcOffsetMs(uds) : null),
    };
    if (Object.keys(fields).length) days.set(d, fields);
  }
  return { days, skipped, byType };
}

/** Fill-only plan against the sheet's rows: `{ date, ...fieldsToWrite }[]`. */
export function planImport(days, existingRows) {
  const existing = new Map(existingRows.map((r) => [r.date, r]));
  const writes = [];
  for (const [date, fields] of days) {
    if (date > LAST_DATE) continue;
    const have = existing.get(date);
    const row = { date };
    for (const [k, v] of Object.entries(fields)) {
      if (!have || String(have[k] ?? '').trim() === '') row[k] = v;
    }
    if (Object.keys(row).length > 1) writes.push(row);
  }
  return writes;
}

/** Every UDS/sleep file under `dir`, parsed. */
export function readExport(dir) {
  const uds = [];
  const sleep = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const bucket = /^UDSFile_.*\.json$/.test(name) ? uds : /_sleepData\.json$/.test(name) ? sleep : null;
      if (bucket) bucket.push(...JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')));
    }
  };
  walk(dir);
  return { uds, sleep };
}

/** @returns {Promise<number>} the exit code */
export async function importWellness({
  api, exportData, dryRun = false, maxRows = DEFAULTS.maxRows, batch = DEFAULTS.batch,
  pauseMs = DEFAULTS.pauseMs, now = () => new Date().toISOString(),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, error = console.error,
}) {
  const { days, skipped, byType } = buildDays(exportData.uds, exportData.sleep);
  const existing = await api.get('getDailyHealth', {});
  const writes = planImport(days, existing);
  const thisRun = writes.slice(0, maxRows);

  log(`days with data in ${FIRST_DATE}..${LAST_DATE}: ${days.size}`);
  if (skipped.length) log(`skipped, out of range: ${skipped.join(', ')}`);
  log(`sleep windows by type: ${JSON.stringify(byType)}`);
  for (const f of FIELDS) log(`  ${f.padEnd(14)} ${writes.filter((w) => f in w).length}`);
  log(`to write: ${writes.length}${writes.length > thisRun.length ? ` (${thisRun.length} this run, capped by --max-rows ${maxRows})` : ''}`);

  if (!thisRun.length) { log('\nNothing to write.'); return 0; }
  if (dryRun) { log('\n--dry-run: nothing written.'); return 0; }

  const syncedAt = now();
  let written = 0;
  for (let i = 0; i < thisRun.length; i += batch) {
    const chunk = thisRun.slice(i, i + batch);
    if (i > 0 && pauseMs > 0) await wait(pauseMs);
    try {
      await api.upsertDailyHealth(chunk, syncedAt);
    } catch (err) {
      error(`FAILED writing ${chunk[0].date}..${chunk.at(-1).date}: ${String(err.message || err).slice(0, 200)}`);
      error(`${written} row(s) were written before it. Re-run to continue: written cells are skipped.`);
      return 1;
    }
    written += chunk.length;
    log(`wrote ${chunk[0].date}..${chunk.at(-1).date} (${chunk.length})`);
  }
  log(`\nWrote ${written} row(s).${writes.length > written ? ` ${writes.length - written} left: re-run to continue.` : ''}`);
  return 0;
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
  const { redact } = await import('../sync/src/redact.mjs');
  try {
    process.exitCode = await importWellness({
      api: createThriveApi(loadThriveApiConfig()), exportData: readExport(dir),
      dryRun: args.includes('--dry-run'), maxRows: num('--max-rows', DEFAULTS.maxRows),
      batch: num('--batch', DEFAULTS.batch), pauseMs: num('--pause-ms', DEFAULTS.pauseMs),
    });
  } catch (err) {
    console.error(`${err.name ?? 'Error'}: ${redact(err.message || String(err))}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
