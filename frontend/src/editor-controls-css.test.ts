// #321 — the editor's Move up, Move down and Remove hold 44x44 targets.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, 'global.css'), 'utf-8').replace(/\r\n/g, '\n');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

function rules(selector: string): string[] {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]);
}
function rule(selector: string): string {
  const r = rules(selector);
  if (r.length === 0) throw new Error(`no rule for ${selector}`);
  return r[0];
}

describe('Editor control touch targets (#321)', () => {
  for (const sel of ['.reorder-btn', '.compact-card-remove']) {
    it(`${sel} is a 44x44 box that never shrinks`, () => {
      const r = rule(sel);
      expect(r).toMatch(/(?:^|[\s;])(?:min-)?width:\s*44px/);
      expect(r).toMatch(/(?:^|[\s;])(?:min-)?height:\s*44px/);
      expect(r).toMatch(/flex-shrink:\s*0/);
    });

    it(`no rule sets ${sel} under 44 px`, () => {
      for (const body of rules(sel)) {
        for (const m of body.matchAll(/(?:min-)?(?:height|width):\s*(\d+)px/g)) {
          expect(Number(m[1])).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }

  it('keeps the glyph sizes', () => {
    expect(rule('.reorder-btn')).toMatch(/font-size:\s*var\(--text-xs\)/);
    expect(rule('.compact-card-remove')).toMatch(/font-size:\s*var\(--text-sm\)/);
  });

  it('lays the reorder pair out in a row', () => {
    const r = rule('.compact-card-reorder');
    expect(r).toMatch(/flex-direction:\s*row/);
    expect(r).not.toMatch(/column/);
  });

  it('lets the editable card name wrap, and keeps read-only names truncated', () => {
    const r = rule('.compact-card-editable .compact-card-name');
    expect(r).toMatch(/white-space:\s*normal/);
    expect(r).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.compact-card-name')).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('sets no outline of its own on the controls', () => {
    for (const sel of ['.reorder-btn', '.compact-card-remove', '.compact-card-editable']) {
      for (const body of rules(sel)) expect(body).not.toMatch(/outline/);
    }
  });

  it('removed the dead template-exercise-row rules', () => {
    expect(css).not.toMatch(/\.template-exercise-row/);
  });
});
