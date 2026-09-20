// Issue #129 — cardio field visibility is a function of (type, sub_type),
// with one rule layered on top: a field that already holds a value is never
// hidden. The two together are what make switching venue safe.

import { describe, it, expect } from 'vitest';
import {
  cardioFieldsFor,
  hasCardioFields,
  visibleCardioFields,
} from './cardio-fields';
import type { CardioValues } from './cardio-fields';

const EMPTY: CardioValues = { distance: '', ascent: '', descent: '', avgHr: '' };
const values = (o: Partial<CardioValues> = {}): CardioValues => ({ ...EMPTY, ...o });

describe('AC1/AC4: which fields a (type, sub_type) pair earns', () => {
  it('gives every distance sport the cardio fieldset', () => {
    for (const t of ['bike', 'hike', 'run', 'walk'] as const) {
      expect(hasCardioFields(t), t).toBe(true);
    }
  });

  it('gives weight and stretch none', () => {
    expect(hasCardioFields('weight')).toBe(false);
    expect(hasCardioFields('stretch')).toBe(false);
    expect(visibleCardioFields('weight', '', values({ distance: '5' }))).toEqual([]);
  });

  // AC4: Ascent disappears indoors — there is no terrain to climb.
  it('drops Ascent for an indoor bike, run or walk', () => {
    for (const t of ['bike', 'run', 'walk'] as const) {
      expect([...cardioFieldsFor(t, 'indoor')], t).toEqual(['distance', 'avgHr']);
    }
  });

  it('keeps Ascent for outdoor and terrain sub_types', () => {
    expect([...cardioFieldsFor('bike', 'mountain')]).toContain('ascent');
    expect([...cardioFieldsFor('bike', 'gravel')]).toContain('ascent');
    expect([...cardioFieldsFor('run', 'outdoor')]).toContain('ascent');
  });

  // AC4: Descent is hike-only — on a loop ride it just mirrors ascent.
  it('shows Descent for hike and for nothing else', () => {
    expect([...cardioFieldsFor('hike', '')]).toContain('descent');
    for (const t of ['bike', 'run', 'walk'] as const) {
      expect([...cardioFieldsFor(t, 'outdoor')], t).not.toContain('descent');
      expect([...cardioFieldsFor(t, '')], t).not.toContain('descent');
    }
  });

  // The reason sub_type is a free string: a new terrain needs no code change.
  it('treats an unrecognised sub_type as outdoor rather than failing', () => {
    expect([...cardioFieldsFor('bike', 'road')]).toEqual(['distance', 'ascent', 'avgHr']);
    expect([...cardioFieldsFor('run', 'trail')]).toEqual(['distance', 'ascent', 'avgHr']);
  });
});

describe('AC4: a field holding a value is never hidden', () => {
  it('still shows Ascent on an indoor ride when it already has a value', () => {
    expect(visibleCardioFields('bike', 'indoor', values({ ascent: '1200' })))
      .toEqual(['distance', 'ascent', 'avgHr']);
  });

  it('still shows Descent on a bike when it already has a value', () => {
    expect(visibleCardioFields('bike', 'gravel', values({ descent: '800' })))
      .toEqual(['distance', 'ascent', 'descent', 'avgHr']);
  });

  it('hides Ascent indoors only while it is empty', () => {
    expect(visibleCardioFields('bike', 'indoor', EMPTY)).toEqual(['distance', 'avgHr']);
  });

  // The round trip is the point: switching venue and back loses nothing.
  it('survives a round trip through indoor and out again', () => {
    const typed = values({ distance: '12.4', ascent: '1500' });
    expect(visibleCardioFields('bike', 'indoor', typed)).toContain('ascent');
    expect(visibleCardioFields('bike', 'mountain', typed)).toContain('ascent');
  });

  it('keeps the fields in declaration order however they become visible', () => {
    expect(visibleCardioFields('hike', '', EMPTY))
      .toEqual(['distance', 'ascent', 'descent', 'avgHr']);
  });
});

describe('AC5: a blank sub_type is a working state', () => {
  // Every bike and hike logged before #129 has sub_type ''.
  it('gives a pre-#129 bike the outdoor field set', () => {
    expect(visibleCardioFields('bike', '', EMPTY)).toEqual(['distance', 'ascent', 'avgHr']);
  });

  it('gives a pre-#129 hike its full field set', () => {
    expect(visibleCardioFields('hike', '', EMPTY))
      .toEqual(['distance', 'ascent', 'descent', 'avgHr']);
  });

  it('never treats blank as indoor', () => {
    expect([...cardioFieldsFor('bike', '')]).not.toEqual([...cardioFieldsFor('bike', 'indoor')]);
  });
});
