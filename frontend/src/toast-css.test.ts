// #356 — toasts sit above the tab bar and FAB, never over a header control,
// and never swallow a tap.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, 'global.css'), 'utf-8').replace(/\r\n/g, '\n');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('toast placement (#356)', () => {
  it('is anchored to the bottom, above the nav, safe area and FAB, never the top', () => {
    const r = rule('.toast-container');
    expect(r).not.toMatch(/(^|[\s;])top:/);
    expect(r).toMatch(/bottom:\s*calc\([^;]*--nav-height[^;]*safe-area-inset-bottom[^;]*56px/);
    expect(r).toMatch(/pointer-events:\s*none/);
  });
  it('ignores pointer events on each toast', () => {
    expect(rule('.toast')).toMatch(/pointer-events:\s*none/);
  });
  it('slides in from below', () => {
    const m = /@keyframes toast-in\s*\{\s*from\s*\{([^}]*)\}/.exec(css);
    expect(m![1]).toMatch(/translateY\(12px\)/);
  });
});
