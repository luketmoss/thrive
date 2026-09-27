// Tests for board.mjs's `add` command (#216). Stubs `gh` (and, for the
// remote-dispatch case, `curl`) as fake executables on PATH so these run with
// no network and no real `gh`. Run with: node --test .thrive/board.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardScript = join(here, 'board.mjs');

function makeFakeBin(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'board-test-bin-'));
  const path = join(dir, 'gh');
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
  return dir;
}

// A fake `gh` that logs every invocation (one line of JSON per call) to
// GH_LOG and answers `project item-add` / `api graphql` from env vars.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.GH_LOG) fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'project' && args[1] === 'item-add') {
  if (process.env.GH_ITEM_ADD_FAIL === '1') {
    process.stderr.write('GraphQL: Could not resolve to an issue or pull request.\\n');
    process.exit(1);
  }
  process.stdout.write(process.env.GH_ITEM_ADD_JSON || '{}');
  process.exit(0);
}
if (args[0] === 'api' && args[1] === 'graphql') {
  process.stdout.write(process.env.GH_GRAPHQL_JSON || '{}');
  process.exit(0);
}
if (args[0] === 'project' && args[1] === 'item-list') {
  process.stderr.write('item-list should not be called by add\\n');
  process.exit(1);
}
if (args[0] === '--version') process.exit(0);
process.stderr.write('unexpected gh invocation: ' + JSON.stringify(args) + '\\n');
process.exit(1);
`;

function run(args, env = {}) {
  const binDir = makeFakeBin(FAKE_GH);
  const logFile = join(binDir, 'gh.log');
  try {
    const stdout = execFileSync(process.execPath, [boardScript, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GH_LOG: logFile,
        ...env,
      },
    });
    return { stdout, log: readLog(logFile) };
  } catch (err) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      status: err.status,
      log: readLog(logFile),
    };
  }
}

function readLog(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    // hasGh()'s own `gh --version` probe isn't part of what any command does.
    .filter((call) => call[0] !== '--version');
}

test('add: new issue is added to the board (AC1)', () => {
  const { stdout, log } = run(['add', '216'], {
    GH_ITEM_ADD_JSON: JSON.stringify({ id: 'PVTI_new' }),
  });
  assert.equal(stdout.trim(), '#216: added to the board');
  assert.equal(log.length, 1);
  assert.deepEqual(log[0], [
    'project', 'item-add', '4', '--owner', 'luketmoss',
    '--url', 'https://github.com/luketmoss/thrive/issues/216', '--format', 'json',
  ]);
});

test('add: an already-added issue is reported, not re-added (AC1)', () => {
  const { stdout, log } = run(['add', '216'], {
    GH_ITEM_ADD_JSON: JSON.stringify({ id: 'PVTI_existing', status: 'Refined' }),
  });
  assert.equal(stdout.trim(), '#216: already on the board');
  // Only the idempotent item-add call — never an item-list.
  assert.equal(log.length, 1);
  assert.equal(log[0][1], 'item-add');
});

test('add --status leaves an issue already on the board in its column', () => {
  const { stdout, log } = run(['add', '216', '--status', 'To Do'], {
    GH_ITEM_ADD_JSON: JSON.stringify({ id: 'PVTI_existing', status: 'PM Refining' }),
  });
  assert.equal(stdout.trim(), '#216: already on the board (PM Refining), left there — use set to move it');
  // item-add only: no status mutation, so a late add cannot undo a move.
  assert.equal(log.length, 1);
  assert.equal(log[0][1], 'item-add');
});

test('add --status sets the column on the item-add id, with no item-list call (AC2)', () => {
  const { stdout, log } = run(['add', '216', '--status', 'To Do'], {
    GH_ITEM_ADD_JSON: JSON.stringify({ id: 'PVTI_new' }),
  });
  assert.equal(stdout.trim(), '#216: added (To Do)');
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], [
    'project', 'item-add', '4', '--owner', 'luketmoss',
    '--url', 'https://github.com/luketmoss/thrive/issues/216', '--format', 'json',
  ]);
  assert.equal(log[1][0], 'api');
  assert.equal(log[1][1], 'graphql');
  assert.equal(log[1][2], '-f');
  assert.match(log[1][3], /itemId: "PVTI_new"/);
  assert.match(log[1][3], /singleSelectOptionId: "2ed3c08e"/); // "To Do" from board.json
  assert.ok(!log.some((call) => call[1] === 'item-list'));
});

test('add --status refuses an unknown column before adding anything (AC2)', () => {
  const { stderr, status, log } = run(['add', '216', '--status', 'Nonexistent Column']);
  assert.equal(status, 1);
  assert.match(stderr, /Unknown status "Nonexistent Column"/);
  assert.equal(log.length, 0); // nothing was added
});

test('add refuses with no issue number (AC3)', () => {
  const { stderr, status, log } = run(['add']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: board\.mjs add/);
  assert.equal(log.length, 0);
});

test('add refuses a non-numeric issue (AC3)', () => {
  const { stderr, status, log } = run(['add', 'abc']);
  assert.equal(status, 1);
  assert.match(stderr, /Usage: board\.mjs add/);
  assert.equal(log.length, 0);
});

test('add rewrites the gh error for an issue that does not exist (AC3)', () => {
  const { stderr, status } = run(['add', '999999'], { GH_ITEM_ADD_FAIL: '1' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #999999 not found in luketmoss/thrive.');
});

// AC4: without `gh`, `add` dispatches to board.yml exactly like `set`/`show` do.
test('add is allowed through the remote-dispatch path (AC4)', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'board-test-curl-'));
  const stateFile = join(binDir, 'state.json');
  const fakeCurl = `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('https://'));
