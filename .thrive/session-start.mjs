#!/usr/bin/env node
// SessionStart hook (.claude/settings.json). A cloud Claude Code session starts
// from a fresh clone with no node_modules, so tests and the dev server fail
// until someone installs. This installs every package that has tests, in
// parallel, in a few seconds. Anywhere else (desktop) it does nothing.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = ['frontend', 'mcp-server', 'sync', 'apps-script']
  .filter((p) => !existsSync(join(root, p, 'node_modules')));

const results = await Promise.all(packages.map((p) => new Promise((done) => {
  const npm = spawn('npm', ['ci', '--no-audit', '--no-fund'], { cwd: join(root, p), stdio: 'ignore' });
  npm.on('close', (code) => done(`${p}: ${code === 0 ? 'installed' : `npm ci failed (${code})`}`));
  npm.on('error', (e) => done(`${p}: ${e.message}`));
})));

// Never fail the session start over this; the next npm test says what is wrong.
if (results.length) console.log(results.join('\n'));
