#!/usr/bin/env node
// The dead-man's switch (#156): exits 1 when the newest SyncLog row is older
// than the threshold, so Actions' failure email reports a sync that stopped
// firing. Run by .github/workflows/coros-sync-watchdog.yml.
//
//   node deadman.mjs [--threshold-hours 16] [--now 2026-09-25T12:00:00Z]
//   node deadman.mjs --log withings    (WithingsSyncLog, 14 h; #200)
//
// Without `--log` it reads only SyncLog, exactly as before #200.
// .github/workflows/withings-sync-watchdog.yml runs the Withings check.
//
// `--now` and `--threshold-hours` exist to prove it trips without touching
// real data. Needs THRIVE_API_URL and THRIVE_API_KEY, and no npm install: it
// imports nothing outside src/thrive-api.mjs and src/redact.mjs.
//
// Its output names run IDs, timestamps and a status, never vendor data, so it
// is safe in a public Actions log.

import { checkFreshness, parseDeadmanArgs } from './src/deadman.mjs';
import { createThriveApi, loadThriveApiConfig } from './src/thrive-api.mjs';

try {
  const { now, thresholdHours, log } = parseDeadmanArgs(process.argv.slice(2), process.env);
  const api = createThriveApi(loadThriveApiConfig());
  const result = await checkFreshness({ api, now, thresholdHours, log });
  (result.ok ? console.log : console.error)(result.message);
  process.exitCode = result.ok ? 0 : 1;
} catch (err) {
  // A config error names the missing secrets; nothing here carries vendor data.
  console.error(`${err.name ?? 'Error'}: ${err.message}`);
  process.exitCode = 1;
}
