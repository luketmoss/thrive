// #182 — every text colour in global.css meets WCAG AA (4.5:1) against the
// backgrounds it is drawn on, in both themes. System resolves to one of the
// two `data-theme` blocks, so there is nothing separate to measure for it.
//
// This reads global.css and LABEL_COLORS directly, so a later hand-edit to a
// token, a badge pair or a label colour fails here, not in a screenshot.
//
// Scope, deliberately: text colours only. White text on filled controls,
// opacity-dimmed chips and 3:1 control borders are #183.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LABEL_COLORS } from './api/label-colors';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, 'global.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

function themeBlock(theme: Theme): string {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1];
  if (!block) throw new Error(`No [data-theme="${theme}"] block`);
  return block;
}

function token(theme: Theme, name: string): string {
  const m = themeBlock(theme).match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
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

/** Every `selector { body }` rule, flattened. Good enough for this file: it has no nesting. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim().replace(/\s+/g, ' '),
  body: m[2],
}));

const decl = (body: string, prop: string) =>
  body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`))?.[1].trim();

// The backgrounds text sits on: page, card, raised surface (inputs, the effort
// toggle, sheets), and the orange tint (tag badges, the last-time panel).
const BACKGROUNDS = ['--color-bg', '--color-surface', '--color-surface-raised', '--color-primary-light'];

// Tokens used as `color:`. --color-primary and --color-danger are fills and
// are deliberately absent; the rule check below keeps them out of `color:`.
const TEXT_TOKENS = [
  '--color-text',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-primary-text',
  '--color-primary-on-light',
  '--color-danger-text',
  '--color-success',
  '--color-warning',
];

describe.each(THEMES)('AC1-AC3: text tokens meet AA on every background (%s)', (theme) => {
  for (const fg of TEXT_TOKENS) {
    for (const bg of BACKGROUNDS) {
      it(`${fg} on ${bg}`, () => {
        const ratio = contrast(token(theme, fg), token(theme, bg));
        expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

// --color-border-light is a background too. It is the theme toggle's track
// and the hover state of settings rows, list rows and icon buttons. Only the
// neutral and accent text tokens are drawn on it; the status colours are not.
describe.each(THEMES)('AC1: text on the toggle track and row hover meets AA (%s)', (theme) => {
  for (const fg of ['--color-text', '--color-text-secondary', '--color-text-muted', '--color-primary-text']) {
    it(`${fg} on --color-border-light`, () => {
      expect(contrast(token(theme, fg), token(theme, '--color-border-light'))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe.each(THEMES)('AC1: the text hierarchy holds (%s)', (theme) => {
  it('muted < secondary < text, measured on the card', () => {
    const surface = token(theme, '--color-surface');
    const muted = contrast(token(theme, '--color-text-muted'), surface);
    const secondary = contrast(token(theme, '--color-text-secondary'), surface);
    const text = contrast(token(theme, '--color-text'), surface);
    expect(muted).toBeLessThan(secondary);
    expect(secondary).toBeLessThan(text);
  });
});

describe('AC2/AC3: no rule sets color: to a fill-only token', () => {
  const offenders = rules
    .filter(({ body }) => /(?:^|;|\s)color\s*:[^;]*var\(--color-(primary|danger)\)/.test(body))
    .map(({ selector }) => selector);

  it('--color-primary and --color-danger are never text colours', () => {
    expect(offenders).toEqual([]);
  });

  it('the brand fill itself is unchanged', () => {
    expect(token('light', '--color-primary')).toBe('#FF6B35');
    expect(token('dark', '--color-primary')).toBe('#FF6B35');
  });
});

describe('AC2: every rule with a hex text and a hex background meets AA', () => {
  const pairs = rules.flatMap(({ selector, body }) => {
    const color = decl(body, 'color');
    const background = decl(body, 'background(?:-color)?');
    return color && background && /^#[0-9a-fA-F]{6}$/.test(color) && /^#[0-9a-fA-F]{6}$/.test(background)
      ? [{ selector, color, background }]
      : [];
  });

  it('finds the badge, section and effort pairs', () => {
    // Guards the parser: if this drops, the loop below is testing nothing.
    expect(pairs.length).toBeGreaterThan(30);
  });

  it.each(pairs)('$selector ($color on $background)', ({ color, background }) => {
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AC2: label colours meet AA on their chip and on the card', () => {
  it.each(LABEL_COLORS)('$name', ({ light, dark }) => {
    expect(contrast(light.text, light.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.text, token('light', '--color-surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.text, dark.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.text, token('dark', '--color-surface'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AC4: placeholders use the muted token at full opacity', () => {
  const placeholder = rules.find(({ selector }) => selector === '::placeholder');

  it('has a global ::placeholder rule', () => {
    expect(placeholder).toBeDefined();
  });

  it('colours it --color-text-muted and undoes Firefox\'s dimming', () => {
    expect(decl(placeholder!.body, 'color')).toBe('var(--color-text-muted)');
    expect(decl(placeholder!.body, 'opacity')).toBe('1');
  });
});

describe('AC5: the active tab reads without colour', () => {
  const label = rules.find(({ selector }) => selector === '.bottom-nav-tab.active .bottom-nav-label');
  const tab = rules.find(({ selector }) => selector === '.bottom-nav-tab.active');

  it('bolds the active label', () => {
    expect(decl(label!.body, 'font-weight')).toBe('700');
  });

  it('marks the active tab with a bar', () => {
    expect(decl(tab!.body, 'box-shadow')).toMatch(/inset 0 2px 0 var\(--color-primary\)/);
  });
});
