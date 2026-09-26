#!/usr/bin/env node
// Thrive board helper. All project board writes go through this script.
//
//   node .thrive/board.mjs show <issue>
//   node .thrive/board.mjs set <issue> --status "In Development"
//   node .thrive/board.mjs list --status Refined
//   node .thrive/board.mjs sync          # refresh status option IDs from the API
//
// Status option IDs are cached in board.json so routine moves cost one API call
// instead of three. `sync` rewrites that cache after a column is added or renamed.
//
// Without `gh` (a cloud Claude Code session), the same command runs remotely in
// .github/workflows/board.yml and its output is printed here. Those sessions can
// reach only repo-scoped REST endpoints, so the board itself is out of reach.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, 'board.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
}

function die(message) {
  console.error(message);
  process.exit(1);
}

function items() {
  const raw = gh([
    'project', 'item-list', String(config.projectNumber),
    '--owner', config.owner, '--limit', '200', '--format', 'json',
  ]);
  return JSON.parse(raw).items;
}

function findItem(issue) {
  const item = items().find((i) => i.content?.number === Number(issue));
  if (!item) die(`Issue #${issue} is not on project #${config.projectNumber}.`);
  return item;
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
}

function optionId(status) {
  const id = config.statuses[status];
  if (id) return id;
  die(
    `Unknown status "${status}".\n` +
    `Known: ${Object.keys(config.statuses).join(', ')}\n` +
    `If the column was just added or renamed, run: node .thrive/board.mjs sync`
  );
}

function hasGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// curl rather than fetch: it honours the session's HTTPS proxy.
function rest(method, path, body) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const args = [
    '-sS', '-X', method, '-w', '\n%{http_code}',
    '-H', `Authorization: bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    `https://api.github.com/repos/${config.repo}/${path}`,
  ];
  if (body) args.push('-H', 'Content-Type: application/json', '--data', JSON.stringify(body));
  const raw = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const cut = raw.lastIndexOf('\n');
  const status = Number(raw.slice(cut + 1));
  const text = raw.slice(0, cut);
  if (status >= 300) die(`GitHub ${method} ${path} -> ${status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

function runRemotely(args) {
  if (args[0] === 'sync') die('sync rewrites board.json locally; run it where gh is installed.');
  if (!['show', 'set', 'list'].includes(args[0])) die('Usage: board.mjs <show|set|list|sync> ...');
  const workflow = 'actions/workflows/board.yml';
  const requestId = Math.random().toString(36).slice(2, 10);
  rest('POST', 'dispatches', { event_type: 'board', client_payload: { args, request_id: requestId } });

  const deadline = Date.now() + 5 * 60 * 1000;
  let run;
  while (Date.now() < deadline) {
    sleep(4000);
    if (!run) {
      const { workflow_runs: runs } = rest('GET', `${workflow}/runs?event=repository_dispatch&per_page=20`);
      run = runs.find((r) => r.display_title.endsWith(`[${requestId}]`));
      if (!run) continue;
    }
    run = rest('GET', `actions/runs/${run.id}`);
    if (run.status !== 'completed') continue;

    const { jobs } = rest('GET', `actions/runs/${run.id}/jobs`);
    const notes = jobs.length ? rest('GET', `check-runs/${jobs[0].id}/annotations?per_page=100`) : [];
    const parts = notes
      .filter((a) => /^board \d+$/.test(a.title))
      .sort((a, b) => Number(a.title.slice(6)) - Number(b.title.slice(6)));
    const output = parts.length ? parts.map((a) => a.message).join('\n') : `(no output; see ${run.html_url})`;
    if (run.conclusion !== 'success') die(output);
    console.log(output);
    return;
  }
  die(`Timed out waiting for the board workflow${run ? `: ${run.html_url}` : ''}.`);
}

// board.yml passes its arguments as a JSON array, so none pass through a shell.
const args = process.env.BOARD_ARGS ? JSON.parse(process.env.BOARD_ARGS) : process.argv.slice(2);
if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) die('BOARD_ARGS must be a JSON array of strings.');

if (!hasGh()) {
  runRemotely(args);
  process.exit(0);
}

const [command, ...argv] = args;

switch (command) {
  case 'show': {
    const item = findItem(argv[0]);
    console.log(`#${item.content.number}  ${item.content.title}`);
    console.log(`Status: ${item.status ?? '(none)'}`);
    console.log(item.content.url);
    break;
  }

  case 'set': {
    const issue = argv[0];
    const status = flag(argv, 'status');
    if (!issue || !status) die('Usage: board.mjs set <issue> --status "<column>"');
    const item = findItem(issue);
    if (item.status === status) {
      console.log(`#${issue} already in ${status}.`);
      break;
    }
    gh([
      'api', 'graphql', '-f', `query=mutation {
        updateProjectV2ItemFieldValue(input: {
          projectId: "${config.projectId}"
          itemId: "${item.id}"
          fieldId: "${config.statusFieldId}"
          value: { singleSelectOptionId: "${optionId(status)}" }
        }) { projectV2Item { id } }
      }`,
    ]);
    console.log(`#${issue}: ${item.status ?? '(none)'} -> ${status}`);
    break;
  }

  case 'list': {
    const status = flag(argv, 'status');
    const rows = items().filter((i) => !status || i.status === status);
    if (rows.length === 0) {
      console.log(status ? `Nothing in ${status}.` : 'Board is empty.');
      break;
    }
    for (const i of rows) {
      console.log(`#${i.content.number}  [${i.status ?? '-'}]  ${i.content.title}`);
    }
    break;
  }

  case 'sync': {
    const raw = gh([
      'project', 'field-list', String(config.projectNumber),
      '--owner', config.owner, '--format', 'json',
    ]);
    const field = JSON.parse(raw).fields.find((f) => f.id === config.statusFieldId);
    if (!field) die('Status field not found on the project.');
    config.statuses = Object.fromEntries(field.options.map((o) => [o.name, o.id]));
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Synced ${field.options.length} statuses: ${Object.keys(config.statuses).join(', ')}`);
    break;
  }

  default:
    die('Usage: board.mjs <show|set|list|sync> ...');
}
