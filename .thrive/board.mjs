#!/usr/bin/env node
// Thrive board helper. All project board writes go through this script.
//
//   node .thrive/board.mjs show <issue>
//   node .thrive/board.mjs add <issue> [--status "<column>"]   (status only for a new item)
//   node .thrive/board.mjs set <issue> --status "In Development"
//   node .thrive/board.mjs list --status Refined
//   node .thrive/board.mjs sync          # refresh status option IDs from the API
//
// Status option IDs are cached in board.json so routine moves cost one API call
// instead of three. `sync` rewrites that cache after a column is added or renamed.
//
// Without a `gh` that can reach the project (a cloud Claude Code session: no
// `gh`, or one whose token is invalid or repo-scoped), the same command runs
// remotely in .github/workflows/board.yml and its output is printed here. Those
// sessions can reach only repo-scoped REST endpoints, so the board itself is out
// of reach. The route is chosen when a command's first `gh` call fails (a
// working `gh` pays for nothing extra), or forced with BOARD_REMOTE=1 (#405).
// board.yml's own run (BOARD_ARGS set) never takes it: that would loop.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, 'board.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

function ghRaw(args) {
  // Explicit stdio so a failing call's stderr is only ever captured (into the
  // thrown error), never also echoed straight to our own stderr — `add`
  // relies on catching and rewriting that error cleanly (AC3).
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

// board.yml runs this script with BOARD_ARGS set, and with a gh that works. It
// must never dispatch itself again (#405).
const insideWorkflow = Boolean(process.env.BOARD_ARGS);

// One cheap read that says whether this `gh` can reach the project at all: an
// invalid token and a repo-scoped one both fail it, whatever the error text.
const PROJECT_PROBE_QUERY = `query($id: ID!) {
  node(id: $id) { ... on ProjectV2 { number } }
}`;

function projectReachable() {
  try {
    const raw = ghRaw(['api', 'graphql', '-f', `query=${PROJECT_PROBE_QUERY}`, '-f', `id=${config.projectId}`]);
    return JSON.parse(raw).data?.node?.number === config.projectNumber;
  } catch {
    return false;
  }
}

// What `gh` says when the issue is not there: "Could not resolve to an issue"
// from a query, "resource not found" for a URL that is not one.
const ISSUE_NOT_FOUND = /could not resolve to an? issue|resource not found/i;

// What `gh` said when a call failed: its stderr, else the error's own message.
function ghSaid(err) {
  const said = String(err?.stderr ?? '').trim();
  return said || String(err?.message ?? err).trim();
}

let ghCalls = 0;

// A failed call ends the run. `explain` words it when the command knows better
// than "gh failed: <what gh said>" (`add` for an issue that does not exist).
function gh(ghArgs, explain = (said) => `gh failed: ${said}`) {
  ghCalls += 1;
  try {
    return ghRaw(ghArgs);
  } catch (err) {
    // The first `gh` call of a command failed, so nothing has been applied yet.
    // If this `gh` cannot reach the project, send the command to board.yml
    // instead (#405); otherwise the failure is real and is reported as it is.
    if (ghCalls === 1 && !insideWorkflow && !projectReachable()) runRemotely(args, ghSaid(err)); // the command's args, not ghArgs
    return die(explain(ghSaid(err)));
  }
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

const repoName = config.repo.slice(config.owner.length + 1);

// One small lookup on the issue itself, instead of listing (and paging
// through) every item on the project. An issue sits on only a handful of
// projects, so `first: 20` comfortably covers it.
const FIND_ITEM_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number
      title
      url
      projectItems(first: 20) {
        nodes {
          id
          project { number }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}`;

function findItem(issue) {
  const raw = gh([
    'api', 'graphql',
    '-f', `query=${FIND_ITEM_QUERY}`,
    '-f', `owner=${config.owner}`,
    '-f', `repo=${repoName}`,
    '-F', `number=${issue}`,
  ], (said) => (ISSUE_NOT_FOUND.test(said)
    ? `Issue #${issue} not found in ${config.repo}.`
    : `gh failed: ${said}`));
  const issueData = JSON.parse(raw).data?.repository?.issue;
  if (!issueData) die(`Issue #${issue} not found in ${config.repo}.`);
  const node = issueData.projectItems.nodes.find((n) => n.project.number === config.projectNumber);
  if (!node) {
    die(
      `Issue #${issue} is not on project #${config.projectNumber}. ` +
      `Add it with: node .thrive/board.mjs add ${issue}`
    );
  }
  return {
    id: node.id,
    status: node.fieldValueByName?.name ?? null,
    content: { number: issueData.number, title: issueData.title, url: issueData.url },
  };
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

function setItemStatus(itemId, status) {
  gh([
    'api', 'graphql', '-f', `query=mutation {
      updateProjectV2ItemFieldValue(input: {
        projectId: "${config.projectId}"
        itemId: "${itemId}"
        fieldId: "${config.statusFieldId}"
        value: { singleSelectOptionId: "${optionId(status)}" }
      }) { projectV2Item { id } }
    }`,
  ]);
}

function runRemotely(args, ghSaidText = '') {
  if (args[0] === 'sync') die('sync rewrites board.json locally; run it where gh can reach the project.');
  if (!['show', 'add', 'set', 'list'].includes(args[0])) die('Usage: board.mjs <show|add|set|list|sync> ...');
  if (!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) {
    die(
      (ghSaidText ? `gh said: ${ghSaidText}\n` : '') +
      'No GH_TOKEN or GITHUB_TOKEN to dispatch the board workflow with. The dispatch route is used ' +
      'when gh is missing or cannot reach the project; set a token that can send repository_dispatch ' +
      `to ${config.repo}, or run this where gh can reach the project.`
    );
  }
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

    // board.yml returns stdout, stderr and the exit code as annotations.
    const { jobs } = rest('GET', `actions/runs/${run.id}/jobs`);
    const notes = jobs.length ? rest('GET', `check-runs/${jobs[0].id}/annotations?per_page=100`) : [];
    const stream = (name) => notes
      .filter((a) => a.title.startsWith(`${name} `))
      .sort((a, b) => Number(a.title.slice(name.length + 1)) - Number(b.title.slice(name.length + 1)))
      .map((a) => a.message)
      .join('\n');
    const exit = notes.find((a) => a.title === 'board-exit');
    if (!exit) die(`The board workflow returned no result: ${run.html_url}`);
    const out = stream('board-out');
    const err = [stream('board-err'), notes.find((a) => a.title === 'board-truncated')?.message]
      .filter(Boolean).join('\n');
    if (out) console.log(out);
    if (err) console.error(err);
    process.exit(Number(exit.message));
  }
  die(`Timed out waiting for the board workflow${run ? `: ${run.html_url}` : ''}.`);
}

