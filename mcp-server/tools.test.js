// #158 — the tools themselves, end to end over MCP stdio, against a fake API
// on localhost. No network: the server is spawned with THRIVE_API_URL pointed
// at a local HTTP stub that answers the actions the tools call.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const W_FIELDS = [
  'id', 'date', 'time', 'type', 'name', 'template_id', 'notes', 'elapsed_seconds', 'created',
  'copied_from', 'status', 'moving_seconds', 'effort', 'distance_m', 'ascent_m', 'descent_m',
  'avg_hr', 'sub_type', 'source', 'source_activity_id', 'raw_ref', 'fit_ref', 'fit_fetched_at',
  'synced_at', 'started_at_utc', 'calories',
];
const workout = (o) => ({ ...Object.fromEntries(W_FIELDS.map((f) => [f, o[f] ?? ''])), sheetRow: 2 });

const WORKOUTS = [
  workout({
    id: 'w_sync', date: '2026-09-24', time: '07:30', type: 'bike', sub_type: 'gravel', name: 'Gravel Bike',
    elapsed_seconds: '5400', moving_seconds: '5100', distance_m: '19956', ascent_m: '457', avg_hr: '141',
    calories: '640', source: 'coros', source_activity_id: '4711', raw_ref: 'raw-1',
    synced_at: '2026-09-24T17:41:10.000Z', started_at_utc: '2026-09-24T07:30:00-06:00',
  }),
  workout({
    id: 'w_enr', date: '2026-09-23', time: '06:00', type: 'weight', name: 'Upper Push',
    avg_hr: '88', source_activity_id: '4712', raw_ref: 'raw-2', synced_at: '2026-09-23T13:00:00.000Z',
  }),
  workout({ id: 'w_man', date: '2026-09-22', time: '08:00', type: 'hike', name: 'Morning Hike' }),
];

const calls = [];
let server;
let client;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = Object.fromEntries(url.searchParams);
    calls.push(p);
    let data;
    switch (p.action) {
      case 'getWorkouts': data = WORKOUTS; break;
      case 'getSets': data = []; break;
      case 'getWorkout': data = WORKOUTS.find((w) => w.id === p.id); break;
      case 'getDailyHealth':
        data = [{ date: p.from, resting_hr: '57', hrv: '', steps: '8400', calories: '', sleep_total_s: '',
          sleep_deep_s: '', sleep_rem_s: '', sleep_light_s: '', sleep_awake_s: '', sleep_score: '',
          vo2max: '', recovery: '', training_load: '', bed_time: '', wake_time: '', raw_ref: '', synced_at: '' }];
        break;
      case 'getDailySummary': data = []; break;
      default:
        res.end(JSON.stringify({ success: false, error: `unstubbed ${p.action}` }));
        return;
    }
    res.end(JSON.stringify({ success: true, data }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  client = new Client({ name: 'tools-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, 'index.js')],
    env: { ...process.env, THRIVE_API_URL: `http://127.0.0.1:${port}/exec`, THRIVE_API_KEY: 'k' },
    stderr: 'ignore',
  }));
});

after(async () => {
  await client?.close();
  server?.close();
});

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { text: res.content.map((c) => c.text).join('\n'), isError: Boolean(res.isError) };
};

test('both new tools are registered, and their descriptions carry the caveats', async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const health = byName.thrive_daily_health;
  const summary = byName.thrive_daily_summary;
  assert.ok(health && summary);
  assert.deepEqual(Object.keys(health.inputSchema.properties).sort(), ['date_from', 'date_to']);
  assert.match(health.description, /unknown, never zero/);
  assert.match(health.description, /wake/);
  assert.match(health.description, /INCLUDES awake time/);
  assert.match(health.description, /snapshots/);
  assert.match(health.description, /never add them to activity distance/);
  assert.match(summary.description, /OUTDOOR ONLY/);
  assert.match(summary.description, /the workouts are right/);
  assert.ok(byName.thrive_list_workouts.inputSchema.properties.source);
});

test('thrive_daily_health sends the resolved range and shows blanks as —', async () => {
  const { text, isError } = await call('thrive_daily_health', { date_from: '2026-09-20', date_to: '2026-09-21' });
  assert.equal(isError, false);
  const sent = calls.findLast((c) => c.action === 'getDailyHealth');
  assert.equal(sent.from, '2026-09-20');
  assert.equal(sent.to, '2026-09-21');
  assert.match(text, /- 2026-09-20: resting HR 57 bpm · HRV — · steps 8,400/);
  assert.match(text, /No DailyHealth row for 1 day: 2026-09-21/);
});

test('a reversed range is refused before any request', async () => {
  const before = calls.length;
  const { text, isError } = await call('thrive_daily_summary', { date_from: '2026-09-21', date_to: '2026-09-20' });
  assert.equal(isError, true);
  assert.match(text, /date_from 2026-09-21 is after date_to 2026-09-20/);
  assert.equal(calls.length, before);
});

test('thrive_daily_summary on an empty range says so and states the caveat', async () => {
  const { text } = await call('thrive_daily_summary', { date_from: '2026-09-20', date_to: '2026-09-20' });
  assert.match(text, /0 days with a row/);
  assert.match(text, /OUTDOOR ONLY/);
});

test('thrive_list_workouts shows venue and provenance, and filters on source', async () => {
  const all = (await call('thrive_list_workouts')).text;
  assert.match(all, /\*\*Gravel Bike\*\* \[bike:gravel\] \(COROS\)/);
  assert.match(all, /\*\*Upper Push\*\* \[weight\] \(enriched from COROS\)/);
  assert.match(all, /\*\*Morning Hike\*\* \[hike\] \(id: w_man\)/);

  const only = async (source) => (await call('thrive_list_workouts', { source })).text;
  assert.match(await only('synced'), /^1 workouts:\n.*Gravel Bike/);
  assert.match(await only('enriched'), /^1 workouts:\n.*Upper Push/);
  assert.match(await only('manual'), /^1 workouts:\n.*Morning Hike/);
});

test('thrive_get_workout adds the synced fields and omits blanks', async () => {
  const synced = (await call('thrive_get_workout', { workout_id: 'w_sync' })).text;
  assert.match(synced, /\[bike:gravel\]/);
  assert.match(synced, /- Moving time: 85 min/);
  assert.match(synced, /- Calories: 640 kcal/);
  assert.match(synced, /- Started at: 2026-09-24T07:30:00-06:00/);
  assert.match(synced, /- Provenance: synced from COROS \(activity 4711, last synced 2026-09-24T17:41:10.000Z\)/);
  assert.match(synced, /- FIT file: not fetched yet/);

  const manual = (await call('thrive_get_workout', { workout_id: 'w_man' })).text;
  assert.match(manual, /- Provenance: hand-logged/);
  assert.doesNotMatch(manual, /Calories|Moving time|Distance|FIT/);
});
