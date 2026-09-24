#!/usr/bin/env node
// One sync run: get a COROS access token — refreshing and persisting it if it
// is near expiry (#151) — land the window's raw COROS payloads in the bot
// account's Drive (#152), then normalize from that archive into the sheet
// through the Thrive API: DailyHealth (#165), then the DailySummary rollup.
//
//   node run.mjs [--force-refresh]
//
// `--force-refresh` rotates even when the access token is fresh, to prove a
// rotated token survives into the next run (#151 AC4).
//
// Exits non-zero if anything failed, so Actions' failure email fires
// (sync plan §10) — including a single activity that could not be fetched, or
// a single date whose health text was in a format the parser did not know.

import { createArchive } from './src/archive.mjs';
import { createDrive } from './src/drive.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './src/google.mjs';
import { ingest, REQUIRED_TOOLS } from './src/ingest.mjs';
import { connectCoros } from './src/mcp.mjs';
import { redact } from './src/redact.mjs';
import { writeSheet } from './src/sheet.mjs';
import { createThriveApi, loadThriveApiConfig } from './src/thrive-api.mjs';
import { createTokenStore } from './src/token-store.mjs';
import { getAccessToken } from './src/tokens.mjs';

async function main() {
  const force = process.argv.includes('--force-refresh') || process.env.FORCE_REFRESH === 'true';
  // The run's single timestamp: every row it writes carries this synced_at.
  const syncedAt = new Date().toISOString();

  const drive = createDrive({ getToken: googleTokenProvider(loadGoogleCredentials()) });
  const store = createTokenStore(drive);
  const { accessToken, refreshed } = await getAccessToken({ store, force });
  console.log(refreshed ? 'COROS token refreshed and saved to Drive.' : 'COROS token still fresh; not refreshed.');

  const client = await connectCoros(accessToken);
  try {
    const { tools } = await client.listTools();
    const missing = REQUIRED_TOOLS.filter((name) => !tools.some((t) => t.name === name));
    if (missing.length) {
      throw new Error(`COROS no longer offers ${missing.join(', ')}. Check tools/list and update sync/src/ingest.mjs.`);
    }
    console.log(`Authenticated: ${tools.length} COROS tools listed.`);

    const archive = createArchive(drive);
    const summary = await ingest({ client, archive, now: Date.parse(syncedAt) });
    const { created, updated, unchanged } = summary.activities;
    console.log(
      `Activities: ${created} created, ${updated} updated, ${unchanged} unchanged. ` +
      `Health: ${summary.health ?? 'not written'}.`,
    );

    // The archive has landed whatever happens next, so a missing API secret
    // costs the sheet write, never the raw data.
    console.log('Sheet:');
    const failures = [...summary.failures];
    try {
      const api = createThriveApi(loadThriveApiConfig());
      const sheet = await writeSheet({ archive, api, window: summary.window, syncedAt });
      failures.push(...sheet.failures);
    } catch (err) {
      failures.push(redact(err.message || String(err)));
    }

    if (failures.length) {
      console.error(`${failures.length} failure(s):`);
      for (const f of failures) console.error(`  ${f}`);
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`${err.name ?? 'Error'}: ${redact(err.message || String(err))}`);
  process.exit(1);
});
