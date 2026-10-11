// Tests for board.mjs's `add` command (#216, #416) and its choice between running
// `gh` and dispatching to board.yml (#405). Stubs `gh` (and, for the
// remote-dispatch cases, `curl`) as fake executables on PATH so these run with
// no network and no real `gh`. Run with: node --test .thrive/board.test.mjs
// (Not on Windows: the fakes are `#!` scripts it cannot run, so the real `gh`
// would run and these tests would move real board cards. They skip there.)

import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardScript = join(here, 'board.mjs');

// On Windows the fake `gh` does not run, so the real one would. Skip unless
// something else stands in for `gh` and `curl` (BOARD_TEST_HERMETIC=1).
const unsafe = process.platform === 'win32' && !process.env.BOARD_TEST_HERMETIC;
const test = unsafe
  ? (name, fn) => nodeTest(name, { skip: 'needs a non-Windows machine: the fake gh would not run' }, fn)
  : nodeTest;

// The environment the tests start from: nothing that routes a command to
// board.yml or authenticates a dispatch leaks in from the machine running them.
function cleanEnv() {
  const { BOARD_REMOTE, BOARD_ARGS, GH_TOKEN, GITHUB_TOKEN, ...rest } = process.env;
  return rest;
}

// A `curl` that refuses and records the call: a test that did not ask for a
// dispatch must never reach a real one.
function refusingCurlSource(refusedFile) {
  return `#!${process.execPath}
require('fs').appendFileSync(${JSON.stringify(refusedFile)}, process.argv.slice(2).join(' ') + '\\n');
process.stderr.write('this test did not expect a dispatch\\n');
process.exit(7);
`;
}

function makeFakeBin(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'board-test-bin-'));
  const path = join(dir, 'gh');
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
  writeFileSync(join(dir, 'curl'), refusingCurlSource(join(dir, 'curl.refused')));
  chmodSync(join(dir, 'curl'), 0o755);
  return dir;
}

// A command that was dispatched to board.yml when the test did not ask for it.
function assertNoStrayDispatch(binDir) {
  if (existsSync(join(binDir, 'curl.refused'))) {
    throw new Error('board.mjs dispatched to board.yml in a test that did not ask for it');
  }
}

// A fake `gh` that logs every invocation (one line of JSON per call) to
// GH_LOG and answers `project item-add` / `api graphql` from env vars.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.GH_LOG) fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'project' && args[1] === 'item-add') {
  if (process.env.GH_ITEM_ADD_FAIL === '1') {
    process.stderr.write(process.env.GH_FAIL_STDERR || 'GraphQL: Could not resolve to an issue or pull request.\\n');
    process.exit(1);
  }
  process.stdout.write(process.env.GH_ITEM_ADD_JSON || '{}');
  process.exit(0);
}
if (args[0] === 'api' && args[1] === 'graphql') {
  // #405: the project probe is the one query that names node(id: $id).
  if (args.some((a) => a.includes('node(id: $id)'))) {
    if (process.env.GH_PROBE_FAIL === '1') {
      process.stderr.write('HTTP 401: Bad credentials\\n');
      process.exit(1);
    }
    process.stdout.write(process.env.GH_PROBE_JSON || '{}');
    process.exit(0);
  }
  if (process.env.GH_GRAPHQL_FAIL === '1' ||
      (process.env.GH_MUTATION_FAIL === '1' && args.some((a) => a.includes('mutation')))) {
    process.stderr.write(process.env.GH_FAIL_STDERR || 'HTTP 401: Bad credentials\\n');
    process.exit(1);
  }
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

// A fake `curl` answering the repository_dispatch round trip that board.mjs's
// runRemotely makes: it records the dispatched args in `stateFile` and returns
// `out` as the workflow's output with exit code 0.
function fakeCurlSource(stateFile, out) {
  return `#!${process.execPath}
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
    { title: 'board-out 0', message: ${JSON.stringify(out)} },
    { title: 'board-exit', message: '0' },
  ], 200);
} else {
  respond({ message: 'unexpected request: ' + url }, 500);
}
`;
}

function run(args, env = {}, opts = {}) {
  const binDir = makeFakeBin(FAKE_GH);
  const logFile = join(binDir, 'gh.log');
  const stateFile = join(binDir, 'state.json');
  if (opts.curl !== undefined) {
    writeFileSync(join(binDir, 'curl'), fakeCurlSource(stateFile, opts.curl));
    chmodSync(join(binDir, 'curl'), 0o755);
  }
  // The args dispatched to board.yml (null when none were).
  const dispatched = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).args ?? null : null);
  try {
    const stdout = execFileSync(process.execPath, [boardScript, ...args], {
      encoding: 'utf8',
      env: {
        ...cleanEnv(),
        PATH: `${binDir}:${process.env.PATH}`,
        GH_LOG: logFile,
        ...env,
      },
    });
    assertNoStrayDispatch(binDir);
    return { stdout, log: readLog(logFile), dispatched: dispatched(), ghRan: existsSync(logFile) };
  } catch (err) {
    assertNoStrayDispatch(binDir);
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      status: err.status,
      log: readLog(logFile),
      dispatched: dispatched(),
      ghRan: existsSync(logFile),
    };
  }
}

