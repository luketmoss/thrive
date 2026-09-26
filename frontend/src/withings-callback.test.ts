// #196 AC1 — the Withings OAuth callback page (public/withings-callback.html).
// It is a standalone static file outside the SPA, so this loads its markup into
// the jsdom document and runs its inline script against a given address.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../public/withings-callback.html'), 'utf-8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
const bodyMarkup = html.match(/<body>([\s\S]*?)<script>/)![1];

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function load(search: string) {
  window.history.replaceState(null, '', `/thrive/withings-callback.html${search}`);
  document.body.innerHTML = bodyMarkup;
  new Function(script)();
  return {
    field: document.getElementById('response') as HTMLTextAreaElement,
    button: document.getElementById('copy') as HTMLButtonElement,
    status: document.getElementById('status') as HTMLElement,
    ok: document.getElementById('ok') as HTMLElement,
    failed: document.getElementById('failed') as HTMLElement,
    error: document.getElementById('error') as HTMLElement,
  };
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as unknown as Record<string, unknown>).clipboard;
});

describe('withings-callback.html with a code', () => {
  const search = '?code=abc123def456abc123def456abc123def456abc123&state=0f1e2d3c4b5a';

  it('shows the whole query string in a labelled read-only field', () => {
    const { field, ok, failed } = load(search);
    expect(ok.hidden).toBe(false);
    expect(failed.hidden).toBe(true);
    expect(field.value).toBe(search.slice(1));
    expect(field.readOnly).toBe(true);
    const label = document.querySelector('label[for="response"]');
    expect(label?.textContent).toBe('Authorization response');
  });

  it('focuses the Copy button on load, next to the 30-second instruction', () => {
    const { button } = load(search);
    expect(button.textContent).toBe('Copy');
    expect(document.activeElement).toBe(button);
    expect(button.parentElement?.textContent).toContain('Paste this into the terminal within 30 seconds');
  });

  it('copies through navigator.clipboard and announces "Copied" politely', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { button, status, field } = load(search);
    button.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(field.value);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Copied');
  });

  it('selects the text instead when the clipboard is refused', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    const { button, status, field } = load(search);
    button.click();
    await flush();
    expect(status.textContent).toBe('Selected: press Ctrl+C / ⌘C');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('selects the text instead when there is no clipboard API', async () => {
    setClipboard(undefined);
    const { button, status, field } = load(search);
    button.click();
    await flush();
    expect(status.textContent).toBe('Selected: press Ctrl+C / ⌘C');
    expect(field.selectionEnd).toBe(field.value.length);
  });
});

describe('withings-callback.html without a code', () => {
  it('shows the error Withings sent', () => {
    const { ok, failed, error } = load('?error=access_denied&state=x');
    expect(ok.hidden).toBe(true);
    expect(failed.hidden).toBe(false);
    expect(error.textContent).toContain('access_denied');
  });

  it('never renders the error as markup', () => {
    const { error } = load('?error=%3Cimg%20src%3Dx%3E');
    expect(error.querySelector('img')).toBeNull();
    expect(error.textContent).toContain('<img src=x>');
  });

  it('says there is no code when the address has none', () => {
    const { ok, error } = load('');
    expect(ok.hidden).toBe(true);
    expect(error.textContent).toBe('No authorization code in this address');
  });
});

describe('withings-callback.html makes no network request', () => {
  it('sets no-referrer and has the right title', () => {
    expect(html).toMatch(/<meta name="referrer" content="no-referrer">/);
    expect(html).toMatch(/<title>Thrive: Withings sign-in<\/title>/);
  });

  it('loads nothing from elsewhere, and asks for no favicon', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/@import|url\(/i);
    const links = [...html.matchAll(/<link[^>]*>/gi)].map((m) => m[0]);
    expect(links).toEqual(['<link rel="icon" href="data:,">']);
    expect(html).not.toMatch(/<img|<iframe|<object|<embed/i);
    expect(script).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|new Image/);
  });
});

// --- layout and contrast, read from the inline CSS --------------------------

function rule(selector: string): string {
  const m = style.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

function tokens(theme: 'light' | 'dark'): Record<string, string> {
  const block = theme === 'light'
    ? style.match(/:root\s*\{([^}]*)\}/)![1]
    : style.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)![1];
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
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

describe('withings-callback.html layout', () => {
  it('wraps the long token inside the field', () => {
    expect(rule('textarea')).toMatch(/word-break:\s*break-all/);
    expect(rule('textarea')).toMatch(/width:\s*100%/);
  });

  it('gives the Copy button a 44 by 44 px target', () => {
    expect(rule('button')).toMatch(/min-width:\s*44px/);
    expect(rule('button')).toMatch(/min-height:\s*44px/);
  });

  // Text colour on the background it is drawn on.
  const pairs: [string, string][] = [
    ['--text', '--surface'],
    ['--muted', '--surface'],
    ['--text', '--bg'],
    ['--accent-text', '--accent'],
    ['--error-text', '--error-bg'],
  ];
  for (const theme of ['light', 'dark'] as const) {
    for (const [fg, bg] of pairs) {
      it(`${theme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        const t = tokens(theme);
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
