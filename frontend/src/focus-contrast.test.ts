// #320 — every keyboard focus ring drawn by global.css is 2px+ and at least 3:1
// (WCAG 1.4.11 / 2.4.11) against every surface it can sit on, in both themes.
// --color-primary is 2.53:1 on the light page, so it is never a ring colour.
// Reads global.css directly, as control-contrast.test.ts does.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim().replace(/\s+/g, ' '),
  body: m[2],
}));

const decl = (body: string, prop: string) =>
  body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`))?.[1].trim();

// One entry per selector in a list, so `.a:focus-visible, .b:focus-visible` is two rings.
// A :focus-visible inside :not(...) suppresses a ring, it does not draw one.
const entries = rules.flatMap((r) =>
  r.selector
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.replace(/:not\([^)]*\)/g, '').includes(':focus-visible'))
    .map((selector) => ({ selector, body: r.body })),
);
const rings = entries.filter((e) => decl(e.body, 'outline') !== undefined);
const ringOf = (selector: string) => {
  const r = rings.find((e) => e.selector === selector);
  if (!r) throw new Error(`No focus ring rule "${selector}"`);
  return r;
};

// The rings of the #320 audit table, the four #319 added, and #260's.
const AUDITED = [
  '.workout-card:focus-visible',
  '.trend-table-wrap:focus-visible',
  '.trends-group-scroll:focus-visible',
  '.trend-row-link:focus-visible',
  '.trend-charts:focus-visible',
  '.template-card:focus-visible',
  '.compact-card-body[role="button"]:focus-visible',
  '.day-screen :focus-visible',
  '.calendar-screen :focus-visible',
  // #319: the exercise picker.
  '.exercise-list > .exercise-list-item:focus-visible',
  '.create-new-row:focus-visible',
  '.modal-content .tag-filter-row .tag-badge:focus-visible',
  '.modal-close:focus-visible',
  // #260: the detail screen's "View on COROS" link, --color-text at +2px.
  '.detail-coros-link:focus-visible',
];

// A ring exempt from the 3:1 check. Adding one needs a written reason. Empty on purpose.
const EXEMPT: Record<string, string> = {};

// Rules that set outline none/0, each with why. A new suppression must be added
// here with a reason, so it cannot go unreviewed.
const SUPPRESSIONS: Record<string, string> = {
  '.form-input:focus, .form-select:focus, .form-textarea:focus':
    'replaced by a --color-primary-fill border and halo (#183 AC3)',
  '.day-panel-title:focus:not(:focus-visible)': 'mouse focus only; keyboard keeps the .day-screen ring',
  '.panel-status:focus': 'programmatic focus of a non-control (#256)',
  '.trends-state:focus': 'programmatic focus of a non-control, held through Try again (#290)',
  '.app-content:focus, [data-route-focus]:focus': 'programmatic focus of a non-control (#256)',
};

const SURFACES = [
  '--color-bg',
  '--color-surface',
  '--color-surface-raised',
  '--color-primary-light',
  '--cal-shade-1',
  '--cal-shade-2',
  '--cal-shade-3',
  '--cal-shade-4',
];

describe('AC4: the audited focus rings are all found', () => {
  it.each(AUDITED)('%s', (selector) => {
    expect(ringOf(selector)).toBeTruthy();
  });

  it('draws no ring outside the audit table without it being added here', () => {
    expect(rings.map((r) => r.selector).sort()).toEqual([...AUDITED].sort());
  });

  it('the exempt list is empty; adding to it needs a written reason', () => {
    expect(Object.keys(EXEMPT)).toEqual([]);
  });
});

describe.each(THEMES)('AC4: every focus ring is 2px and 3:1 on every surface (%s)', (theme) => {
  it.each(rings.filter((r) => !(r.selector in EXEMPT)).map((r) => [r.selector, r.body]))(
    '%s',
    (selector, body) => {
      const outline = decl(body, 'outline')!;
      const m = outline.match(/^(\d+(?:\.\d+)?)px solid var\((--[\w-]+)\)$/);
      expect(m, `${selector}: outline "${outline}" must be Npx solid var(--token)`).not.toBeNull();
      expect(Number(m![1]), `${selector} width`).toBeGreaterThanOrEqual(2);
      const colour = token(theme, m![2]);
      for (const surface of SURFACES) {
        const ratio = contrast(colour, token(theme, surface));
        expect(ratio, `${selector}: ${m![2]} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    },
  );
});

describe('AC4: every outline suppression is named', () => {
  it('lists each rule that sets outline none or 0, with its reason', () => {
    const found = rules
      .filter((r) => /^(none|0(px)?\b|transparent)/.test(decl(r.body, 'outline') ?? ''))
      .map((r) => r.selector)
      .sort();
    expect(found).toEqual(Object.keys(SUPPRESSIONS).sort());
    for (const reason of Object.values(SUPPRESSIONS)) expect(reason.length).toBeGreaterThan(10);
  });
});

describe('AC3/AC4: the cascade keeps Day Training cards on the Day ring', () => {
  // Position of the first rule whose selector LIST contains the selector, so a
  // selector merged into a longer list (the #301 rule) is still found, and
  // found where it now sits.
  const position = (selector: string) =>
    rules.findIndex((r) =>
      r.selector
        .split(',')
        .map((s) => s.trim())
        .includes(selector),
    );

  it('.day-screen :focus-visible comes after .workout-card:focus-visible', () => {
    const workoutCard = position('.workout-card:focus-visible');
    const day = position('.day-screen :focus-visible');
    expect(workoutCard, '.workout-card:focus-visible rule not found').toBeGreaterThanOrEqual(0);
    expect(day, '.day-screen :focus-visible rule not found').toBeGreaterThanOrEqual(0);
    expect(day).toBeGreaterThan(workoutCard);
  });

  it('the Day and Calendar rings stay --color-primary-text at +2px', () => {
    for (const s of ['.day-screen :focus-visible', '.calendar-screen :focus-visible']) {
      const body = ringOf(s).body;
      expect(decl(body, 'outline')).toBe('2px solid var(--color-primary-text)');
      expect(decl(body, 'outline-offset')).toBe('2px');
    }
  });

  it('the Activities card is inset and the Trends rings keep their offsets', () => {
    expect(decl(ringOf('.workout-card:focus-visible').body, 'outline-offset')).toBe('-2px');
    expect(decl(ringOf('.trend-table-wrap:focus-visible').body, 'outline-offset')).toBe('2px');
    expect(decl(ringOf('.trends-group-scroll:focus-visible').body, 'outline-offset')).toBe('2px');
    expect(decl(ringOf('.trend-row-link:focus-visible').body, 'outline-offset')).toBe('-2px');
  });
});

describe('#319 AC5: the exercise picker rings', () => {
  it('insets the flush rows and puts the chip and Close rings outside', () => {
    for (const s of ['.exercise-list > .exercise-list-item:focus-visible', '.create-new-row:focus-visible']) {
      expect(decl(ringOf(s).body, 'outline')).toBe('2px solid var(--color-text)');
      expect(decl(ringOf(s).body, 'outline-offset')).toBe('-2px');
    }
    for (const s of ['.modal-content .tag-filter-row .tag-badge:focus-visible', '.modal-close:focus-visible']) {
      expect(decl(ringOf(s).body, 'outline')).toBe('2px solid var(--color-text)');
      expect(decl(ringOf(s).body, 'outline-offset')).toBe('2px');
    }
  });

  it('leaves the shared chip row unringed outside the modal', () => {
    expect(rings.some((r) => r.selector.startsWith('.tag-filter-row'))).toBe(false);
  });
});
