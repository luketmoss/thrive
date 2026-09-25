// #157 UX Must Fix — the provenance and "Last synced" text meets AA (4.5:1)
// on the surfaces it sits on, in both themes. Reads global.css, so a later
// hand-edit to a token is caught here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, 'global.css'), 'utf-8');

const theme = (name: 'light' | 'dark') =>
  css.match(new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? '';

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`${name} is not a six-digit hex in this theme`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
}

describe.each(['light', 'dark'] as const)('%s theme', (name) => {
  const t = theme(name);
  const bg = token(t, '--color-bg');
  const surface = token(t, '--color-surface');

  it('danger text measures AA on the page background', () => {
    expect(contrast(token(t, '--color-danger-text'), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('warning text measures AA on the page background', () => {
    expect(contrast(token(t, '--color-warning'), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('secondary text measures AA on the card and on the page', () => {
    const secondary = token(t, '--color-text-secondary');
    expect(contrast(secondary, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(secondary, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the new text uses the AA tokens, not the muted grey', () => {
  it.each(['.provenance-mark', '.detail-provenance', '.sync-status'])('%s is --color-text-secondary', (sel) => {
    expect(rule(sel)).toMatch(/color:\s*var\(--color-text-secondary\)/);
  });

  it('danger tone uses --color-danger-text, not --color-danger', () => {
    expect(rule('.sync-tone-danger')).toMatch(/color:\s*var\(--color-danger-text\)/);
  });

  it('the mark is not a chip: no background, no border', () => {
    expect(rule('.provenance-mark')).not.toMatch(/background|border/);
  });
});
