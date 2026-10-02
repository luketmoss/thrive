// #301 — template cards are real buttons: tab stops, named, opened by key or click.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { templates } from '../../state/store';
import { currentRoute, navigate } from '../../router/router';
import { TemplatesScreen } from './templates-screen';

function tpl(id: string, name: string, sections: string[]) {
  return {
    id,
    name,
    exercises: sections.map((section, i) => ({
      exercise_id: `e${i}`, exercise_name: `Ex ${i}`, section, sets: '3', reps: '8', order: i + 1, sheetRow: i + 2,
    })),
    sheetRow: 2,
  };
}

beforeEach(async () => {
  navigate('/templates');
  await waitFor(() => expect(currentRoute.value.name).toBe('templates'));
  templates.value = [tpl('t1', 'Push Day', ['primary', 'SS1']), tpl('t2', 'Solo', ['primary'])] as never;
});
afterEach(() => cleanup());

const cards = () => [...document.querySelectorAll<HTMLElement>('.template-card')];

describe('AC1: a template card is a button', () => {
  it('is a <button type=button> keeping its focus key, with no block child', () => {
    render(<TemplatesScreen />);
    expect(cards()).toHaveLength(2);
    for (const c of cards()) {
      expect(c.tagName).toBe('BUTTON');
      expect(c.getAttribute('type')).toBe('button');
      expect(c.tabIndex).toBe(0);
      expect(c.querySelector('div, button, a, input')).toBeNull();
    }
    expect(cards()[0].getAttribute('data-focus-key')).toBe('template:t1');
    expect(cards()[1].getAttribute('data-focus-key')).toBe('template:t2');
  });

  it('comes after the Library switch and before the + button in tab order', () => {
    render(<TemplatesScreen />);
    const focusables = [...document.querySelectorAll<HTMLElement>('button, a[href]')];
    const fab = document.querySelector<HTMLElement>('.fab')!;
    expect(focusables.indexOf(cards()[0])).toBeLessThan(focusables.indexOf(fab));
    const sw = document.querySelector<HTMLElement>('[data-focus-key^="library-switch"]');
    if (sw) expect(focusables.indexOf(sw)).toBeLessThan(focusables.indexOf(cards()[0]));
  });
});

describe('AC2: activation', () => {
  it('a click opens the template', async () => {
    render(<TemplatesScreen />);
    fireEvent.click(cards()[0]);
    await waitFor(() => expect(currentRoute.value.name).toBe('template-detail'));
    expect((currentRoute.value.params as { id: string }).id).toBe('t1');
  });
});

describe('AC3: accessible name', () => {
  it('starts with the name and carries the pluralised count', () => {
    render(<TemplatesScreen />);
    expect(cards()[0].textContent).toMatch(/^Push Day/);
    expect(cards()[0].textContent).toContain('2 exercises');
    expect(cards()[1].textContent).toContain('1 exercise');
    expect(cards()[1].textContent).not.toContain('1 exercises');
  });
});

describe('AC3/AC5: focus ring CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../global.css'), 'utf-8').replace(/\r\n/g, '\n');
  const section = css.slice(css.indexOf('/* ===== Library keyboard access (#301)'));
  const bare = section.replace(/\/\*[\s\S]*?\*\//g, '');

  it('uses --color-text, inset, never --color-primary', () => {
    const rule = bare.match(/\.template-card:focus-visible,\n\.compact-card-body\[role="button"\]:focus-visible \{([^}]*)\}/)![1];
    expect(rule).toMatch(/outline:\s*2px solid var\(--color-text\)/);
    expect(rule).toMatch(/outline-offset:\s*-2px/);
    expect(bare).not.toMatch(/--color-primary/);
  });

  it('keeps targets at 44px and resets the button', () => {
    expect(bare).toMatch(/\.template-card \{[^}]*min-height:\s*44px/);
    expect(bare).toMatch(/\.compact-card-body\[role="button"\] \{[^}]*min-height:\s*44px/);
    expect(bare).toMatch(/\.template-card \{[^}]*width:\s*100%/);
    expect(bare).toMatch(/\.template-card \{[^}]*appearance:\s*none/);
  });
});
