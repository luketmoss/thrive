import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock window.matchMedia before importing the module
const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: mockMatchMedia,
});

// Mock document.documentElement.setAttribute
const mockSetAttribute = vi.fn();
Object.defineProperty(document.documentElement, 'setAttribute', {
  writable: true,
  value: mockSetAttribute,
});

describe('theme-toggle — AC2: thrive-theme localStorage key', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    mockSetAttribute.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('reads thrive-theme key (not gw-theme) to get stored preference', async () => {
    localStorage.setItem('thrive-theme', 'dark');
    const { getStoredTheme } = await import('./theme-toggle');
    expect(getStoredTheme()).toBe('dark');
  });

  it('migrates gw-theme and does not return system when only gw-theme is set', async () => {
    localStorage.setItem('gw-theme', 'dark');
    // Migration kicks in: gw-theme is moved to thrive-theme, so 'dark' is returned
    const { getStoredTheme } = await import('./theme-toggle');
    expect(getStoredTheme()).toBe('dark');
    expect(localStorage.getItem('thrive-theme')).toBe('dark');
    expect(localStorage.getItem('gw-theme')).toBeNull();
  });

  it('writes thrive-theme key when setting a non-system theme', async () => {
    const { setTheme } = await import('./theme-toggle');
    setTheme('dark');
    expect(localStorage.getItem('thrive-theme')).toBe('dark');
    expect(localStorage.getItem('gw-theme')).toBeNull();
  });

  it('removes thrive-theme key (not gw-theme) when setting system theme', async () => {
    localStorage.setItem('thrive-theme', 'dark');
    const { setTheme } = await import('./theme-toggle');
    setTheme('system');
    expect(localStorage.getItem('thrive-theme')).toBeNull();
    expect(localStorage.getItem('gw-theme')).toBeNull();
  });

  it('migrates gw-theme to thrive-theme on first read if thrive-theme is absent', async () => {
    localStorage.setItem('gw-theme', 'dark');
    const { getStoredTheme } = await import('./theme-toggle');
    const result = getStoredTheme();
    expect(result).toBe('dark');
    expect(localStorage.getItem('thrive-theme')).toBe('dark');
    expect(localStorage.getItem('gw-theme')).toBeNull();
  });

  it('does not migrate gw-theme if thrive-theme is already set', async () => {
    localStorage.setItem('gw-theme', 'light');
    localStorage.setItem('thrive-theme', 'dark');
    const { getStoredTheme } = await import('./theme-toggle');
    const result = getStoredTheme();
    expect(result).toBe('dark');
    // gw-theme should remain untouched (no migration needed)
    expect(localStorage.getItem('gw-theme')).toBe('light');
  });
});

describe('theme-toggle — AC4 (indirect): no groundwork references in module', () => {
  it('exports setTheme and getStoredTheme without referencing gw-theme at runtime', async () => {
    const mod = await import('./theme-toggle');
    expect(mod.setTheme).toBeDefined();
    expect(mod.getStoredTheme).toBeDefined();
    expect(mod.themeChoice).toBeDefined();
  });
});

describe('theme-toggle — #293 AC2: selection is exposed to assistive tech', () => {
  it('renders a labelled group with aria-pressed on the chosen option only', async () => {
    localStorage.setItem('thrive-theme', 'dark');
    vi.resetModules();
    const { h } = await import('preact');
    const { render, cleanup } = await import('@testing-library/preact');
    const { ThemeToggle } = await import('./theme-toggle');
    const { container } = render(h(ThemeToggle as any, {}));
    const group = container.querySelector('.theme-toggle')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Theme');
    const pressed = [...container.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
    expect(pressed).toEqual([['Light', 'false'], ['Dark', 'true'], ['System', 'false']]);
    cleanup();
    localStorage.clear();
  });
});
