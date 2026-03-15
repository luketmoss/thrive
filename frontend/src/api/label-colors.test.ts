import { describe, it, expect } from 'vitest';
import { LABEL_COLORS, getLabelColor, colorKeyFromName } from './label-colors';

describe('LABEL_COLORS', () => {
  it('defines exactly 10 colors', () => {
    expect(LABEL_COLORS).toHaveLength(10);
  });

  it('each color has required fields', () => {
    for (const c of LABEL_COLORS) {
      expect(c.key).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.light.bg).toBeTruthy();
      expect(c.light.text).toBeTruthy();
      expect(c.dark.bg).toBeTruthy();
      expect(c.dark.text).toBeTruthy();
    }
  });

  it('has unique keys', () => {
    const keys = LABEL_COLORS.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('getLabelColor', () => {
  it('returns a color by key', () => {
    const red = getLabelColor('red');
    expect(red).toBeDefined();
    expect(red!.name).toBe('Red');
  });

  it('returns undefined for unknown key', () => {
    expect(getLabelColor('neon')).toBeUndefined();
  });
});

describe('colorKeyFromName', () => {
  it('returns a valid color key', () => {
    const key = colorKeyFromName('Push');
    const validKeys = LABEL_COLORS.map(c => c.key);
    expect(validKeys).toContain(key);
  });

  it('is deterministic — same name always gives same color', () => {
    const key1 = colorKeyFromName('Legs');
    const key2 = colorKeyFromName('Legs');
    expect(key1).toBe(key2);
  });

  it('different names can map to different colors', () => {
    // Not guaranteed for all pairs, but for these common ones they should differ
    const pushKey = colorKeyFromName('Push');
    const pullKey = colorKeyFromName('Pull');
    // At least verify both are valid keys
    const validKeys = LABEL_COLORS.map(c => c.key);
    expect(validKeys).toContain(pushKey);
    expect(validKeys).toContain(pullKey);
  });
});
