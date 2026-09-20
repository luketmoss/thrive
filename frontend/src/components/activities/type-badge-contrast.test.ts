// Issue #129 AC1 — the two new type badges must meet AA (4.5:1) in both
// themes, and must be distinguishable from badge-bike's blue under the common
// colour-vision deficiencies rather than merely being a different hue.
//
// This reads global.css rather than a token list, so a later hand-edit to a
// badge colour is caught here instead of in a screenshot nobody takes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, '../../global.css'), 'utf-8');

/** The background/color pair declared for a badge class, light or dark. */
function badgeColors(cls: string, dark = false): { background: string; color: string } {
  const selector = dark ? `\\[data-theme="dark"\\] \\.${cls}` : `\\.${cls}`;
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]+)\\}`))?.[1];
  if (!block) throw new Error(`No CSS block for ${dark ? 'dark ' : ''}.${cls}`);
  const pick = (prop: string) => {
    const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
    if (!m) throw new Error(`.${cls} declares no ${prop}`);
    return m[1].trim();
  };
  return { background: pick('background'), color: pick('color') };
}

function srgbToLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  expect(h, `${hex} should be a six-digit hex`).toHaveLength(6);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Brettel-style channel collapse, simplified: under deuteranopia and
 * protanopia the red/green axis flattens, so two hues that differ only along
 * it become the same colour. Comparing the *blue-yellow* opponent channel is
 * what tells a genuinely distinguishable hue from a merely different one.
 */
function blueYellow(hex: string): number {
  const [r, g, b] = rgb(hex);
  return b - (r + g) / 2;
}

const NEW_BADGES = ['badge-run', 'badge-walk'] as const;

describe('AC1: new badge hues meet AA in both themes', () => {
  for (const cls of NEW_BADGES) {
    it(`${cls} meets 4.5:1 in light mode`, () => {
      const { background, color } = badgeColors(cls);
      expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${cls} meets 4.5:1 in dark mode`, () => {
      const { background, color } = badgeColors(cls, true);
      expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('AC1: new hues are distinguishable from badge-bike, not merely different', () => {
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light';

    it(`badge-run separates from badge-bike on the blue-yellow axis (${theme})`, () => {
      const run = badgeColors('badge-run', dark).color;
      const bike = badgeColors('badge-bike', dark).color;
      // Violet vs blue survives the red/green collapse because violet carries
      // markedly less blue dominance once red is discounted.
      expect(Math.abs(blueYellow(run) - blueYellow(bike))).toBeGreaterThan(0.1);
    });

    it(`badge-walk separates from badge-bike on the blue-yellow axis (${theme})`, () => {
      const walk = badgeColors('badge-walk', dark).color;
      const bike = badgeColors('badge-bike', dark).color;
      expect(Math.abs(blueYellow(walk) - blueYellow(bike))).toBeGreaterThan(0.1);
    });

    it(`badge-run and badge-walk separate from each other (${theme})`, () => {
      const run = badgeColors('badge-run', dark).color;
      const walk = badgeColors('badge-walk', dark).color;
      expect(Math.abs(blueYellow(run) - blueYellow(walk))).toBeGreaterThan(0.1);
    });
  }
});

/**
 * A custom property's value from one of the theme blocks.
 *
 * Colour tokens live in `[data-theme="light"]` / `[data-theme="dark"]`, not
 * `:root` — `:root` carries the theme-independent radius and spacing scale.
 * `design-tokens.test.ts` draws the same distinction.
 */
function token(name: string, dark = false): string {
  const theme = dark ? 'dark' : 'light';
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1];
  const m = block?.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`No ${name} in the ${dark ? 'dark' : 'light'} block`);
  return m[1].trim();
}

// #129 AC3 — the venue control claims EffortToggle's AA contract, so the
// states it actually renders in have to hold it. The selected state was the
// one that did not: --color-primary-hover measures 4.17:1 on
// --color-primary-light and fails, which is why --color-primary-on-light
// exists.
describe('AC3: the venue toggle states meet AA', () => {
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light';

    it(`the selected state meets 4.5:1 (${theme})`, () => {
      const fg = token('--color-primary-on-light', dark);
      const bg = token('--color-primary-light', dark);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`the unset state meets 4.5:1 (${theme})`, () => {
      // Inherited from .effort-toggle-session .effort-btn, which uses
      // --color-text-secondary precisely because the muted token fails.
      const fg = token('--color-text-secondary', dark);
      const bg = token('--color-surface', dark);
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
