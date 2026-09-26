#!/usr/bin/env node
// Visual checks where the desktop app's Browser pane is missing (cloud Claude
// Code sessions). Drives the demo-mode app with the container's Playwright and
// Chromium; screenshots are files the agent opens with Read.
//
//   node .thrive/look.mjs [route] [--width 375] [--theme light|dark] [--out shot.png]
//     route is the hash path, e.g. /templates or /history/abc (default /).
//     Prints the screenshot path and any console errors.
//
//   import { open } from '<repo>/.thrive/look.mjs';
//   const { page, errors, close } = await open({ route: '/templates', width: 375, theme: 'dark' });
//     For flows: click, fill, page.evaluate for computed CSS, page.screenshot.
//
// The dev server is started on first use (npm ci too, if needed) and left
// running on :5173 for the next call. Stop it with: pkill -f vite

import { execSync, spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const base = 'http://localhost:5173/thrive/';

async function serving() {
  try {
    return (await fetch(base)).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serving()) return;
  // Something else holds the port: most likely another repo's dev server in
  // the same session (Thrive, Hive and cairn all use 5173).
  if (await fetch('http://localhost:5173/').then(() => true, () => false)) {
    throw new Error(`Port 5173 is serving something other than ${base}. Stop it (pkill -f vite) and retry.`);
  }
  if (!existsSync(join(frontend, 'node_modules'))) {
    execSync('npm ci --no-audit --no-fund', { cwd: frontend, stdio: 'inherit' });
  }
  const vite = join(frontend, 'node_modules', 'vite', 'bin', 'vite.js');
  spawn(process.execPath, [vite, '--port', '5173', '--strictPort'], {
    cwd: frontend, detached: true, stdio: 'ignore',
  }).unref();
  for (let i = 0; i < 60; i++) {
    if (await serving()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Vite did not come up on :5173.');
}

// Cloud containers send HTTPS through a proxy that re-signs it with its own CA.
// curl and Node trust that CA; Playwright's Chromium does not, so every
// external script fails with ERR_CERT_AUTHORITY_INVALID. Trust exactly that
// CA's key, which is what adding it to the store would do. Checking stays on.
function proxyTrust() {
  const ca = '/root/.ccr/agent-proxy-ca.crt';
  if (!existsSync(ca)) return [];
  const spki = new X509Certificate(readFileSync(ca)).publicKey.export({ type: 'spki', format: 'der' });
  return [`--ignore-certificate-errors-spki-list=${createHash('sha256').update(spki).digest('base64')}`];
}

// Not a frontend dependency: cloud containers install it globally.
async function playwright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(root, 'noop.js'))('playwright');
  }
}

export async function open({ route = '/', width = 375, height = 812, theme = 'light' } = {}) {
  await ensureServer();
  const { chromium } = await playwright();
  const browser = await chromium.launch({ args: proxyTrust() });
  // colorScheme drives the app's System theme, the default in demo mode.
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?demo=true#${route}`, { waitUntil: 'networkidle' });
  return { page, errors, close: () => browser.close() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? fallback : argv[i + 1];
  };
  const route = argv[0] && !argv[0].startsWith('--') ? argv[0] : '/';
  const width = Number(flag('width', 375));
  const theme = flag('theme', 'light');
  const out = resolve(flag('out', `look-${width}-${theme}.png`));

  const { page, errors, close } = await open({ route, width, theme });
  await page.screenshot({ path: out, fullPage: true });
  await close();
  console.log(out);
  if (errors.length) console.log(`Console errors:\n${errors.map((e) => `  ${e}`).join('\n')}`);
}
