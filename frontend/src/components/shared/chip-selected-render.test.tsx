// #183 AC2 — a selected chip carries a leading check (aria-hidden) so it does
// not rest on the tint alone, and every type filter chip reports aria-pressed.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { h } from 'preact';

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 'tok' }) }));

import { ActivitiesFilters } from '../activities/activities-filters';
import { LabelChipGrid } from './label-chip-grid';
import { filterType, filterTags, labels } from '../../state/store';

afterEach(() => {
  cleanup();
  filterType.value = null;
  filterTags.value = [];
  labels.value = [];
});

const typeChips = (c: Element) => [...c.querySelectorAll('.filter-row:first-child .filter-chip')];

describe('AC2: type filter chips', () => {
  it('every chip carries aria-pressed matching its state', () => {
    filterType.value = 'bike';
    const { container } = render(h(ActivitiesFilters as any, {}));
    const chips = typeChips(container);
    expect(chips).toHaveLength(6);
    for (const chip of chips) {
      const on = chip.textContent!.includes('Bike');
      expect(chip.getAttribute('aria-pressed')).toBe(on ? 'true' : 'false');
    }
  });

  it('only the selected chip shows a check, hidden from assistive tech', () => {
    filterType.value = 'run';
    const { container } = render(h(ActivitiesFilters as any, {}));
    const checks = container.querySelectorAll('.filter-chip .chip-check');
    expect(checks).toHaveLength(1);
    expect(checks[0].getAttribute('aria-hidden')).toBe('true');
    expect(checks[0].textContent).toBe('✓');
    expect(checks[0].closest('.filter-chip')!.classList.contains('active')).toBe(true);
  });

  it('shows no check when nothing is selected', () => {
    const { container } = render(h(ActivitiesFilters as any, {}));
    expect(container.querySelector('.chip-check')).toBeNull();
  });
});

describe('AC2: label chips', () => {
  it('shows a hidden check on a selected label only, keeping aria-pressed', () => {
    labels.value = [
      { id: '1', name: 'Heavy', color_key: 'red', created: '', sheetRow: 2 },
      { id: '2', name: 'Light', color_key: 'blue', created: '', sheetRow: 3 },
    ];
    const { container } = render(h(LabelChipGrid as any, { selected: ['Heavy'], onToggle: () => {} }));
    const chips = [...container.querySelectorAll('.label-chip')];
    const heavy = chips.find((b) => b.textContent!.includes('Heavy'))!;
    const light = chips.find((b) => b.textContent!.includes('Light'))!;
    expect(heavy.querySelector('.chip-check')?.getAttribute('aria-hidden')).toBe('true');
    expect(heavy.getAttribute('aria-pressed')).toBe('true');
    expect(light.querySelector('.chip-check')).toBeNull();
    expect(light.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('.chip-check')).toHaveLength(1);
  });
});

// #319 AC3 — LabelBadge reports aria-pressed whenever it is a toggle button, so
// the Activities and Exercises tag filters gain it with the picker's.
import { LabelBadge } from './label-badge';

describe('#319: LabelBadge aria-pressed', () => {
  it('a toggle chip reports its state', () => {
    const on = render(h(LabelBadge as any, { name: 'Core', active: true, onClick: () => {} })).container.firstElementChild!;
    const off = render(h(LabelBadge as any, { name: 'Legs', active: false, onClick: () => {} })).container.firstElementChild!;
    expect(on.tagName).toBe('BUTTON');
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(off.getAttribute('aria-pressed')).toBe('false');
  });

  it('a static badge, or a button with no active state, has none', () => {
    const span = render(h(LabelBadge as any, { name: 'Core' })).container.firstElementChild!;
    const btn = render(h(LabelBadge as any, { name: 'Core', onClick: () => {} })).container.firstElementChild!;
    expect(span.tagName).toBe('SPAN');
    expect(span.hasAttribute('aria-pressed')).toBe(false);
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
  });

  it('the Activities tag filter chips report aria-pressed', () => {
    labels.value = [
      { id: '1', name: 'Heavy', color_key: 'red', created: '', sheetRow: 2 },
      { id: '2', name: 'Light', color_key: 'blue', created: '', sheetRow: 3 },
    ];
    filterTags.value = ['Light'];
    const { container } = render(h(ActivitiesFilters as any, {}));
    const chips = [...container.querySelectorAll('.tag-filter-row .tag-badge')];
    expect(chips.map((c) => [c.textContent, c.getAttribute('aria-pressed')])).toEqual([
      ['Heavy', 'false'],
      ['Light', 'true'],
    ]);
  });
});
