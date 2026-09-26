#!/usr/bin/env node
// One-time: authorize Thrive against Withings and write the first token set to
// Drive (#196 AC2). Re-run it whenever a run fails with WithingsGrantDeadError.
//
//   WITHINGS_CLIENT_ID=… WITHINGS_CLIENT_SECRET=… node withings-authorize.mjs
//
// Needs the Google credential from google-authorize.mjs first.
//
// Withings refuses localhost redirects, so the browser lands on a static page
// (frontend/public/withings-callback.html) that shows the code, and the code
// is pasted back here. It is valid for 30 seconds, so it is exchanged the
// moment it arrives; a code that expired first is asked for again.

import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { createDrive } from './src/drive.mjs';
import { googleTokenProvider, loadGoogleCredentials } from './src/google.mjs';
import { openBrowser } from './src/loopback.mjs';
import { redact, registerSecret } from './src/redact.mjs';
import { createWithingsTokenStore } from './src/token-store.mjs';
import {
  buildWithingsAuthorizeUrl, countRecentMeasureGroups, exchangeWithingsCode,
  isWithingsInvalidGrant, parseWithingsPaste,
} from './src/withings-oauth.mjs';
import { classifyWithingsError } from './src/withings-tokens.mjs';

/** New prompts after the first, for an expired, spent or unusable paste. */
export const MAX_REPROMPTS = 3;

/**
 * The whole flow, with every effect passed in so tests need no terminal,
 * browser, network or Drive.
 *
 * @param {object} deps
 * @param {() => Promise<string|null>} deps.readPaste  the next pasted line; null at end of input
 * @returns {Promise<{ fileId: string, measureGroups: number }>}
 */
export async function authorizeWithings({
  clientId,
  clientSecret,
  store,
  readPaste,
  fetchImpl = fetch,
  print = console.log,
  open = openBrowser,
  now = () => Date.now(),
  state = randomBytes(16).toString('hex'),
}) {
  if (!clientId || !clientSecret) {
    throw new Error('Set WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET first. See sync/README.md.');
  }
  registerSecret(clientSecret);
  const url = buildWithingsAuthorizeUrl(clientId, state);

  const prompt = (again) => {
    print(`${again ? 'Sign in again' : 'Sign in to Withings'}. Opening your browser; if it does not open, visit:\n\n  ${url}\n`);
    print('Then copy the "Authorization response" from the page and paste it here within 30 seconds.');
    open(url);
  };

  prompt(false);
  for (let attempt = 0; attempt <= MAX_REPROMPTS; attempt++) {
    if (attempt > 0) prompt(true);
    const pasted = await readPaste();
    if (pasted === null) throw new Error('No authorization response was pasted.');
    const { code, state: returned, error } = parseWithingsPaste(pasted);
    registerSecret(code);

    if (error) {
      print(`Withings returned an error instead of a code: ${redact(error)}.`);
      continue;
    }
    if (!code) {
      print('That paste holds no authorization code.');
      continue;
    }
    if (returned !== null && returned !== state) {
      print('Refused: that response\'s state does not match this sign-in, so it came from another one.');
      continue;
    }

    let tokens;
    try {
      tokens = await exchangeWithingsCode(fetchImpl, { clientId, clientSecret, code }, now());
    } catch (err) {
      if (!isWithingsInvalidGrant(err)) throw classifyWithingsError(err);
      print('Withings refused that code as expired or already used (a code lasts 30 seconds).');
      continue;
    }

    const fileId = await store.save(tokens);
    print(`\nSaved the Withings token set to Drive (Thrive Withings/withings-token.json, file ${fileId}).`);
    print(`Access token valid until ${tokens.access_expires_at}.`);

    let measureGroups;
    try {
      measureGroups = await countRecentMeasureGroups(fetchImpl, tokens.access_token, now());
    } catch (err) {
      throw classifyWithingsError(err);
    }
    print(`Checked: an authenticated user.metrics call returned ${measureGroups} measure groups from the last 30 days.`);
    return { fileId, measureGroups };
  }
  throw new Error(`No usable authorization code after ${MAX_REPROMPTS + 1} tries. Run the script again.`);
}

async function main() {
  const drive = createDrive({ getToken: googleTokenProvider(loadGoogleCredentials()) });
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  try {
    await authorizeWithings({
      clientId: process.env.WITHINGS_CLIENT_ID,
      clientSecret: process.env.WITHINGS_CLIENT_SECRET,
      store: createWithingsTokenStore(drive),
      readPaste: async () => {
        process.stdout.write('> ');
        const { value, done } = await lines.next();
        return done ? null : value;
      },
    });
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`withings-authorize failed: ${err.name}: ${redact(err.message || String(err))}`);
    process.exit(1);
  });
}
