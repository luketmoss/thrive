// #130 AC1 — every request is authenticated, and every response uses one
// envelope shape so a caller never has to guess which of three it got.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApi, callDoGet, workoutRow, makeContentService, makePropertiesService, loadSources } from './apps-script-sandbox';

describe('AC1: authentication', () => {
  it('rejects a request with no key', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const res = JSON.parse(sandbox.doGet({ parameter: { action: 'getWorkouts' } }).getContent());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid or missing API key/);
  });

  it('rejects a request with the wrong key', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const res = JSON.parse(
      sandbox.doGet({ parameter: { action: 'getWorkouts', key: 'not-the-key' } }).getContent()
    );
    expect(res.success).toBe(false);
  });

  it('returns no data alongside a rejection', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const res = JSON.parse(sandbox.doGet({ parameter: { action: 'getWorkouts' } }).getContent());
    expect(res.data).toBeUndefined();
  });

  it('rejects before dispatching, so an unknown action still needs a key', () => {
    const { sandbox } = loadApi();
    const res = JSON.parse(sandbox.doGet({ parameter: { action: 'dropEverything' } }).getContent());
    expect(res.error).toMatch(/API key/);
  });

  it('accepts the configured key', () => {
    const { sandbox } = loadApi([workoutRow()]);
    expect(callDoGet(sandbox, { action: 'getWorkouts' }).success).toBe(true);
  });

  // The key lives in script properties, never in source — this repo is public.
  it('errors rather than opening the door when no key is configured', () => {
    const sandbox = loadSources(['types.js', 'utils.js', 'workouts.js', 'main.js'], {
      ContentService: makeContentService(),
      PropertiesService: makePropertiesService({ SPREADSHEET_ID: 'sheet-id' }),
    });
    const res = JSON.parse(
      sandbox.doGet({ parameter: { action: 'getWorkouts', key: 'anything' } }).getContent()
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/API_KEY not configured/);
  });

  // The repo is public, so this is worth asserting rather than assuming.
  it('reads the key from script properties and never from source', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.js'));
    expect(sources.length).toBeGreaterThan(0);

    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      // An assignment of a literal to anything key-shaped.
      expect(text, file).not.toMatch(/API_KEY\s*[=:]\s*['"][^'"]+['"]/);
      expect(text, file).not.toMatch(/(apiKey|api_key)\s*=\s*['"][^'"]+['"]/i);
    }

    const main = readFileSync(path.join(dir, 'main.js'), 'utf8');
    expect(main).toMatch(/PropertiesService\.getScriptProperties\(\)\.getProperty\('API_KEY'\)/);
  });
});

describe('AC1: one envelope for every outcome', () => {
  const shapes = [
    ['success', { action: 'getWorkouts' }],
    ['rejection', { action: 'getWorkout' }],                      // missing id
    ['unknown action', { action: 'noSuchAction' }],
    ['thrown error', { action: 'getWorkouts', date: 'not-a-date' }],
  ] as const;

  for (const [name, params] of shapes) {
    it(`answers a ${name} in the same shape`, () => {
      const { sandbox } = loadApi([workoutRow()]);
      const res = callDoGet(sandbox, params as Record<string, string>);
      expect(typeof res.success).toBe('boolean');
      if (res.success) {
        expect(res).toHaveProperty('data');
        expect(res.error).toBeUndefined();
      } else {
        expect(typeof res.error).toBe('string');
        expect(res.error!.length).toBeGreaterThan(0);
      }
    });
  }

  it('turns a thrown error into the envelope rather than a 500', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const res = callDoGet(sandbox, { action: 'getWorkouts', type: 'swimming' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid type: "swimming"/);
  });

  it('names the unknown action it refused', () => {
    const { sandbox } = loadApi();
    const res = callDoGet(sandbox, { action: 'deleteEverything' });
    expect(res.error).toBe('Unknown action: "deleteEverything"');
  });

  it('serves JSON', () => {
    const { sandbox } = loadApi([workoutRow()]);
    const output = sandbox.doGet({ parameter: { key: 'test-key', action: 'getWorkouts' } });
    expect(() => JSON.parse(output.getContent())).not.toThrow();
  });
});
