import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const css = readFileSync(resolve(__dirname, 'global.css'), 'utf-8');

// Helper: extract value of a CSS custom property from a named block
function tokenValue(block: string, token: string): string | null {
  const re = new RegExp(`${token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}\\s*:\\s*([^;]+);`);
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

const rootBlock = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';
const lightBlock = css.match(/\[data-theme="light"\]\s*\{([^}]+)\}/)?.[1] ?? '';
const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] ?? '';
const loginCardH1Block = css.match(/\.login-card h1\s*\{([^}]+)\}/)?.[1] ?? '';
const loginCardBlock = css.match(/\.login-card\s*\{([^}]+)\}/)?.[1] ?? '';

describe('AC1: border radius tokens', () => {
  it('--radius-sm is 4px', () => {
    expect(tokenValue(rootBlock, '--radius-sm')).toBe('4px');
  });
  it('--radius-md is 8px', () => {
    expect(tokenValue(rootBlock, '--radius-md')).toBe('8px');
  });
  it('--radius alias is 8px', () => {
    expect(tokenValue(rootBlock, '--radius')).toBe('8px');
  });
  it('--radius-lg remains 16px', () => {
    expect(tokenValue(rootBlock, '--radius-lg')).toBe('16px');
  });
  it('--radius-full remains 9999px', () => {
    expect(tokenValue(rootBlock, '--radius-full')).toBe('9999px');
  });
});

describe('AC2: background and border-light tokens (light mode)', () => {
  it('--color-bg is #f0f2f5', () => {
    expect(tokenValue(lightBlock, '--color-bg')).toBe('#f0f2f5');
  });
  it('--color-border-light is #e4e8ec', () => {
    expect(tokenValue(lightBlock, '--color-border-light')).toBe('#e4e8ec');
  });
});

describe('AC3: overlay tokens defined in both themes', () => {
  const overlayTokens = [
    '--overlay-xs',
    '--overlay-sm',
    '--overlay-md',
    '--overlay-lg',
    '--overlay-xl',
    '--overlay-2xl',
    '--overlay-3xl',
    '--overlay-4xl',
  ];
  const lightAlphas = ['0.04', '0.08', '0.12', '0.16', '0.24', '0.32', '0.40', '0.60'];

  overlayTokens.forEach((token, i) => {
    it(`light: ${token} = rgba(0,0,0,${lightAlphas[i]})`, () => {
      const val = tokenValue(lightBlock, token);
      expect(val).not.toBeNull();
      expect(val).toMatch(new RegExp(`rgba\\(0,\\s*0,\\s*0,\\s*${lightAlphas[i]}\\)`));
    });
  });

  it('dark: --overlay-xs through --overlay-3xl use rgba(255,255,255,...)', () => {
    ['--overlay-xs', '--overlay-sm', '--overlay-md', '--overlay-lg', '--overlay-xl', '--overlay-2xl', '--overlay-3xl'].forEach((token) => {
      const val = tokenValue(darkBlock, token);
      expect(val).not.toBeNull();
      expect(val).toMatch(/rgba\(255,\s*255,\s*255,/);
    });
  });

  it('dark: --overlay-4xl uses rgba(0,0,0,0.60)', () => {
    const val = tokenValue(darkBlock, '--overlay-4xl');
    expect(val).not.toBeNull();
    expect(val).toMatch(/rgba\(0,\s*0,\s*0,\s*0\.60\)/);
  });

  it('--color-overlay is retained in light theme', () => {
    expect(tokenValue(lightBlock, '--color-overlay')).not.toBeNull();
  });
});

describe('AC4: composite shadow tokens', () => {
  it('--shadow is defined in :root', () => {
    expect(tokenValue(rootBlock, '--shadow')).not.toBeNull();
  });
  it('--shadow-lg is defined in :root', () => {
    expect(tokenValue(rootBlock, '--shadow-lg')).not.toBeNull();
  });
  it('--shadow-strong is defined in :root', () => {
    expect(tokenValue(rootBlock, '--shadow-strong')).not.toBeNull();
  });
  it('--color-shadow is retained in light theme', () => {
    expect(tokenValue(lightBlock, '--color-shadow')).not.toBeNull();
  });
  it('--color-shadow-strong is retained in light theme', () => {
    expect(tokenValue(lightBlock, '--color-shadow-strong')).not.toBeNull();
  });
  it('--shadow has correct value', () => {
    const val = tokenValue(rootBlock, '--shadow');
    expect(val).toContain('0 1px 3px rgba(0,0,0,0.15)');
    expect(val).toContain('0 1px 2px rgba(0,0,0,0.05)');
  });
  it('--shadow-lg has correct value', () => {
    expect(tokenValue(rootBlock, '--shadow-lg')).toBe('0 4px 12px rgba(0,0,0,0.15)');
  });
  it('--shadow-strong has correct value', () => {
    expect(tokenValue(rootBlock, '--shadow-strong')).toBe('0 4px 24px rgba(0,0,0,0.15)');
  });
});

describe('AC5: login title uses var(--color-text)', () => {
  it('.login-card h1 color is var(--color-text)', () => {
    expect(tokenValue(loginCardH1Block, 'color')).toBe('var(--color-text)');
  });
});

describe('AC6: login card max-width is 400px', () => {
  it('.login-card max-width is 400px', () => {
    expect(tokenValue(loginCardBlock, 'max-width')).toBe('400px');
  });
});
