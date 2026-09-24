#!/usr/bin/env node
// One sync run: get a COROS access token — refreshing and persisting it if it
// is near expiry (#151) — then land the window's raw COROS payloads in the
// bot account's Drive (#152). Nothing is written to the sheet yet (#153).
//
//   node run.mjs [--force-refresh]
//
// `--force-refresh` rotates even when the access token is fresh, to prove a
// rotated token survives into the next run (#151 AC4).
//
// Exits non-zero if anything failed, so Actions' failure email fires
// (sync plan §10) — including a single activity that could not be fetched.

import { createArchive } from './src/archive.mjs';
import { createDrive } from './src/drive.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './src/google.mjs';
import { ingest, REQUIRED_TOOLS } from './src/ingest.mjs';
import { connectCoros } from './src/mcp.mjs';
import { redact } from './src/redact.mjs';
import { createTokenStore } from './src/token-store.mjs';
import { getAccessToken } from './src/tokens.mjs';

async function main() {
  const force = process.argv.includes('--force-refresh') || process.env.FORCE_REFRESH === 'true';

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

    const summary = await ingest({ client, archive: createArchive(drive) });
    const { created, updated, unchanged } = summary.activities;
    console.log(
      `Activities: ${created} created, ${updated} updated, ${unchanged} unchanged. ` +
      `Health: ${summary.health ?? 'not written'}.`,
    );
    if (summary.failures.length) {
      console.error(`${summary.failures.length} failure(s):`);
      for (const f of summary.failures) console.error(`  ${f}`);
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
