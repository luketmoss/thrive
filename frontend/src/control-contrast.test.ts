// #183 — filled controls, unselected chips and text-field outlines meet WCAG
// AA in both themes. Text on a fill is 4.5:1 (1.4.3); a control's outline is
// 3:1 (1.4.11). Reads global.css directly so a hand-edit fails here, not in a
// screenshot. Text tokens are #182's (text-contrast.test.ts).

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

const rule = (selector: string) => {
  const r = rules.find((x) => x.selector === selector);
  if (!r) throw new Error(`No rule "${selector}"`);
  return r;
};

const FILLS = [
  '--color-primary-fill',
  '--color-primary-fill-hover',
  '--color-danger-fill',
  '--color-danger-fill-hover',
  '--color-success-fill',
];
const SURFACES = ['--color-bg', '--color-surface', '--color-surface-raised'];

describe.each(THEMES)('AC1: --color-on-fill meets 4.5:1 on every fill (%s)', (theme) => {
  it.each(FILLS)('on %s', (fill) => {
    const ratio = contrast(token(theme, '--color-on-fill'), token(theme, fill));
    expect(ratio, `${fill} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AC1: the intended pairing per theme', () => {
  it('light draws white on the darker fills, dark draws near-black on the bright ones', () => {
    expect(token('light', '--color-on-fill').toLowerCase()).toBe('#ffffff');
    expect(token('light', '--color-primary-fill').toLowerCase()).toBe('#d4400a');
    expect(token('light', '--color-primary-fill-hover').toLowerCase()).toBe('#b83508');
    expect(token('dark', '--color-on-fill')).toBe('#121212');
    expect(token('dark', '--color-primary-fill').toLowerCase()).toBe('#ff6b35');
  });

  it('the brand colour and the old hover tokens are untouched', () => {
    expect(token('light', '--color-primary')).toBe('#FF6B35');
    expect(token('dark', '--color-primary')).toBe('#FF6B35');
    expect(token('light', '--color-primary-hover')).toBe('#D4400A');
    expect(token('dark', '--color-primary-hover')).toBe('#FF9A76');
  });
});

describe('AC1: a rule filling with a fill token sets color: var(--color-on-fill)', () => {
  const filled = rules.filter(({ body }) =>
    /(?:^|;|\s)background(?:-color)?\s*:\s*var\(--color-(?:primary|danger|success)-fill(?:-hover)?\)/.test(body),
  );

  it('finds the filled controls', () => {
    // login, fab, toasts x2, btn-primary x2, btn-danger x2, settings danger x2,
    // tag filter, copy-down hover, five remove hovers.
    expect(filled.length).toBeGreaterThanOrEqual(19);
  });

  // A :hover rule that only swaps the fill inherits the colour from its base rule.
  it.each(filled.map((r) => [r.selector, r.body] as const))('%s', (selector, body) => {
    const color = decl(body, 'color');
    // .streak-dot.filled (#293) is a 10 px mark with no text at all.
    if (color === undefined) expect(selector).toMatch(/:hover|^\.streak-dot\.filled$/);
    else expect(color).toBe('var(--color-on-fill)');
  });

  it('no rule fills with a raw brand, danger or success token and sets white or page-coloured text', () => {
    const raw = rules
      .filter(({ body }) => /(?:^|;|\s)background(?:-color)?\s*:\s*var\(--color-(?:primary|danger|success)(?:-hover)?\)/.test(body))
      .filter(({ body }) => /#fff|--color-bg\)/.test(decl(body, 'color') ?? ''))
      .map(({ selector }) => selector);
    expect(raw).toEqual([]);
  });
});

describe.each(THEMES)('AC2/AC3: --color-border-strong meets 3:1 on every surface (%s)', (theme) => {
  it.each(SURFACES)('on %s', (surface) => {
    const ratio = contrast(token(theme, '--color-border-strong'), token(theme, surface));
    expect(ratio, `${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});

describe('AC2: unselected chips are full strength with the strong outline', () => {
  it('filter chips outline unselected in border-strong on the card', () => {
    const r = rule('.filter-chip:not(.active)');
    expect(decl(r.body, 'border-color')).toBe('var(--color-border-strong)');
    expect(decl(r.body, 'background')).toBe('var(--color-surface)');
  });

  it('label chips and "+ New Label" use the strong outline', () => {
    expect(decl(rule('.label-chip').body, 'border')).toContain('var(--color-border-strong)');
    expect(decl(rule('.label-chip').body, 'background')).toBe('var(--color-surface)');
    expect(rule('.label-chip-create').body).not.toMatch(/border-color/);
  });

  it('hover darkens the border instead of fading', () => {
    expect(decl(rule('.filter-chip:not(.active):hover').body, 'border-color')).toBe('var(--color-text-muted)');
    expect(decl(rule('.label-chip:hover').body, 'border-color')).toBe('var(--color-text-muted)');
  });

  it('type filter chips are 44px tall', () => {
    expect(decl(rule('.filter-chip').body, 'min-height')).toBe('44px');
  });
});

describe.each(THEMES)('AC2: unselected type chips read at 4.5:1 on the card (%s)', (theme) => {
  const sel = theme === 'dark' ? (t: string) => `[data-theme="dark"] .badge-${t}` : (t: string) => `.badge-${t}`;
  it.each(['weight', 'stretch', 'bike', 'hike', 'run', 'walk'])('%s', (type) => {
    const color = decl(rule(sel(type)).body, 'color')!;
    expect(contrast(color, token(theme, '--color-surface'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AC3: text fields use the strong outline and a primary-fill focus', () => {
  const field = rule('.form-input, .form-select, .form-textarea');
  const focus = rule('.form-input:focus, .form-select:focus, .form-textarea:focus');

  it('rests on --color-border-strong', () => {
    expect(decl(field.body, 'border')).toContain('var(--color-border-strong)');
  });

  it('focuses to --color-primary-fill, never fainter than the resting outline', () => {
    expect(decl(focus.body, 'border-color')).toBe('var(--color-primary-fill)');
    for (const theme of THEMES) {
      const f = token(theme, '--color-primary-fill');
      const rest = token(theme, '--color-border-strong');
      for (const s of SURFACES) {
        expect(contrast(f, token(theme, s))).toBeGreaterThanOrEqual(contrast(rest, token(theme, s)));
      }
    }
  });

  it('decorative dividers and card edges keep --color-border', () => {
    expect(decl(rule('.manage-label-row').body, 'border')).toContain('var(--color-border)');
  });
});

describe('AC4: nothing interactive is dimmed with opacity', () => {
  const ALLOWED = ['.section-picker-pill:hover'];
  const offenders = rules
    .filter(({ body }) => {
      const o = decl(body, 'opacity');
      return o !== undefined && parseFloat(o) < 1;
    })
    .map(({ selector }) => selector)
    // An aria-disabled control (#328) is disabled too; it only keeps focus.
    .filter((selector) => !/:disabled|\[aria-disabled="true"\]/.test(selector) &&!/^(from|to|\d+%)$/.test(selector) && !ALLOWED.includes(selector));

  it('only disabled controls and the allowlisted pill hover set opacity < 1', () => {
    expect(offenders).toEqual([]);
  });

  it('the dead tag suggestion and input rules are gone', () => {
    for (const dead of ['.tag-suggestion', '.tag-suggestions', '.tag-badge-removable', '.tag-badge-remove', '.tag-input-wrapper', '.tag-input-field']) {
      expect(rules.some(({ selector }) => selector.startsWith(dead))).toBe(false);
    }
  });
});

// ── #293 segmented switches and the week streak ─────────────────────────────

describe.each(THEMES)('#293 AC1: the selected pill of the theme toggle and Library switch (%s)', (theme) => {
  const track = token(theme, '--color-border-light');
  const fill = token(theme, '--color-primary-fill');
  it('the fill is 3:1 on the track and the label 4.5:1 on the fill', () => {
    expect(contrast(fill, track)).toBeGreaterThanOrEqual(3);
    expect(contrast(token(theme, '--color-on-fill'), fill)).toBeGreaterThanOrEqual(4.5);
  });
  it('unselected labels stay 4.5:1 on the track', () => {
    expect(contrast(token(theme, '--color-text-muted'), track)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('#293 AC1: the pill rules', () => {
  it.each(['.theme-toggle-btn.active', '.library-switch-btn.active'])('%s fills with the fill token, no surface or shadow', (sel) => {
    const { body } = rule(sel);
    expect(decl(body, 'background')).toBe('var(--color-primary-fill)');
    expect(decl(body, 'color')).toBe('var(--color-on-fill)');
    expect(body).not.toMatch(/box-shadow|--color-surface/);
  });
  it('the track, the Library label weight and the 44 px segments are unchanged', () => {
    expect(decl(rule('.theme-toggle').body, 'background')).toBe('var(--color-border-light)');
    expect(decl(rule('.library-switch').body, 'background')).toBe('var(--color-border-light)');
    expect(decl(rule('.library-switch-btn.active').body, 'font-weight')).toBe('700');
    expect(decl(rule('.library-switch-btn').body, 'min-height')).toBe('44px');
    expect(decl(rule('.library-switch-btn').body, 'color')).toBe('var(--color-text-muted)');
  });
});

describe.each(THEMES)('#293 AC3: segment borders (%s)', (theme) => {
  it('--color-border-strong is 3:1 on the card, page and raised surfaces', () => {
    for (const s of SURFACES) {
      expect(contrast(token(theme, '--color-border-strong'), token(theme, s))).toBeGreaterThanOrEqual(3);
    }
  });
  it('the selected sub-type border (primary-fill) is 3:1 on the card', () => {
    expect(contrast(token(theme, '--color-primary-fill'), token(theme, '--color-surface'))).toBeGreaterThanOrEqual(3);
  });
});

describe('#293 AC3: segmented button rules', () => {
  it('unselected sub-type and effort buttons use --color-border-strong', () => {
    expect(decl(rule('.sub-type-toggle .sub-type-btn').body, 'border')).toContain('var(--color-border-strong)');
    expect(decl(rule('.effort-btn').body, 'border')).toContain('var(--color-border-strong)');
  });
  it('hover still darkens to --color-text-muted', () => {
    expect(decl(rule('.effort-btn:hover').body, 'border-color')).toBe('var(--color-text-muted)');
  });
  it('a selected sub-type button borders in --color-primary-fill and keeps its ring', () => {
    const r = rule('.sub-type-toggle .sub-type-btn.active');
    expect(decl(r.body, 'border-color')).toBe('var(--color-primary-fill)');
    const shared = rule('.effort-toggle-session .effort-btn.active, .sub-type-toggle .sub-type-btn.active');
    expect(decl(shared.body, 'font-weight')).toBe('700');
    expect(decl(shared.body, 'box-shadow')).toBe('inset 0 0 0 1px currentColor');
  });
  it('the 44 px / 28 px sizes are untouched', () => {
    expect(decl(rule('.effort-btn').body, 'height')).toBe('28px');
    expect(decl(rule('.effort-toggle-session .effort-btn, .sub-type-toggle .sub-type-btn').body, 'min-height')).toBe('44px');
  });
});

describe.each(THEMES)('#293 AC4: week streak dots on the page (%s)', (theme) => {
  const bg = token(theme, '--color-bg');
  it('the solid fill and the hollow outline are each 3:1', () => {
    expect(contrast(token(theme, '--color-primary-fill'), bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(token(theme, '--color-border-strong'), bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('#293 AC4: streak dot rules', () => {
  it('empty is hollow with an inset strong outline', () => {
    const r = rule('.streak-dot');
    expect(decl(r.body, 'background')).toBe('transparent');
    expect(decl(r.body, 'box-shadow')).toBe('inset 0 0 0 2px var(--color-border-strong)');
    expect(decl(r.body, 'height')).toBe('10px');
  });
  it('filled is solid primary-fill', () => {
    expect(decl(rule('.streak-dot.filled').body, 'background')).toBe('var(--color-primary-fill)');
    expect(decl(rule('.streak-dot.filled').body, 'box-shadow')).toBe('none');
  });
  it('today, empty, is a primary-fill inset outline with no outer ring; today, filled, is just the fill', () => {
    expect(decl(rule('.streak-dot.today').body, 'box-shadow')).toBe('inset 0 0 0 2px var(--color-primary-fill)');
    expect(decl(rule('.streak-dot.today.filled').body, 'box-shadow')).toBe('none');
  });
  it('no switch, segment or dot rule has gone back to the old tokens', () => {
    const sels = ['.theme-toggle-btn.active', '.library-switch-btn.active', '.streak-dot', '.streak-dot.filled', '.streak-dot.today'];
    for (const s of sels) expect(rule(s).body).not.toMatch(/var\(--color-(?:surface|border|primary)\)/);
  });
  it('--color-primary stays the brand colour', () => {
    expect(token('light', '--color-primary')).toBe('#FF6B35');
    expect(token('dark', '--color-primary')).toBe('#FF6B35');
  });
});
