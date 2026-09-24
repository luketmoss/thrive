#!/usr/bin/env node
// One sync run (src/sync-run.mjs): token, archive, sheet, then the run's one
// SyncLog row (#156).
//
//   node run.mjs [--force-refresh]
//
// `--force-refresh` rotates even when the access token is fresh, to prove a
// rotated token survives into the next run (#151 AC4).
//
// `SYNC_LOG=summary` (set by the workflows) keeps COROS-derived data out of
// the public Actions log; the detail is in the SyncLog row instead. Unset, a
// local run logs everything.
//
// Exits non-zero if anything failed, so Actions' failure email fires
// (sync plan §10) — including a single activity that could not be fetched, a
// single date or activity whose text the parser did not know, or a SyncLog
// row that could not be written.

import { redact } from './src/redact.mjs';
import { syncRun } from './src/sync-run.mjs';

const force = process.argv.includes('--force-refresh') || process.env.FORCE_REFRESH === 'true';

syncRun({ force })
  .then(({ exitCode }) => {
    process.exitCode = exitCode;
  })
  .catch((err) => {
    // syncRun records its own failures; reaching here is a bug in it.
    const full = process.env.SYNC_LOG !== 'summary';
    console.error(full ? `${err.name ?? 'Error'}: ${redact(err.message || String(err))}` : `Unexpected ${err.name ?? 'Error'}.`);
    process.exit(1);
  });
