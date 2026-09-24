// #152: replaying COROS's responses through the ingest reproduces the archive
// files. The fixtures in ./fixtures are the files #152's live QA run landed in
// Drive, **anonymised** in #165 (this repo is public): COROS's text format is
// kept exactly (labels, separators, units, line structure, JSON-string
// encoding), and every measured value, clock time and vendor ID is a fake.
// Calendar dates are real. Hashes and list entries were re-derived, so the
// files are still internally consistent; #165 and #166 parse the same text.
// They hold no FIT URL, token or credential. The account had two days of data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleHash, createArchive, sha256 } from '../src/archive.mjs';
import { ingest, parseSportRecords } from '../src/ingest.mjs';
import { fakeCoros, memoryDrive, noWait } from './helpers.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const list = fixture('sport-records-2026-09-24.json');
const gym = fixture('activity-gym-cardio-471093826615208843.json');
const strength = fixture('activity-strength-471093115402967310.json');
const health = fixture('health-2026-09-24.json');

// The run's clock: 07:25 in Denver on 24 Sept.
const NOW = Date.parse('2026-09-24T13:25:32Z');
const text = (payload) => ({ content: [{ type: 'text', text: payload }], isError: false });

function realCoros() {
  const details = { [gym.activity_id]: gym.payload, [strength.activity_id]: strength.payload };
  const handlers = {
    querySportRecords: text(list.payload),
    getActivityDetail: ({ labelId }) => text(details[labelId]),
  };
  const byCall = new Map(health.calls.map((c) => [`${c.tool} ${JSON.stringify(c.args)}`, c.payload]));
  for (const { tool } of health.calls) {
    handlers[tool] = (args) => text(byCall.get(`${tool} ${JSON.stringify(args)}`));
  }
  return fakeCoros(handlers);
}

test('the archived list reads as the two archived activities', () => {
  const entries = parseSportRecords(list.payload);
  assert.deepEqual(entries, [gym.list_entry, strength.list_entry]);
});

test('every fixture payload hashes to its recorded payload_hash', () => {
  assert.equal(sha256(gym.payload), gym.payload_hash);
  assert.equal(sha256(strength.payload), strength.payload_hash);
  assert.equal(bundleHash(health.calls), health.payload_hash);
});

test('replaying the responses reproduces the archive, byte for byte', async () => {
  const drive = memoryDrive();
  const client = realCoros();
  const summary = await ingest({
    client, archive: createArchive(drive, { now: () => NOW }), now: NOW, log: () => {}, retry: noWait,
  });
  assert.deepEqual(summary.failures, []);
  assert.deepEqual(client.calls[0].args, list.args, 'the same window as the live run');

  const files = [...drive.files.values()].filter((f) => f.data);
  const strip = ({ fetched_at, ...rest }) => rest;
  for (const expected of [gym, strength]) {
    const got = files.find((f) => f.props.activity_id === expected.activity_id);
    assert.deepEqual(strip(got.data), strip(expected));
  }
  assert.deepEqual(strip(files.find((f) => f.props.kind === 'health').data), strip(health));
});
