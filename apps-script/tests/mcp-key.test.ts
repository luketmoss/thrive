// #364 — a second, MCP-only key (`MCP_API_KEY`) with the same full access as
// `API_KEY`, so the remote MCP Worker's credential can be revoked on its own.

import { describe, it, expect } from 'vitest';
import {
  loadApi, loadSources, callEntry, workoutRow, makeContentService, makePropertiesService,
  type FetchReply,
} from './apps-script-sandbox';

const MCP_KEY = 'mcp-worker-key';
const REFUSED = '{"success":false,"error":"Invalid or missing API key"}';
const read = { action: 'getWorkouts' };
const write = {
  action: 'createWorkout',
  payload: JSON.stringify({ data: { type: 'bike', name: 'Evening Ride' } }),
};

function load(properties: Record<string, string> = { MCP_API_KEY: MCP_KEY }, tokeninfo?: (url: string) => FetchReply) {
  return loadApi({ workouts: [workoutRow()] }, { properties, tokeninfo });
}

describe('AC1: either key makes a key caller', () => {
  for (const entry of ['doGet', 'doPost'] as const) {
    it(`gives the MCP key full access through ${entry}`, () => {
      const api = load();
      expect(callEntry(api.sandbox, entry, { ...read, key: MCP_KEY }).res.success).toBe(true);
      expect(callEntry(api.sandbox, entry, { ...write, key: MCP_KEY }).res.success).toBe(true);
      expect(api.rows).toHaveLength(2);
    });
  }

  it('still accepts API_KEY when MCP_API_KEY is set', () => {
    const { sandbox } = load();
    expect(callEntry(sandbox, 'doGet', { ...read, key: 'test-key' }).res.success).toBe(true);
  });

  it('refuses a key matching neither, with the same envelope as before', () => {
    const { sandbox } = load();
    expect(callEntry(sandbox, 'doGet', { ...read, key: 'nope' }).text).toBe(REFUSED);
    expect(callEntry(sandbox, 'doGet', { ...read, key: MCP_KEY + ' ' }).text).toBe(REFUSED);
  });
});

describe('AC2: an unset or blank MCP key is never a door', () => {
  const configs: Array<[string, Record<string, string>]> = [
    ['unset', {}],
    ['blank', { MCP_API_KEY: '' }],
  ];
  for (const [name, properties] of configs) {
    describe(`MCP_API_KEY ${name}`, () => {
      const attempts: Array<[string, Record<string, string>]> = [
        ['no key', read],
        ['an empty key', { ...read, key: '' }],
        ['another value', { ...read, key: MCP_KEY }],
      ];
      for (const [label, params] of attempts) {
        it(`refuses ${label}`, () => {
          const { sandbox } = load(properties);
          expect(callEntry(sandbox, 'doGet', params).text).toBe(REFUSED);
        });
      }

      it('leaves API_KEY working as before', () => {
        const { sandbox } = load(properties);
        expect(callEntry(sandbox, 'doGet', { ...read, key: 'test-key' }).res.success).toBe(true);
      });
    });
  }
});

describe('AC3: API_KEY stays mandatory', () => {
  it('errors for the MCP key when API_KEY is unset', () => {
    const sandbox = loadSources(['types.js', 'utils.js', 'workouts.js', 'auth.js', 'main.js'], {
      ContentService: makeContentService(),
      PropertiesService: makePropertiesService({ SPREADSHEET_ID: 'sheet-id', MCP_API_KEY: MCP_KEY }),
    });
    const { res } = callEntry(sandbox, 'doGet', { ...read, key: MCP_KEY });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/API_KEY not configured/);
  });
});

describe('AC4: the token door is untouched', () => {
  const CLIENT_ID = 'almanac-1234.apps.googleusercontent.com';
  const EMAIL = 'owner@example.com';
  const tokeninfo = (): FetchReply => ({
    status: 200,
    body: JSON.stringify({
      azp: CLIENT_ID, aud: CLIENT_ID, expires_in: '3599', email: EMAIL, email_verified: 'true',
    }),
  });
  const props = { MCP_API_KEY: MCP_KEY, TOKEN_CLIENT_ID: CLIENT_ID, TOKEN_ALLOWED_EMAIL: EMAIL };

  it('keeps a token caller read-only even with the MCP key alongside', () => {
    const api = load(props, tokeninfo);
    const { res } = callEntry(api.sandbox, 'doGet', { ...write, key: MCP_KEY, access_token: 'tok' });
    expect(res.code).toBe('read_only');
    expect(api.rows).toHaveLength(1);
  });

  it('never falls back to the MCP key when the token is refused', () => {
    const api = load(props, () => ({ status: 400, body: '{"error":"invalid_token"}' }));
    const { res } = callEntry(api.sandbox, 'doGet', { ...read, key: MCP_KEY, access_token: 'tok' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('token_invalid');
  });
});
