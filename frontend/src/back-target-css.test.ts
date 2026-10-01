// #280 — every header Back control, and the modal close, holds a 44 px target.
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

describe('Back and close touch targets (#280)', () => {
  it('holds the shared Back to a 44 px box that never shrinks or wraps', () => {
    const r = rule('.template-editor-back');
    expect(r).toMatch(/display:\s*inline-flex/);
    expect(r).toMatch(/align-items:\s*center/);
    expect(r).toMatch(/min-height:\s*44px/);
    expect(r).toMatch(/min-width:\s*44px/);
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/flex-shrink:\s*0/);
  });

  it('never lets another rule set the Back below 44 px', () => {
    for (const body of rules('.template-editor-back')) {
      for (const m of body.matchAll(/(?:min-)?(?:height|width):\s*(\d+)px/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('makes the modal close 44x44', () => {
    const r = rule('.modal-close');
    expect(r).toMatch(/width:\s*44px/);
    expect(r).toMatch(/height:\s*44px/);
  });

  it('leaves the calendar Back with no size of its own', () => {
    for (const body of rules('.calendar-back')) {
      expect(body).not.toMatch(/min-height|min-width/);
    }
  });
});
