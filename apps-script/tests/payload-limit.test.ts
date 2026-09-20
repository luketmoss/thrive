// #130 AC5 — a payload too large for the transport fails loudly.
//
// Writes travel as a URL-encoded query parameter because Apps Script's
// redirect on POST breaks anonymous callers. The failure mode that matters is
// not a parse error: it is a payload truncated in transit that still parses,
// into an object quietly missing its last fields.

import { describe, it, expect } from 'vitest';
import { loadApi, callDoGet, workoutRow, type ApiWorkout } from './apps-script-sandbox';

function payloadOfLength(chars: number): string {
  const notes = 'x'.repeat(Math.max(0, chars - 60));
  return JSON.stringify({ data: { type: 'bike', name: 'Ride', notes } });
}

describe('AC5: the limit is enforced, not hoped for', () => {
  it('declares a documented limit', () => {
    const { sandbox } = loadApi();
    expect(typeof sandbox.MAX_PAYLOAD_CHARS).toBe('number');
    expect(sandbox.MAX_PAYLOAD_CHARS).toBeGreaterThan(0);
  });

  it('refuses a payload over the limit', () => {
    const { sandbox, rows } = loadApi();
    const res = callDoGet(sandbox, {
      action: 'createWorkout',
      payload: payloadOfLength(sandbox.MAX_PAYLOAD_CHARS + 100),
    });
    expect(res.success).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it('says how long the payload was and what the limit is', () => {
    const { sandbox } = loadApi();
    const limit = sandbox.MAX_PAYLOAD_CHARS;
    const res = callDoGet(sandbox, {
      action: 'createWorkout',
      payload: payloadOfLength(limit + 100),
    });
    expect(res.error).toMatch(new RegExp(String(limit)));
    expect(res.error).toMatch(/characters/);
  });

  it('tells the caller what to do about it', () => {
    const { sandbox } = loadApi();
    const res = callDoGet(sandbox, {
      action: 'createWorkout',
      payload: payloadOfLength(sandbox.MAX_PAYLOAD_CHARS + 100),
    });
    expect(res.error).toMatch(/batch/i);
  });

  // The whole point: refuse by length *before* parsing, so a truncation that
  // happens to still parse cannot be written.
  it('refuses on length rather than waiting for a parse failure', () => {
    const { sandbox, rows } = loadApi();
    // Valid JSON, just too long — it would parse perfectly well.
    const res = callDoGet(sandbox, {
      action: 'createWorkout',
      payload: payloadOfLength(sandbox.MAX_PAYLOAD_CHARS + 500),
    });
    expect(res.error).toMatch(/over the/);
    expect(res.error).not.toMatch(/not valid JSON/);
    expect(rows).toHaveLength(0);
  });

  it('accepts a payload under the limit', () => {
    const { sandbox, rows } = loadApi();
    const res = callDoGet<ApiWorkout>(sandbox, {
      action: 'createWorkout',
      payload: payloadOfLength(sandbox.MAX_PAYLOAD_CHARS - 200),
    });
    expect(res.success).toBe(true);
    expect(rows).toHaveLength(1);
  });
});

describe('AC5: malformed JSON fails clearly too', () => {
  it('reports a parse failure rather than a stack trace', () => {
    const { sandbox } = loadApi();
    const res = callDoGet(sandbox, { action: 'createWorkout', payload: '{"data":{"type":' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not valid JSON/);
  });

  // A truncated payload usually looks exactly like malformed JSON, so the
  // message names that possibility rather than leaving it to be guessed.
  it('raises truncation as the likely cause', () => {
    const { sandbox } = loadApi();
    const res = callDoGet(sandbox, { action: 'createWorkout', payload: '{"data":{"type":' });
    expect(res.error).toMatch(/truncated/i);
  });

  it('leaves the sheet untouched', () => {
    const { sandbox, rows } = loadApi([workoutRow()]);
    callDoGet(sandbox, { action: 'createWorkout', payload: '{oh no' });
    expect(rows).toHaveLength(1);
  });

  it('treats an absent payload as empty rather than an error', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const res = callDoGet(sandbox, { action: 'getWorkouts' });
    expect(res.success).toBe(true);
  });
});
