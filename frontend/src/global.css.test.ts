/**
 * Tests for issue #79 — Apply unified orange color scheme
 * Validates that global.css token values match the spec.
 *
 * Strategy: parse the raw CSS text and extract custom property values
 * from the [data-theme="light"] and [data-theme="dark"] blocks.
 * This avoids needing a browser environment.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let cssText: string;

beforeAll(() => {
  cssText = readFileSync(resolve(__dirname, 'global.css'), 'utf-8');
});

function extractBlock(css: string, selector: string): string {
  // Match the block for the given selector (handles nested braces by counting depth)
  const idx = css.indexOf(selector);
  if (idx === -1) return '';
  const start = css.indexOf('{', idx);
  if (start === -1) return '';
  let depth = 0;
  let end = start;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return css.slice(start + 1, end);
}

function getToken(block: string, token: string): string | null {
  const re = new RegExp(`${token}\\s*:\\s*([^;]+);`);
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

describe('AC1: Primary color tokens — light mode', () => {
  let lightBlock: string;
  beforeAll(() => { lightBlock = extractBlock(cssText, '[data-theme="light"]'); });

  it('--color-primary is #FF6B35', () => {
    expect(getToken(lightBlock, '--color-primary')).toBe('#FF6B35');
  });
  it('--color-primary-hover is #D4400A', () => {
    expect(getToken(lightBlock, '--color-primary-hover')).toBe('#D4400A');
  });
  it('--color-primary-light is #fff0eb', () => {
    expect(getToken(lightBlock, '--color-primary-light')).toBe('#fff0eb');
  });
  it('--color-primary-rgb is 255, 107, 53', () => {
    expect(getToken(lightBlock, '--color-primary-rgb')).toBe('255, 107, 53');
  });
  it('--color-primary-focus-ring is rgba(255, 107, 53, 0.25)', () => {
    expect(getToken(lightBlock, '--color-primary-focus-ring')).toBe('rgba(255, 107, 53, 0.25)');
  });
});

describe('AC2: Primary color tokens — dark mode', () => {
  let darkBlock: string;
  beforeAll(() => { darkBlock = extractBlock(cssText, '[data-theme="dark"]'); });

  it('--color-primary is #FF6B35', () => {
    expect(getToken(darkBlock, '--color-primary')).toBe('#FF6B35');
  });
  it('--color-primary-hover is #FF9A76', () => {
    expect(getToken(darkBlock, '--color-primary-hover')).toBe('#FF9A76');
  });
  it('--color-primary-light is #2d1a10', () => {
    expect(getToken(darkBlock, '--color-primary-light')).toBe('#2d1a10');
  });
  it('--color-primary-rgb is 255, 107, 53', () => {
    expect(getToken(darkBlock, '--color-primary-rgb')).toBe('255, 107, 53');
  });
  it('--color-primary-focus-ring is rgba(255, 107, 53, 0.3)', () => {
    expect(getToken(darkBlock, '--color-primary-focus-ring')).toBe('rgba(255, 107, 53, 0.3)');
  });
});

describe('AC3: Neutral palette tokens — light mode', () => {
  let lightBlock: string;
  beforeAll(() => { lightBlock = extractBlock(cssText, '[data-theme="light"]'); });

  it('--color-bg is #f0f2f5', () => {
    expect(getToken(lightBlock, '--color-bg')).toBe('#f0f2f5');
  });
  it('--color-border is #dadce0', () => {
    expect(getToken(lightBlock, '--color-border')).toBe('#dadce0');
  });
  it('--color-border-light is #e8eaed', () => {
    expect(getToken(lightBlock, '--color-border-light')).toBe('#e8eaed');
  });
  it('--color-text is #1f1f1f', () => {
    expect(getToken(lightBlock, '--color-text')).toBe('#1f1f1f');
  });
  it('--color-text-secondary is #5f6368', () => {
    expect(getToken(lightBlock, '--color-text-secondary')).toBe('#5f6368');
  });
});

describe('AC3: Neutral palette tokens — dark mode', () => {
  let darkBlock: string;
  beforeAll(() => { darkBlock = extractBlock(cssText, '[data-theme="dark"]'); });

  it('--color-bg is #121212', () => {
    expect(getToken(darkBlock, '--color-bg')).toBe('#121212');
  });
  it('--color-surface-raised is #252528', () => {
    expect(getToken(darkBlock, '--color-surface-raised')).toBe('#252528');
  });
  it('--color-border is #3c3c3c', () => {
    expect(getToken(darkBlock, '--color-border')).toBe('#3c3c3c');
  });
  it('--color-text is #e8eaed', () => {
    expect(getToken(darkBlock, '--color-text')).toBe('#e8eaed');
  });
  it('--color-text-secondary is #9aa0a6', () => {
    expect(getToken(darkBlock, '--color-text-secondary')).toBe('#9aa0a6');
  });
});

describe('AC4: Semantic color tokens — light mode', () => {
  let lightBlock: string;
  beforeAll(() => { lightBlock = extractBlock(cssText, '[data-theme="light"]'); });

  it('--color-danger is #d32f2f', () => {
    expect(getToken(lightBlock, '--color-danger')).toBe('#d32f2f');
  });
  it('--color-success is #2e7d32', () => {
    expect(getToken(lightBlock, '--color-success')).toBe('#2e7d32');
  });
  it('--color-warning is #a05d00', () => {
    expect(getToken(lightBlock, '--color-warning')).toBe('#a05d00');
  });
});

describe('AC4: Semantic color tokens — dark mode', () => {
  let darkBlock: string;
  beforeAll(() => { darkBlock = extractBlock(cssText, '[data-theme="dark"]'); });

  it('--color-danger is #ef5350', () => {
    expect(getToken(darkBlock, '--color-danger')).toBe('#ef5350');
  });
  it('--color-success is #66bb6a', () => {
    expect(getToken(darkBlock, '--color-success')).toBe('#66bb6a');
  });
  it('--color-warning is #ffb74d', () => {
    expect(getToken(darkBlock, '--color-warning')).toBe('#ffb74d');
  });
});

describe('AC5: Focus ring token, manifest, no blue remnants', () => {
  it('focus box-shadow rules use var(--color-primary-focus-ring), not var(--color-primary-light)', () => {
    // Should not find old pattern
    expect(cssText).not.toMatch(/box-shadow:\s*0 0 0 [23]px var\(--color-primary-light\)/);
    // Should find new pattern at least once
    expect(cssText).toMatch(/box-shadow:.*var\(--color-primary-focus-ring\)/);
  });

  it('no blue primary hex remnants in global.css', () => {
    expect(cssText).not.toMatch(/#4f6ef7/i);
    expect(cssText).not.toMatch(/#6b8aff/i);
    expect(cssText).not.toMatch(/#3b5de5/i);
    expect(cssText).not.toMatch(/#5a7af5/i);
  });

  it('manifest.json background_color is #f0f2f5', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../public/manifest.json'), 'utf-8')
    );
    expect(manifest.background_color).toBe('#f0f2f5');
  });
});

describe('#112: the weekly target row is removed, its shared styling is not', () => {
  it('AC4: the .target-met rule is gone', () => {
    expect(cssText).not.toMatch(/\.target-met/);
  });

  it('AC2: .stats-row and .stats-row-value survive — the cardio row still uses them', () => {
    expect(cssText).toMatch(/^\.stats-row \{/m);
    expect(cssText).toMatch(/^\.stats-row-value \{/m);
  });

  it('AC4: --color-success stays, it is used elsewhere', () => {
    expect(cssText).toMatch(/--color-success:/);
  });
});
