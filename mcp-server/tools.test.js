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
  'synced_at', 'started_at_utc', 'calories', 'estimated_seconds',
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
  // #145: a hand-planned session with an estimate.
  workout({ id: 'w_plan', date: '2026-09-21', type: 'weight', name: 'Upper Pull A', status: 'planned', estimated_seconds: '2820' }),
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
      case 'getBodyMeasurements':
        data = p.kind === 'bp' ? [] : [{
          grpid: '1001', date: p.from, time: '06:42', measured_at_utc: `${p.from}T06:42:00-06:00`,
          kind: 'scale', device_model: 'Body+', weight_kg: '72.3', fat_ratio_pct: '', fat_mass_kg: '',
          fat_free_mass_kg: '', muscle_mass_kg: '', hydration_kg: '', bone_mass_kg: '',
          systolic_mmhg: '', diastolic_mmhg: '', pulse_bpm: '61', attrib: '0', source: 'withings',
          raw_ref: '', synced_at: '',
        }];
        break;
      case 'getExercises': data = []; break;
      case 'getTemplates': data = []; break;
      case 'appendSets': data = { appended: 0 }; break;
      case 'createWorkout': data = JSON.parse(p.payload).data; break;
      case 'updateWorkout': {
        const { id, changes } = JSON.parse(p.payload);
        data = { ...WORKOUTS.find((w) => w.id === id), ...changes };
        break;
      }
      // #179: the fake API pages a 25,000-character payload for w_sync only.
      case 'getWorkoutPayload': {
        if (p.id === 'w_man') {
          res.end(JSON.stringify({ success: false, error: 'Workout "w_man" has no archived COROS payload (raw_ref is blank): it was logged by hand, or synced before the archive existed.' }));
          return;
        }
        if (p.id !== 'w_sync') {
          res.end(JSON.stringify({ success: false, error: `Workout "${p.id}" not found` }));
          return;
        }
        const full = 'A'.repeat(20000) + 'B'.repeat(5000);
        const offset = Number(p.offset ?? 0);
        const end = Math.min(offset + 20000, full.length);
        data = { workout_id: 'w_sync', source_activity_id: '4711', raw_ref: 'raw-1', tool: 'getActivityDetail',
          fetched_at: '2026-09-24T17:41:08.114Z', text: full.slice(offset, end), offset,
          total_chars: full.length, next_offset: end < full.length ? end : null };
        break;
      }
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
  assert.match(summary.description, /how many of the day's sessions recorded them/);
  assert.match(summary.description, /means nobody recorded it, not that you stood still/);
  assert.doesNotMatch(summary.description, /plain sums/);
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

// --- #201 ------------------------------------------------------------

test('thrive_body_measurements is registered, defaults to 30 days, and shows mass in kg and lb', async () => {
  const { tools } = await client.listTools();
  const t = tools.find((x) => x.name === 'thrive_body_measurements');
  assert.ok(t);
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['date_from', 'date_to', 'kind']);
  assert.match(t.description, /30 days ending today/);
  assert.match(t.description, /shown in lb/);
  assert.match(t.description, /several blood pressure readings/);
  assert.match(t.description, /DailySummary/);

  const before = calls.length;
  const { text, isError } = await call('thrive_body_measurements', { date_to: '2026-09-24' });
  assert.equal(isError, false);
  const sent = calls[before];
  assert.equal(sent.action, 'getBodyMeasurements');
  assert.equal(sent.from, '2026-08-26');
  assert.equal(sent.to, '2026-09-24');
  assert.match(text, /72\.3 kg \(159\.4 lb\)/);
});

test('thrive_body_measurements filters by kind and says so when empty', async () => {
  const { text } = await call('thrive_body_measurements', { date_to: '2026-09-24', kind: 'bp' });
  assert.match(text, /No bp readings in this range\./);
});

