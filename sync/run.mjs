#!/usr/bin/env node
// One sync run. For now (#151) it proves authorization: get a COROS access
// token — refreshing and persisting it if it is near expiry — then make one
// authenticated read. #152 adds ingestion after the token step.
//
//   node run.mjs [--force-refresh]
//
// `--force-refresh` rotates even when the access token is fresh, to prove a
// rotated token survives into the next run (#151 AC4).

import { createDrive } from './src/drive.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './src/google.mjs';
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
    // A read with no arguments and nothing personal in the log line.
    const devices = await client.callTool({ name: 'queryDevices', arguments: {} });
    if (devices.isError) throw new Error('queryDevices returned an error result');
    console.log(`Authenticated: ${tools.length} COROS tools listed, queryDevices read OK.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`${err.name ?? 'Error'}: ${redact(err.message || String(err))}`);
  process.exit(1);
});
