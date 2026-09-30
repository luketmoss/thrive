// #242 AC5 — the Trends chart marks meet WCAG 1.4.11 (3:1 for graphical
// objects) against the card and against the band they are drawn over, in
// both themes. Almanac's dot failed exactly this (keel#363). Grid is
// decoration and exempt. No component may carry a literal colour instead.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, 'global.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const THEMES = ['light', 'dark'] as const;

function token(theme: string, name: string): string {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? '';
  const m = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`${name} is not a six-digit hex in the ${theme} block`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(THEMES)('chart tokens (%s)', (theme) => {
  it('defines --chart-dot, --chart-line, --chart-band and --chart-grid as six-digit hex', () => {
    for (const t of ['--chart-dot', '--chart-line', '--chart-band', '--chart-grid']) {
      expect(() => token(theme, t)).not.toThrow();
    }
  });

  for (const fg of ['--chart-dot', '--chart-line']) {
    for (const bg of ['--color-surface', '--chart-band']) {
      it(`${fg} is at least 3:1 on ${bg}`, () => {
        const ratio = contrast(token(theme, fg), token(theme, bg));
        expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('--color-text-secondary axis text is AA on the band', () => {
    expect(contrast(token(theme, '--color-text-secondary'), token(theme, '--chart-band'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Trends components carry no literal colour', () => {
  const dir = resolve(__dirname, 'components/trends');
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  it.each(files)('%s', (f) => {
    // Comments cite issues (#242) and are not colours.
    const src = readFileSync(join(dir, f), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\brgba?\(/);
  });
});