function readLog(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    // hasGh()'s own `gh --version` probe isn't part of what any command does.
    .filter((call) => call[0] !== '--version');
}

const PROBE_OK = JSON.stringify({ data: { node: { number: 4 } } });

// What the real `gh project item-add --format json` prints: no `status` (#416).
const ITEM_ADDED = JSON.stringify({
  id: 'PVTI_new', title: 'Test issue', body: '', type: 'Issue', url: 'https://github.com/luketmoss/thrive/issues/216',
});

// `add` looks the issue up first (#416); these are what that lookup answers.
const NOT_ON_BOARD = () => graphqlResponse({ number: 216, nodes: [] });
const ON_BOARD = (status, id = 'PVTI_existing') => graphqlResponse({
  number: 216,
  nodes: [{ id, project: { number: 4 }, fieldValueByName: status ? { name: status } : null }],
});
const is = (call, what) => call.some((a) => String(a).includes(what));

test('add: a new issue is looked up, then added (#416 AC2)', () => {
  const { stdout, log } = run(['add', '216'], {
    GH_GRAPHQL_JSON: NOT_ON_BOARD(), GH_ITEM_ADD_JSON: ITEM_ADDED,
  });
  assert.equal(stdout.trim(), '#216: added to the board');
  assert.equal(log.length, 2);
  assert.equal(log[0][1], 'graphql'); // the lookup
  assert.deepEqual(log[1], [
    'project', 'item-add', '4', '--owner', 'luketmoss',
    '--url', 'https://github.com/luketmoss/thrive/issues/216', '--format', 'json',
  ]);
});

test('add: an issue already on the board is reported, with no item-add and no write (#416 AC1)', () => {
  const { stdout, log } = run(['add', '216'], { GH_GRAPHQL_JSON: ON_BOARD('Refined'), GH_ITEM_ADD_JSON: ITEM_ADDED });
  assert.equal(stdout.trim(), '#216: already on the board');
  assert.equal(log.length, 1); // the lookup only
  assert.equal(log[0][1], 'graphql');
  assert.ok(!log.some((call) => is(call, 'item-add') || is(call, 'mutation')));
});

test('add --status leaves an issue already in a column where it is, even from Done (#416 AC1)', () => {
  const { stdout, log } = run(['add', '216', '--status', 'To Do'], {
    GH_GRAPHQL_JSON: ON_BOARD('Done'), GH_ITEM_ADD_JSON: ITEM_ADDED,
  });
  assert.equal(stdout.trim(), '#216: already on the board (Done), left there — use set to move it');
  // The lookup only: no item-add, no status mutation, so a late add cannot undo a move.
  assert.equal(log.length, 1);
  assert.ok(!log.some((call) => is(call, 'item-add') || is(call, 'mutation')));
});

test('add --status naming the column the card is already in just reports it (#416 AC1)', () => {
  const { stdout, log } = run(['add', '216', '--status', 'Done'], { GH_GRAPHQL_JSON: ON_BOARD('Done') });
  assert.equal(stdout.trim(), '#216: already on the board');
  assert.equal(log.length, 1);
});

test('add --status sets the column on the item-add id, with no item-list call (#416 AC2)', () => {
  const { stdout, log } = run(['add', '216', '--status', 'To Do'], {
    GH_GRAPHQL_JSON: NOT_ON_BOARD(), GH_ITEM_ADD_JSON: ITEM_ADDED,
  });
  assert.equal(stdout.trim(), '#216: added (To Do)');
  assert.equal(log.length, 3); // lookup, item-add, the one mutation
  assert.equal(log[0][1], 'graphql');
  assert.deepEqual(log[1].slice(0, 2), ['project', 'item-add']);
  assert.equal(log[2][0], 'api');
  assert.equal(log[2][1], 'graphql');
  assert.equal(log[2][2], '-f');
  assert.match(log[2][3], /itemId: "PVTI_new"/);
  assert.match(log[2][3], /singleSelectOptionId: "2ed3c08e"/); // "To Do" from board.json
  assert.ok(!log.some((call) => call[1] === 'item-list'));
});

