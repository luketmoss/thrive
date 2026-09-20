// Issue #129 AC2/AC3 — the venue control's option map and labelling. The
// rendered contract (role, aria-pressed, 44px, clear-to-unset) is asserted in
// sub-type-toggle-render.test.ts.

import { describe, it, expect } from 'vitest';
import { subTypeOptions, subTypeLabel, SUB_TYPE_OPTIONS } from './sub-type-toggle';

describe('AC2: options are terrain-appropriate', () => {
  it('offers Mountain, Gravel and Indoor for a bike', () => {
    expect(subTypeOptions('bike')).toEqual(['mountain', 'gravel', 'indoor']);
  });

  it('offers Outdoor and Indoor for a run and a walk', () => {
    expect(subTypeOptions('run')).toEqual(['outdoor', 'indoor']);
    expect(subTypeOptions('walk')).toEqual(['outdoor', 'indoor']);
  });

  it('offers nothing for weight, stretch and hike', () => {
    for (const t of ['weight', 'stretch', 'hike'] as const) {
      expect(subTypeOptions(t), t).toEqual([]);
    }
  });

  it('stores lowercase and displays words', () => {
    expect(subTypeLabel('mountain')).toBe('Mountain');
    expect(subTypeLabel('indoor')).toBe('Indoor');
    // A value that arrived from the sync rather than this map still labels.
    expect(subTypeLabel('road')).toBe('Road');
    expect(subTypeLabel('')).toBe('');
  });

  it('keeps every offered value lowercase, matching the column', () => {
    for (const options of Object.values(SUB_TYPE_OPTIONS)) {
      for (const o of options ?? []) expect(o).toBe(o.toLowerCase());
    }
  });
});