const method = args[args.indexOf('-X') + 1];
const dataIdx = args.indexOf('--data');
const body = dataIdx === -1 ? null : JSON.parse(args[dataIdx + 1]);

function respond(obj, code) {
  process.stdout.write((obj === null ? '' : JSON.stringify(obj)) + '\\n' + code);
}

let state = {};
try { state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')); } catch {}

if (method === 'POST' && url.endsWith('/dispatches')) {
  state.args = body.client_payload.args;
  state.requestId = body.client_payload.request_id;
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
  respond(null, 200);
} else if (url.includes('/runs?event=repository_dispatch')) {
  respond({ workflow_runs: [{ id: 1, display_title: 'board [' + state.requestId + ']', status: 'completed' }] }, 200);
} else if (/\\/runs\\/1$/.test(url)) {
  respond({ id: 1, status: 'completed', html_url: 'https://example/run/1' }, 200);
} else if (url.endsWith('/runs/1/jobs')) {
  respond({ jobs: [{ id: 11 }] }, 200);
} else if (url.includes('/check-runs/11/annotations')) {
  respond([
    { title: 'board-out 0', message: '#216: added (To Do)' },
    { title: 'board-exit', message: '0' },
  ], 200);
} else {
  respond({ message: 'unexpected request: ' + url }, 500);
}
`;
  const curlPath = join(binDir, 'curl');
  writeFileSync(curlPath, fakeCurl);
  chmodSync(curlPath, 0o755);

  const stdout = execFileSync(process.execPath, [boardScript, 'add', '216', '--status', 'To Do'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // PATH holds only our fake `curl` — no real `gh` (CI runners ship one),
      // so hasGh() reliably fails and runRemotely takes over. The fake
      // curl's shebang is an absolute path to this same node, so PATH needs
      // nothing else to resolve it.
      PATH: binDir,
      GH_TOKEN: 'fake-token',
    },
  });

  assert.equal(stdout.trim(), '#216: added (To Do)');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(state.args, ['add', '216', '--status', 'To Do']);
});

// #224: `show` and `set` look up an issue's project item with one small
// GraphQL query on the issue itself, instead of `gh project item-list`.

function graphqlResponse({ number = 224, title = 'Test issue', url = 'https://github.com/luketmoss/thrive/issues/224', nodes }) {
  return JSON.stringify({
    data: { repository: { issue: { number, title, url, projectItems: { nodes } } } },
  });
}

function notFoundResponse() {
  return JSON.stringify({ data: { repository: { issue: null } } });
}

test('show: finds the item with a single graphql lookup, not a listing (AC1)', () => {
  const { stdout, log } = run(['show', '224'], {
    GH_GRAPHQL_JSON: graphqlResponse({
      nodes: [{ id: 'PVTI_224', project: { number: 4 }, fieldValueByName: { name: 'Testing' } }],
    }),
  });
  assert.equal(stdout.trim(), [
    '#224  Test issue',
    'Status: Testing',
    'https://github.com/luketmoss/thrive/issues/224',
  ].join('\n'));
  assert.equal(log.length, 1);
  assert.equal(log[0][0], 'api');
  assert.equal(log[0][1], 'graphql');
  assert.equal(log[0][2], '-f');
  assert.match(log[0][3], /^query=/);
  assert.match(log[0][3], /issue\(number: \$number\)/);
  assert.match(log[0][3], /project \{ number \}/);
  assert.deepEqual(log[0].slice(4), ['-f', 'owner=luketmoss', '-f', 'repo=thrive', '-F', 'number=224']);
  assert.ok(!log.some((call) => call[1] === 'item-list'));
});

test('show: finds an item regardless of its position among the issue\'s project items (AC2)', () => {
  // Build 25 unrelated project-item nodes (more than fit in an item-list page
  // of 200 by proportion) plus the real one at the end, proving the result
  // does not depend on position.
  const decoys = Array.from({ length: 25 }, (_, i) => ({
    id: `PVTI_decoy_${i}`, project: { number: 99 }, fieldValueByName: null,
  }));
  const { stdout, log } = run(['show', '224'], {
    GH_GRAPHQL_JSON: graphqlResponse({
      nodes: [...decoys, { id: 'PVTI_224', project: { number: 4 }, fieldValueByName: { name: 'Refined' } }],
    }),
  });
  assert.match(stdout, /Status: Refined/);
  assert.equal(log.length, 1);
});

test('show: an item with no status prints (none) (AC1)', () => {
  const { stdout } = run(['show', '224'], {
    GH_GRAPHQL_JSON: graphqlResponse({
      nodes: [{ id: 'PVTI_224', project: { number: 4 }, fieldValueByName: null }],
    }),
  });
  assert.match(stdout, /Status: \(none\)/);
});

test('show: issue exists but is not on project #4 (AC3)', () => {
  const { stderr, status } = run(['show', '224'], {
    GH_GRAPHQL_JSON: graphqlResponse({
      nodes: [{ id: 'PVTI_other', project: { number: 7 }, fieldValueByName: { name: 'Done' } }],
    }),
  });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #224 is not on project #4. Add it with: node .thrive/board.mjs add 224');
});

test('show: issue exists but is on no project at all (AC3)', () => {
  const { stderr, status } = run(['show', '224'], {
    GH_GRAPHQL_JSON: graphqlResponse({ nodes: [] }),
  });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #224 is not on project #4. Add it with: node .thrive/board.mjs add 224');
});

test('show: no such issue (AC3)', () => {
  const { stderr, status } = run(['show', '999999'], {
    GH_GRAPHQL_JSON: notFoundResponse(),
  });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #999999 not found in luketmoss/thrive.');
});

test('set: moves the status with 2 gh calls — the lookup, then the mutation (AC1)', () => {
  const { stdout, log } = run(['set', '224', '--status', 'Testing'], {
    GH_GRAPHQL_JSON: graphqlResponse({
      nodes: [{ id: 'PVTI_224', project: { number: 4 }, fieldValueByName: { name: 'In Development' } }],
    }),
  });
  assert.equal(stdout.trim(), '#224: In Development -> Testing');
  assert.equal(log.length, 2);
  assert.equal(log[0][1], 'graphql');
  assert.equal(log[1][1], 'graphql');
  assert.match(log[1][3], /itemId: "PVTI_224"/);
  assert.match(log[1][3], /singleSelectOptionId: "1bd1ca27"/); // "Testing" from board.json
  assert.ok(!log.some((call) => call[1] === 'item-list'));
});

test('set: an item already in the target status makes only 1 gh call (AC1)', () => {
  const { stdout, log } = run(['set', '224', '--status', 'Testing'], {
    GH_GRAPHQL_JSON: graphqlResponse({
      nodes: [{ id: 'PVTI_224', project: { number: 4 }, fieldValueByName: { name: 'Testing' } }],
    }),
  });
  assert.equal(stdout.trim(), '#224 already in Testing.');
  assert.equal(log.length, 1);
});

test('set: issue not on project #4 (AC3)', () => {
  const { stderr, status } = run(['set', '224', '--status', 'Testing'], {
    GH_GRAPHQL_JSON: graphqlResponse({ nodes: [] }),
  });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #224 is not on project #4. Add it with: node .thrive/board.mjs add 224');
});

test('set: no such issue (AC3)', () => {
  const { stderr, status } = run(['set', '999999', '--status', 'Testing'], {
    GH_GRAPHQL_JSON: notFoundResponse(),
  });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #999999 not found in luketmoss/thrive.');
});

test('list: still uses item-list, unaffected by the findItem rewrite (AC4)', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'board-test-bin-'));
  const path = join(binDir, 'gh');
  writeFileSync(path, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.GH_LOG) fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'project' && args[1] === 'item-list') {
  process.stdout.write(JSON.stringify({ items: [{ id: 'PVTI_224', status: 'Refined', content: { number: 224, title: 'Test issue', url: 'https://x' } }] }));
  process.exit(0);
}
if (args[0] === '--version') process.exit(0);
process.stderr.write('unexpected gh invocation: ' + JSON.stringify(args) + '\\n');
process.exit(1);
`);
  chmodSync(path, 0o755);
  const logFile = join(binDir, 'gh.log');
  const stdout = execFileSync(process.execPath, [boardScript, 'list', '--status', 'Refined'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, GH_LOG: logFile },
  });
  assert.match(stdout, /#224\s+\[Refined\]\s+Test issue/);
  const log = readLog(logFile);
  assert.equal(log.length, 1);
  assert.equal(log[0][1], 'item-list');
});