test('add --status on a card with no column sets it from the lookup, with no item-add (#416 AC3)', () => {
  const { stdout, log } = run(['add', '216', '--status', 'To Do'], {
    GH_GRAPHQL_JSON: ON_BOARD(null, 'PVTI_nocolumn'), GH_ITEM_ADD_JSON: ITEM_ADDED,
  });
  assert.equal(stdout.trim(), '#216: already on the board, set to To Do');
  assert.equal(log.length, 2); // lookup, the mutation
  assert.match(log[1][3], /itemId: "PVTI_nocolumn"/);
  assert.match(log[1][3], /singleSelectOptionId: "2ed3c08e"/);
  assert.ok(!log.some((call) => is(call, 'item-add')));
});

test('add with no --status on a card with no column writes nothing (#416 AC3)', () => {
  const { stdout, log } = run(['add', '216'], { GH_GRAPHQL_JSON: ON_BOARD(null) });
  assert.equal(stdout.trim(), '#216: already on the board');
  assert.equal(log.length, 1);
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

test('add: the status mutation failing after item-add says what gh said, with no probe and no dispatch (#416 AC4)', () => {
  const { stderr, status, log, dispatched } = run(['add', '216', '--status', 'To Do'], {
    GH_GRAPHQL_JSON: NOT_ON_BOARD(), GH_ITEM_ADD_JSON: ITEM_ADDED,
    GH_MUTATION_FAIL: '1', GH_FAIL_STDERR: 'HTTP 502: Bad Gateway\n', GH_TOKEN: 'fake-token',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #216: HTTP 502: Bad Gateway');
  assert.equal(log.length, 3); // lookup, item-add, the failed mutation
  assert.equal(dispatched, null);
});

test('add: the status mutation failing on a card with no column says what gh said (#416 AC4)', () => {
  const { stderr, status, log, dispatched } = run(['add', '216', '--status', 'To Do'], {
    GH_GRAPHQL_JSON: ON_BOARD(null, 'PVTI_nocolumn'),
    GH_MUTATION_FAIL: '1', GH_FAIL_STDERR: 'HTTP 502: Bad Gateway\n', GH_TOKEN: 'fake-token',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #216: HTTP 502: Bad Gateway');
  assert.equal(log.length, 2); // lookup, the failed mutation
  assert.equal(dispatched, null);
});

test('add reports an issue that does not exist as not found (#416 AC4)', () => {
  const { stderr, status, log, dispatched } = run(['add', '999999'], { GH_GRAPHQL_JSON: notFoundResponse() });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #999999 not found in luketmoss/thrive.');
  assert.equal(log.length, 1); // the lookup; nothing was added
  assert.equal(dispatched, null);
});

test('add rewrites the gh error for an issue that does not exist (AC3)', () => {
  // The project probe succeeds (#405), so the failure is the issue's own.
  const { stderr, status, dispatched } = run(['add', '999999'], {
    GH_GRAPHQL_FAIL: '1', GH_FAIL_STDERR: 'gh: Could not resolve to an Issue with the number of 999999.\n', GH_PROBE_JSON: PROBE_OK,
  });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #999999 not found in luketmoss/thrive.');
  assert.equal(dispatched, null);
});

// AC4: without `gh`, `add` dispatches to board.yml exactly like `set`/`show` do.
test('add is allowed through the remote-dispatch path (AC4)', () => {
  const binDir = mkdtempSync(join(tmpdir(), 'board-test-curl-'));
  const stateFile = join(binDir, 'state.json');
  const curlPath = join(binDir, 'curl');
  writeFileSync(curlPath, fakeCurlSource(stateFile, '#216: added (To Do)'));
  chmodSync(curlPath, 0o755);

  const stdout = execFileSync(process.execPath, [boardScript, 'add', '216', '--status', 'To Do'], {
    encoding: 'utf8',
    env: {
      ...cleanEnv(),
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
  writeFileSync(join(binDir, 'curl'), refusingCurlSource(join(binDir, 'curl.refused')));
  chmodSync(join(binDir, 'curl'), 0o755);
  const logFile = join(binDir, 'gh.log');
  const stdout = execFileSync(process.execPath, [boardScript, 'list', '--status', 'Refined'], {
    encoding: 'utf8',
    env: { ...cleanEnv(), PATH: `${binDir}:${process.env.PATH}`, GH_LOG: logFile },
  });
  assertNoStrayDispatch(binDir);
  assert.match(stdout, /#224\s+\[Refined\]\s+Test issue/);
  const log = readLog(logFile);
  assert.equal(log.length, 1);
  assert.equal(log[0][1], 'item-list');
});

// #405: the dispatch route is chosen by whether `gh` can reach the project, not
// by whether it is installed. A working `gh` pays for nothing extra; the probe
// runs only after a command's first `gh` call has failed.

test('a gh that cannot reach the project sends add to board.yml (#405 AC1)', () => {
  const { stdout, log, dispatched } = run(['add', '216', '--status', 'To Do'], {
    GH_GRAPHQL_FAIL: '1', GH_FAIL_STDERR: 'HTTP 401: Bad credentials\n', GH_PROBE_FAIL: '1', GH_TOKEN: 'fake-token',
  }, { curl: '#216: added (To Do)' });
  assert.equal(stdout.trim(), '#216: added (To Do)');
  assert.deepEqual(dispatched, ['add', '216', '--status', 'To Do']);
  // The one failed call (the lookup, #416) and the probe: nothing was written before the dispatch.
  assert.equal(log.length, 2);
  assert.equal(log[0][1], 'graphql');
  assert.ok(!log.some((call) => is(call, 'item-add') || is(call, 'mutation')));
  assert.ok(log[1].some((a) => String(a).includes('node(id: $id)')), 'the second call is the project probe');
});

test('show with a gh that cannot reach the project is sent to board.yml too (#405 AC1)', () => {
  const { stdout, log, dispatched } = run(['show', '224'], {
    GH_GRAPHQL_FAIL: '1', GH_PROBE_FAIL: '1', GH_TOKEN: 'fake-token',
  }, { curl: '#224  Test issue' });
  assert.equal(stdout.trim(), '#224  Test issue');
  assert.deepEqual(dispatched, ['show', '224']);
  assert.equal(log.length, 2);
});

test('set with a gh that cannot reach the project is sent to board.yml, with no mutation tried (#405 AC1)', () => {
  const { stdout, log, dispatched } = run(['set', '224', '--status', 'Testing'], {
    GH_GRAPHQL_FAIL: '1', GH_PROBE_FAIL: '1', GH_TOKEN: 'fake-token',
  }, { curl: '#224: In Development -> Testing' });
  assert.equal(stdout.trim(), '#224: In Development -> Testing');
  assert.deepEqual(dispatched, ['set', '224', '--status', 'Testing']);
  assert.equal(log.length, 2); // the failed lookup and the probe
  assert.ok(!log.some((call) => call.some((a) => String(a).includes('mutation'))));
});

test('list with a gh that cannot reach the project is sent to board.yml too (#405 AC1)', () => {
  const { stdout, dispatched } = run(['list', '--status', 'Refined'], {
    GH_PROBE_FAIL: '1', GH_TOKEN: 'fake-token',
  }, { curl: '#224  [Refined]  Test issue' });
  assert.equal(stdout.trim(), '#224  [Refined]  Test issue');
  assert.deepEqual(dispatched, ['list', '--status', 'Refined']);
});

test('a working gh makes no probe call and no extra read (#405 AC2)', () => {
  const { log, dispatched } = run(['show', '224'], {
    GH_GRAPHQL_JSON: graphqlResponse({
      nodes: [{ id: 'PVTI_224', project: { number: 4 }, fieldValueByName: { name: 'Testing' } }],
    }),
  });
  assert.equal(log.length, 1);
  assert.ok(!log.some((call) => call.some((a) => String(a).includes('node(id: $id)'))));
  assert.equal(dispatched, null);
});

test('a real add failure on a gh that reaches the project says what gh said, and is not dispatched (#405 AC3)', () => {
  const { stderr, status, log, dispatched } = run(['add', '216'], {
    GH_GRAPHQL_FAIL: '1', GH_FAIL_STDERR: 'HTTP 502: Bad Gateway\n', GH_PROBE_JSON: PROBE_OK, GH_TOKEN: 'fake-token',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #216: HTTP 502: Bad Gateway');
  assert.equal(dispatched, null);
  assert.equal(log.length, 2); // the lookup, then the probe
});

test('add: item-add failing after the lookup says what gh said, with no probe and no dispatch (#416 AC4)', () => {
  const { stderr, status, log, dispatched } = run(['add', '216', '--status', 'To Do'], {
    GH_GRAPHQL_JSON: NOT_ON_BOARD(), GH_ITEM_ADD_FAIL: '1', GH_FAIL_STDERR: 'HTTP 502: Bad Gateway\n', GH_TOKEN: 'fake-token',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #216: HTTP 502: Bad Gateway');
  assert.equal(log.length, 2); // the lookup, item-add: only a first-call failure is ever probed
  assert.equal(dispatched, null);
});

test('add reports "not found" for the "resource not found, please check the URL" wording as well (#405 AC3)', () => {
  const { stderr, status, dispatched } = run(['add', '99999999'], {
    GH_GRAPHQL_FAIL: '1', GH_FAIL_STDERR: 'resource not found, please check the URL\n', GH_PROBE_JSON: PROBE_OK, GH_TOKEN: 'fake-token',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'Issue #99999999 not found in luketmoss/thrive.');
  assert.equal(dispatched, null);
});

test('show and set keep "not found" for the wording the real gh uses for a missing issue (#405 AC3)', () => {
  for (const args of [['show', '99999999'], ['set', '99999999', '--status', 'Testing']]) {
    const { stderr, status, dispatched } = run(args, {
      GH_GRAPHQL_FAIL: '1', GH_FAIL_STDERR: 'gh: Could not resolve to an Issue with the number of 99999999.\n',
      GH_PROBE_JSON: PROBE_OK, GH_TOKEN: 'fake-token',
    }, { curl: 'must not run' });
    assert.equal(status, 1);
    assert.equal(stderr.trim(), 'Issue #99999999 not found in luketmoss/thrive.');
    assert.equal(dispatched, null);
  }
});

test('show: a failed lookup on a gh that reaches the project says what gh said (#405 AC3)', () => {
  const { stderr, status, dispatched } = run(['show', '224'], {
    GH_GRAPHQL_FAIL: '1', GH_FAIL_STDERR: 'HTTP 502: Bad Gateway\n', GH_PROBE_JSON: PROBE_OK, GH_TOKEN: 'fake-token',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'gh failed: HTTP 502: Bad Gateway');
  assert.equal(dispatched, null);
});

test('BOARD_REMOTE=1 sends the command to board.yml with no gh call at all (#405 AC4)', () => {
  const { stdout, dispatched, ghRan } = run(['show', '224'], {
    BOARD_REMOTE: '1', GH_TOKEN: 'fake-token',
  }, { curl: '#224  Test issue' });
  assert.equal(stdout.trim(), '#224  Test issue');
  assert.deepEqual(dispatched, ['show', '224']);
  assert.equal(ghRan, false);
});

test('inside board.yml (BOARD_ARGS set) a failure is reported, never dispatched again (#405 AC4)', () => {
  const { stderr, status, log, dispatched } = run([], {
    BOARD_ARGS: JSON.stringify(['show', '224']), BOARD_REMOTE: '1',
    GH_GRAPHQL_FAIL: '1', GH_PROBE_FAIL: '1', GH_TOKEN: 'fake-token',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'gh failed: HTTP 401: Bad credentials');
  assert.equal(dispatched, null);
  assert.equal(log.length, 1); // the lookup only: no probe either
});

test('sync still needs gh locally, even forced remote (#405 AC4)', () => {
  const { stderr, status, ghRan, dispatched } = run(['sync'], { BOARD_REMOTE: '1', GH_TOKEN: 'fake-token' }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.equal(stderr.trim(), 'sync rewrites board.json locally; run it where gh can reach the project.');
  assert.equal(ghRan, false);
  assert.equal(dispatched, null);
});

test('a gh failure that ends at the missing token still shows what gh said (#405 AC5)', () => {
  const { stderr, status, dispatched } = run(['show', '224'], {
    GH_GRAPHQL_FAIL: '1', GH_FAIL_STDERR: 'API rate limit already exceeded\n', GH_PROBE_FAIL: '1',
    GH_TOKEN: '', GITHUB_TOKEN: '',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.match(stderr, /gh said: API rate limit already exceeded/);
  assert.match(stderr, /GH_TOKEN or GITHUB_TOKEN/);
  assert.equal(dispatched, null);
});

test('the dispatch route without a token says what is missing, before any request (#405 AC5)', () => {
  const { stderr, status, dispatched } = run(['show', '224'], {
    BOARD_REMOTE: '1', GH_TOKEN: '', GITHUB_TOKEN: '',
  }, { curl: 'must not run' });
  assert.equal(status, 1);
  assert.match(stderr, /GH_TOKEN or GITHUB_TOKEN/);
  assert.doesNotMatch(stderr, /bearer|401/);
  assert.equal(dispatched, null);
});
