// #319 AC5 — the picker's rows and create row became <button>s: the UA button is
// reset so they look as the divs did, they stay at least 44 px tall, and the new
// rules are scoped so the Exercises screen's .exercise-list-item is untouched.
// jsdom has no layout, so this reads global.css, as editor-controls-css.test.ts does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, 'global.css'), 'utf-8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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

describe('#319 AC5: picker buttons keep their look and size', () => {
  for (const sel of ['.exercise-list > .exercise-list-item', '.create-new-row']) {
    it(`${sel} resets the UA button`, () => {
      const r = rule(sel);
      expect(r).toMatch(/(?:^|[\s;])width:\s*100%/);
      expect(r).toMatch(/text-align:\s*left/);
      expect(r).toMatch(/font:\s*inherit/);
      expect(r).toMatch(/background:\s*none/);
      expect(r).toMatch(/(?:^|[\s;])border:\s*0/);
      expect(r).toMatch(/min-height:\s*44px/);
    });

    it(`no rule sets ${sel} under 44 px tall`, () => {
      for (const body of rules(sel)) {
        for (const m of body.matchAll(/(?:min-)?height:\s*(\d+)px/g)) {
          expect(Number(m[1])).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }

  it('keeps the row divider and the create row top border', () => {
    expect(rule('.exercise-list > .exercise-list-item')).toMatch(/border-bottom:\s*1px solid var\(--color-border-light\)/);
    expect(rule('.create-new-row')).toMatch(/border-top:\s*1px solid var\(--color-border-light\)/);
  });

  it('keeps the create row primary text and weight after the font reset', () => {
    const r = rule('.create-new-row');
    expect(r).toMatch(/color:\s*var\(--color-primary-text\)/);
    expect(r.indexOf('font-weight: 600')).toBeGreaterThan(r.indexOf('font: inherit'));
  });

  it('adds no button reset to the shared .exercise-list-item rule', () => {
    expect(rule('.exercise-list-item')).not.toMatch(/(?:^|[\s;])(?:width|font|text-align|background)\s*:/);
  });
});
