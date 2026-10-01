// #241 AC2/AC3 — every Calendar shading bin ships with its own passing pairs,
// in both themes: the day number (text, 4.5:1) and the journal dot, activity
// marks and selected border (non-text, WCAG 1.4.11, 3:1) against all four
// `--cal-shade-*` tokens and against the plain unshaded cell. Almanac's third
// shading step failed AA in dark mode (keel#362); this is that check.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, 'global.css'), 'utf-8').replace(/\r\n/g, '\n');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

const THEMES = ['light', 'dark'] as const;
const SHADES = ['--cal-shade-1', '--cal-shade-2', '--cal-shade-3', '--cal-shade-4'];

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

const section = css.slice(css.indexOf('.calendar-screen {'));
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = section.match(new RegExp(`(?:^|\\n|,)\\s*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('the Calendar CSS draws with these tokens', () => {
  it('shades bins 1-4 with --cal-shade-1..4', () => {
    for (let b = 1; b <= 4; b++) expect(rule(`.calendar-shade-${b}`)).toMatch(new RegExp(`background:\\s*var\\(--cal-shade-${b}\\)`));
  });
  it('turns the number and marks --cal-on-shade on a shaded day', () => {
    expect(rule('.calendar-day-shade .calendar-day-num')).toMatch(/color:\s*var\(--cal-on-shade\)/);
  });
  it('draws the note dot and the selected border in --color-primary-text, marks in --color-text-muted', () => {
    expect(rule('.calendar-note')).toMatch(/background:\s*var\(--color-primary-text\)/);
    expect(rule('.calendar-day-selected')).toMatch(/inset 0 0 0 2px var\(--color-primary-text\)/);
    expect(rule('.calendar-marks')).toMatch(/color:\s*var\(--color-text-muted\)/);
    expect(rule('.calendar-day')).toMatch(/background:\s*var\(--color-surface\)/);
  });
});

describe.each(THEMES)('calendar shading tokens (%s)', (theme) => {
  it('defines --cal-shade-1..4 and --cal-on-shade as six-digit hex', () => {
    for (const t of [...SHADES, '--cal-on-shade']) expect(() => token(theme, t)).not.toThrow();
  });

  for (const bg of SHADES) {
    it(`the day number (--cal-on-shade) is at least 4.5:1 on ${bg}`, () => {
      const r = contrast(token(theme, '--cal-on-shade'), token(theme, bg));
      expect(r, `${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
    it(`the note dot and selected border (--color-primary-text) are at least 3:1 on ${bg}`, () => {
      const r = contrast(token(theme, '--color-primary-text'), token(theme, bg));
      expect(r, `${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }

  // The unshaded cell, and the selected day's fill when it is not shaded.
  for (const bg of ['--color-surface', '--color-primary-light']) {
    it(`marks (--color-text-muted) and the note dot are at least 3:1 on ${bg}`, () => {
      for (const fg of ['--color-text-muted', '--color-primary-text']) {
        const r = contrast(token(theme, fg), token(theme, bg));
        expect(r, `${fg} ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('the unshaded number is AA on the cell, the selected number on its fill, and today\'s on both', () => {
    expect(contrast(token(theme, '--color-text'), token(theme, '--color-surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(theme, '--color-primary-on-light'), token(theme, '--color-primary-light'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(theme, '--color-primary-text'), token(theme, '--color-surface'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Calendar components carry no literal colour', () => {
  const dir = resolve(__dirname, 'components/calendar');
  const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  it.each(files)('%s', (f) => {
    const src = readFileSync(join(dir, f), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\brgba?\(/);
  });
});
