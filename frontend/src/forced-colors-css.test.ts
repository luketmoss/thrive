// #330 — selected states drawn with a background fill or inset box-shadow
// vanish in forced-colors mode. One @media (forced-colors: active) block in
// global.css restores them with system colours; this guards that every
// selected-state selector stays named there. Reads global.css directly, as
// control-contrast.test.ts does.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, 'global.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

function forcedBlock(): string {
  const start = css.indexOf('@media (forced-colors: active)');
  if (start < 0) throw new Error('No forced-colors block');
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('Unterminated forced-colors block');
}

const block = forcedBlock();

const SELECTORS = [
  // AC1
  '.theme-toggle-btn.active', '.library-switch-btn.active', '.sub-type-btn.active',
  '.calendar-shade-toggle .sub-type-btn.active', '.trends-group-btn.active',
  // AC2
  '.filter-chip.active', '.tag-badge.active', '.tag-badge-colored.active', '.label-chip-active',
  // AC3
  '.streak-dot', '.streak-dot.filled', '.streak-dot.today',
  // AC4
  '.bottom-nav-tab.active', '.calendar-day-selected', '.section-picker-pill-active',
  '.effort-btn.active',
];

describe('forced-colors selected states (#330)', () => {
  it('has exactly one forced-colors block', () => {
    expect(css.match(/@media \(forced-colors: active\)/g)).toHaveLength(1);
  });

  it.each(SELECTORS)('names %s', (sel) => {
    expect(block).toContain(sel);
  });

  it('uses system colours for the selected fill', () => {
    expect(block).toMatch(/background:\s*Highlight/);
    expect(block).toMatch(/color:\s*HighlightText/);
  });

  it('gives empty streak dots a real border, not a box-shadow', () => {
    expect(block).toMatch(/\.streak-dot\s*\{[^}]*border:\s*2px solid CanvasText/);
  });

  it('never draws the selected cue with outline on the toggles (focus ring owns it)', () => {
    const selectedRule = block.match(/\.theme-toggle-btn\.active[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(selectedRule).not.toMatch(/outline/);
  });

  it('keeps everything new inside the block (no top-level forced-colors rules)', () => {
    expect(css.replace(block, '')).not.toMatch(/Highlight(Text)?\b/);
  });
});