// board.yml passes its arguments as a JSON array, so none pass through a shell.
const args = process.env.BOARD_ARGS ? JSON.parse(process.env.BOARD_ARGS) : process.argv.slice(2);
if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) die('BOARD_ARGS must be a JSON array of strings.');

// BOARD_REMOTE=1 forces the dispatch route with no `gh` call at all; no `gh`
// takes it too. Neither applies inside board.yml's own run (#405).
if (!insideWorkflow && (process.env.BOARD_REMOTE === '1' || !hasGh())) runRemotely(args);

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
    setItemStatus(item.id, status);
    console.log(`#${issue}: ${item.status ?? '(none)'} -> ${status}`);
    break;
  }

  case 'add': {
    const issue = argv[0];
    if (!issue || !/^\d+$/.test(issue)) die('Usage: board.mjs add <issue> [--status "<column>"]');
    const status = flag(argv, 'status');
    if (status) optionId(status); // refuse an unknown column before adding anything

    // Only a `gh` that could resolve nothing means the issue is not there; any
    // other failure is shown as `gh` said it (#405).
    const raw = gh([
      'project', 'item-add', String(config.projectNumber),
      '--owner', config.owner,
      '--url', `https://github.com/${config.repo}/issues/${issue}`,
      '--format', 'json',
    ], (said) => (ISSUE_NOT_FOUND.test(said)
      ? `Issue #${issue} not found in ${config.repo}.`
      : `Issue #${issue}: ${said}`));
    const item = JSON.parse(raw);

    // item-add is idempotent: a re-run returns the same item. An item that was
    // already on the board carries whatever status it already had; a brand
    // new one has none yet. No item-list call either way.
    const existed = item.status != null;

    // --status only places a *new* item. An issue already on the board keeps
    // its column: a late `add --status "To Do"` must never undo a move a
    // refinement agent made in the meantime. Moving a card is `set`'s job.
    if (existed) {
      console.log(status && status !== item.status
        ? `#${issue}: already on the board (${item.status}), left there — use set to move it`
        : `#${issue}: already on the board`);
      break;
    }

    if (status) setItemStatus(item.id, status);
    console.log(status ? `#${issue}: added (${status})` : `#${issue}: added to the board`);
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
    die('Usage: board.mjs <show|add|set|list|sync> ...');
}
