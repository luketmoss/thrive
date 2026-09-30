// #237 AC2–AC5 — the Day screen's CSS carries the UX audit's contrast fixes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, '../../global.css'), 'utf-8').replace(/\r\n/g, '\n');
const section = raw.slice(raw.indexOf('/* ===== Day screen (#237)'));
const css = section.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Day screen CSS (#237)', () => {
  it('marks the viewed day with a --color-primary-text border on the tint, never white on primary', () => {
    expect(rule('.week-day-viewed')).toMatch(/background:\s*var\(--color-primary-light\)/);
    expect(rule('.week-day-viewed')).toMatch(/border-color:\s*var\(--color-primary-text\)/);
    expect(rule('.week-day')).toMatch(/border:\s*2px solid transparent/);
    expect(rule('.week-day-viewed .week-day-num')).toMatch(/color:\s*var\(--color-primary-on-light\)/);
    expect(section).not.toMatch(/var\(--color-primary\)/);
    expect(section).not.toMatch(/#fff\b/i);
  });

  it('marks today with an underlined, bold number in --color-primary-text', () => {
    const r = rule('.week-day-today .week-day-num');
    expect(r).toMatch(/color:\s*var\(--color-primary-text\)/);
    expect(r).toMatch(/font-weight:\s*700/);
    expect(r).toMatch(/text-decoration-thickness:\s*2px/);
  });

  it('keeps strip days 44 px tall and edge to edge below 375 px', () => {
    expect(rule('.week-day')).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/@media \(max-width: 374px\)\s*\{\s*\.week-strip\s*\{[^}]*gap:\s*0/);
  });

  it('gives every control a 2 px --color-primary-text focus outline', () => {
    const r = rule('.day-screen :focus-visible');
    expect(r).toMatch(/outline:\s*2px solid var\(--color-primary-text\)/);
    expect(r).toMatch(/outline-offset:\s*2px/);
  });

  it('pads the screen clear of the FAB and leaves vertical scrolling alone', () => {
    expect(rule('.day-screen')).toMatch(/padding-bottom:\s*calc\(56px/);
    expect(rule('.day-screen')).toMatch(/touch-action:\s*pan-y/);
    expect(rule('.week-strip')).toMatch(/touch-action:\s*pan-y/);
  });

  it('draws panels on the surface with the agreed title and note styles', () => {
    expect(rule('.day-panel')).toMatch(/background:\s*var\(--color-surface\)/);
    expect(rule('.day-panel')).toMatch(/border:\s*1px solid var\(--color-border\)/);
    expect(rule('.day-panel')).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(rule('.day-panel-title')).toMatch(/text-transform:\s*uppercase/);
    expect(rule('.day-panel-title')).toMatch(/color:\s*var\(--color-text-secondary\)/);
    expect(rule('.panel-note')).toMatch(/color:\s*var\(--color-text-muted\)/);
  });

  it('uses the pill pairs, and nowrap sun items', () => {
    expect(rule('.day-pill')).toMatch(/background:\s*var\(--color-border-light\)/);
    expect(rule('.day-pill-today')).toMatch(/color:\s*var\(--color-primary-on-light\)/);
    expect(rule('.day-today-btn')).toMatch(/min-height:\s*44px/);
    expect(rule('.day-arrow')).toMatch(/width:\s*44px/);
    expect(rule('.day-sun > span')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.day-title')).toMatch(/font-size:\s*var\(--text-2xl\)/);
  });
});