test('thrive_list_workouts shows venue and provenance, and filters on source', async () => {
  const all = (await call('thrive_list_workouts')).text;
  assert.match(all, /\*\*Gravel Bike\*\* \[bike:gravel\] \(COROS\)/);
  assert.match(all, /\*\*Upper Push\*\* \[weight\] \(enriched from COROS\)/);
  assert.match(all, /\*\*Morning Hike\*\* \[hike\] \(id: w_man\)/);

  const only = async (source) => (await call('thrive_list_workouts', { source })).text;
  assert.match(await only('synced'), /^1 workouts:\n.*Gravel Bike/);
  assert.match(await only('enriched'), /^1 workouts:\n.*Upper Push/);
  assert.match(await only('manual'), /^2 workouts:\n.*Morning Hike.*\n.*Upper Pull A/);
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

// --- #179 ----------------------------------------------------------------

test('thrive_get_workout_payload is registered with workout_id and offset only', async () => {
  const { tools } = await client.listTools();
  const t = tools.find((x) => x.name === 'thrive_get_workout_payload');
  assert.ok(t);
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['offset', 'workout_id']);
  assert.match(t.description, /20,000 characters per call/);
  assert.match(t.description, /\[Truncated: \.\.\.\]/);
  assert.match(t.description, /FIT file contents .* are not readable/);
  const get = tools.find((x) => x.name === 'thrive_get_workout');
  assert.match(get.description, /readable with thrive_get_workout_payload/);
});

test('thrive_get_workout_payload pages a long payload and says where to continue', async () => {
  const first = await call('thrive_get_workout_payload', { workout_id: 'w_sync' });
  assert.equal(first.isError, false);
  assert.match(first.text, /Characters 0–20,000 of 25,000\./);
  assert.match(first.text, /\[Truncated: 5,000 more characters\. Call thrive_get_workout_payload again with offset 20000 for the next page\.\]$/);
  const sent = calls.findLast((c) => c.action === 'getWorkoutPayload');
  assert.equal(sent.id, 'w_sync');
  assert.equal(sent.offset, undefined);

  const next = await call('thrive_get_workout_payload', { workout_id: 'w_sync', offset: 20000 });
  assert.equal(calls.findLast((c) => c.action === 'getWorkoutPayload').offset, '20000');
  assert.match(next.text, /Characters 20,000–25,000 of 25,000\./);
  assert.match(next.text, /B{5000}\n\n\[End of payload: this page completes it\.\]$/);
});

test('thrive_get_workout_payload passes the API refusal through, and names an unknown id', async () => {
  const manual = await call('thrive_get_workout_payload', { workout_id: 'w_man' });
  assert.equal(manual.isError, true);
  assert.match(manual.text, /has no archived COROS payload \(raw_ref is blank\)/);

  const unknown = await call('thrive_get_workout_payload', { workout_id: 'w_nope' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /No workout with id "w_nope"\./);
});

test('thrive_get_workout_payload refuses a Drive id field by name, before any request', async () => {
  const before = calls.length;
  const res = await call('thrive_get_workout_payload', { workout_id: 'w_sync', raw_ref: 'tokenFile' });
  assert.equal(res.isError, true);
  assert.match(res.text, /Unknown field "raw_ref"/);
  assert.equal(calls.length, before);
});

test('thrive_get_workout points at the payload tool', async () => {
  const synced = (await call('thrive_get_workout', { workout_id: 'w_sync' })).text;
  assert.match(synced, /- Raw vendor payload: archived in Drive \(raw-1\); read it with thrive_get_workout_payload/);
});

// --- #145 ----------------------------------------------------------------

const payloadOf = (action) => JSON.parse(calls.filter((c) => c.action === action).at(-1).payload);

test('thrive_get_workout and thrive_list_workouts show a planned estimate, and only when set', async () => {
  const planned = (await call('thrive_get_workout', { workout_id: 'w_plan' })).text;
  assert.match(planned, /\(planned\)/);
  assert.match(planned, /- Estimated duration: 47 min\n/);
  assert.doesNotMatch(planned, /- Duration:/);

  const list = (await call('thrive_list_workouts')).text;
  assert.match(list, /\*\*Upper Pull A\*\* \[weight\] \(planned\) .*— est\. 47 min/);
  assert.equal((list.match(/est\./g) || []).length, 1);

  const manual = (await call('thrive_get_workout', { workout_id: 'w_man' })).text;
  assert.doesNotMatch(manual, /Estimated/);
});

test('thrive_schedule_workout takes estimated_min in minutes and stores seconds', async () => {
  const res = await call('thrive_schedule_workout', { date: '2099-12-31', name: 'Long Ride', type: 'bike', estimated_min: 47 });
  assert.equal(res.isError, false, res.text);
  assert.equal(payloadOf('createWorkout').data.estimated_seconds, '2820');
  assert.match(res.text, /- Estimated duration: 47 min/);

  await call('thrive_schedule_workout', { date: '2099-12-31', name: 'Long Ride', type: 'bike' });
  assert.equal(payloadOf('createWorkout').data.estimated_seconds, '');
});

test('thrive_schedule_week takes estimated_min per entry', async () => {
  const res = await call('thrive_schedule_week', { workouts: [
    { date: '2099-12-30', name: 'Ride A', type: 'bike', estimated_min: '45' },
    { date: '2099-12-31', name: 'Ride B', type: 'bike' },
  ] });
  assert.equal(res.isError, false, res.text);
  const created = calls.filter((c) => c.action === 'createWorkout').slice(-2).map((c) => JSON.parse(c.payload).data);
  assert.deepEqual(created.map((w) => w.estimated_seconds), ['2700', '']);
  assert.match(res.text, /Ride A\*\* \[bike\] \(planned\) — 0 planned sets, est\. 45 min/);
});

test('estimated_min refuses anything but whole minutes of at least 1, before any write', async () => {
  for (const bad of ['45 min', '0', '47.5', -5]) {
    const before = calls.filter((c) => c.action === 'createWorkout').length;
    const res = await call('thrive_schedule_workout', { date: '2099-12-31', name: 'Ride', type: 'bike', estimated_min: bad });
    assert.equal(res.isError, true, `${bad} should be refused`);
    assert.match(res.text, /estimated_min must be whole minutes/);
    assert.equal(calls.filter((c) => c.action === 'createWorkout').length, before);
  }
});

test('thrive_update_workout changes and clears the estimate, never elapsed', async () => {
  const res = await call('thrive_update_workout', { workout_id: 'w_plan', estimated_min: 50 });
  assert.equal(res.isError, false, res.text);
  assert.deepEqual(payloadOf('updateWorkout').changes, { estimated_seconds: '3000' });
  assert.match(res.text, /estimate 47 min -> 50 min/);

  await call('thrive_update_workout', { workout_id: 'w_plan', estimated_min: '' });
  assert.deepEqual(payloadOf('updateWorkout').changes, { estimated_seconds: '' });
});
