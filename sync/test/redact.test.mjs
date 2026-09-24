// #151 AC1/AC5: no token value reaches a log line or an error.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearSecrets, redact, redactObject, registerSecret } from '../src/redact.mjs';

beforeEach(() => clearSecrets());

test('a registered secret is scrubbed wherever it appears', () => {
  registerSecret('refresh-abcdef123456');
  assert.equal(redact('failed with refresh-abcdef123456 in the body'), 'failed with [redacted] in the body');
});

test('credential-named JSON fields are masked even when their value was never seen', () => {
  const out = redact('{"error":"x","refresh_token":"never-registered-value","access_token":"also"}');
  assert.doesNotMatch(out, /never-registered-value|"also"/);
  assert.match(out, /"error":"x"/);
});

test('a bearer header is masked', () => {
  assert.equal(redact('Authorization: Bearer ya29.a0AfH6SMB'), 'Authorization: Bearer [redacted]');
});

test('objects are masked by key, recursively', () => {
  assert.deepEqual(
    redactObject({ client_id: 'c', nested: { refresh_token: 'r', ok: 1 } }),
    { client_id: 'c', nested: { refresh_token: '[redacted]', ok: 1 } },
  );
});

test('short strings are not registered, so ordinary words are never masked', () => {
  registerSecret('abc');
  assert.equal(redact('abc'), 'abc');
});
