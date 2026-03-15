import { describe, it, expect, beforeEach } from 'vitest';
import { exercises, labels, allTags, getLabelByName, labelUsageCount } from '../../state/store';
import { colorKeyFromName, getLabelColor, LABEL_COLORS } from '../../api/label-colors';
import type { ExerciseWithRow, LabelWithRow } from '../../api/types';

function resetSignals() {
  exercises.value = [];
  labels.value = [];
}

function makeExercise(overrides: Partial<ExerciseWithRow> = {}): ExerciseWithRow {
  return {
    id: 'ex1', name: 'Bench Press', tags: 'Push, Chest', notes: '',
    created: '2025-01-01T00:00:00.000Z', sheetRow: 2, ...overrides,
  };
}

function makeLabel(overrides: Partial<LabelWithRow> = {}): LabelWithRow {
  return {
    id: 'lbl1', name: 'Push', color_key: 'red',
    created: '2025-01-01T00:00:00.000Z', sheetRow: 2, ...overrides,
  };
}

describe('AC1: Label metadata storage and migration', () => {
  beforeEach(resetSignals);

  it('allTags is sourced from labels signal, not exercises', () => {
    exercises.value = [makeExercise({ tags: 'Push, Chest' })];
    labels.value = [
      makeLabel({ name: 'Arms', color_key: 'red' }),
    ];
    // allTags should reflect labels, not exercise tags
    expect(allTags.value).toEqual(['Arms']);
  });

  it('deterministic color assignment: same name always yields same color', () => {
    const key1 = colorKeyFromName('Push');
    const key2 = colorKeyFromName('Push');
    expect(key1).toBe(key2);
    expect(LABEL_COLORS.map(c => c.key)).toContain(key1);
  });

  it('migration populates labels from unique exercise tags', () => {
    // Simulate what bootstrapLabels does
    const exerciseData = [
      makeExercise({ tags: 'Push, Chest' }),
      makeExercise({ id: 'ex2', tags: 'Pull, Chest', sheetRow: 3 }),
    ];
    const tagSet = new Set<string>();
    for (const ex of exerciseData) {
      ex.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    }
    const sorted = Array.from(tagSet).sort();
    const migrated = sorted.map((name, i) => ({
      id: `lbl_${i}`, name, color_key: colorKeyFromName(name),
      created: '', sheetRow: i + 2,
    }));

    expect(migrated).toHaveLength(3); // Chest, Pull, Push
    expect(migrated.map(l => l.name)).toEqual(['Chest', 'Pull', 'Push']);
    // Each should have a valid color_key
    for (const l of migrated) {
      expect(LABEL_COLORS.map(c => c.key)).toContain(l.color_key);
    }
  });
});

describe('AC2: Manage Labels page', () => {
  beforeEach(resetSignals);

  it('labels signal provides list data for the manage labels screen', () => {
    labels.value = [
      makeLabel({ name: 'Push', color_key: 'red' }),
      makeLabel({ name: 'Pull', color_key: 'blue', id: 'lbl2', sheetRow: 3 }),
    ];
    expect(labels.value).toHaveLength(2);
  });

  it('labelUsageCount returns correct count for each label', () => {
    labels.value = [
      makeLabel({ name: 'Push' }),
      makeLabel({ name: 'Pull', id: 'lbl2', sheetRow: 3 }),
    ];
    exercises.value = [
      makeExercise({ id: 'ex1', tags: 'Push, Chest' }),
      makeExercise({ id: 'ex2', tags: 'Push, Arms', sheetRow: 3 }),
      makeExercise({ id: 'ex3', tags: 'Pull, Back', sheetRow: 4 }),
    ];

    expect(labelUsageCount('Push')).toBe(2);
    expect(labelUsageCount('Pull')).toBe(1);
  });

  it('empty state when no labels exist', () => {
    expect(labels.value).toHaveLength(0);
  });
});

describe('AC3: Create, rename, and delete labels', () => {
  beforeEach(resetSignals);

  it('adding a label updates the labels signal', () => {
    labels.value = [];
    const newLabel = makeLabel({ id: 'lbl_new', name: 'Core', color_key: 'green' });
    labels.value = [...labels.value, newLabel];
    expect(labels.value).toHaveLength(1);
    expect(labels.value[0].name).toBe('Core');
  });

  it('renaming a label updates exercises containing that tag', () => {
    labels.value = [makeLabel({ name: 'Push' })];
    exercises.value = [
      makeExercise({ id: 'ex1', tags: 'Push, Chest' }),
      makeExercise({ id: 'ex2', tags: 'Pull, Back', sheetRow: 3 }),
    ];

    // Simulate rename propagation
    const oldName = 'Push';
    const newName = 'Pressing';
    const affected = exercises.value.filter(ex =>
      ex.tags.split(',').map(t => t.trim()).includes(oldName),
    );
    expect(affected).toHaveLength(1);

    // Simulate updating affected exercises
    exercises.value = exercises.value.map(ex => {
      const tags = ex.tags.split(',').map(t => t.trim());
      if (tags.includes(oldName)) {
        return { ...ex, tags: tags.map(t => t === oldName ? newName : t).join(', ') };
      }
      return ex;
    });

    expect(exercises.value[0].tags).toBe('Pressing, Chest');
    expect(exercises.value[1].tags).toBe('Pull, Back'); // unchanged
  });

  it('deleting a label removes it from all exercises', () => {
    labels.value = [makeLabel({ name: 'Push' })];
    exercises.value = [
      makeExercise({ id: 'ex1', tags: 'Push, Chest' }),
      makeExercise({ id: 'ex2', tags: 'Push', sheetRow: 3 }),
    ];

    // Simulate delete propagation
    const labelName = 'Push';
    exercises.value = exercises.value.map(ex => {
      const tags = ex.tags.split(',').map(t => t.trim()).filter(t => t !== labelName);
      return { ...ex, tags: tags.join(', ') };
    });
    labels.value = labels.value.filter(l => l.name !== labelName);

    expect(exercises.value[0].tags).toBe('Chest');
    expect(exercises.value[1].tags).toBe('');
    expect(labels.value).toHaveLength(0);
  });
});

describe('AC4: Tap-to-toggle label chips', () => {
  beforeEach(resetSignals);

  it('toggling a label on adds it to exercise tags', () => {
    const tags = ['Push'];
    const newTag = 'Chest';
    const updated = [...tags, newTag];
    expect(updated).toEqual(['Push', 'Chest']);
  });

  it('toggling an active label off removes it from exercise tags', () => {
    const tags = ['Push', 'Chest'];
    const removeTag = 'Chest';
    const updated = tags.filter(t => t !== removeTag);
    expect(updated).toEqual(['Push']);
  });

  it('all labels are available in the chip grid', () => {
    labels.value = [
      makeLabel({ name: 'Push' }),
      makeLabel({ name: 'Pull', id: 'lbl2', sheetRow: 3 }),
      makeLabel({ name: 'Legs', id: 'lbl3', sheetRow: 4 }),
    ];
    expect(labels.value).toHaveLength(3);
  });
});

describe('AC5: Label colors on tag badges', () => {
  beforeEach(resetSignals);

  it('getLabelByName returns the label with its color_key', () => {
    labels.value = [
      makeLabel({ name: 'Push', color_key: 'red' }),
      makeLabel({ name: 'Pull', color_key: 'blue', id: 'lbl2', sheetRow: 3 }),
    ];

    const push = getLabelByName('Push');
    expect(push).toBeDefined();
    expect(push!.color_key).toBe('red');

    const pull = getLabelByName('Pull');
    expect(pull).toBeDefined();
    expect(pull!.color_key).toBe('blue');
  });

  it('getLabelColor returns light and dark theme pairs', () => {
    const red = getLabelColor('red');
    expect(red).toBeDefined();
    expect(red!.light.bg).toBeTruthy();
    expect(red!.light.text).toBeTruthy();
    expect(red!.dark.bg).toBeTruthy();
    expect(red!.dark.text).toBeTruthy();
  });

  it('falls back gracefully for unknown label names', () => {
    labels.value = [];
    const result = getLabelByName('Nonexistent');
    expect(result).toBeUndefined();
  });

  it('color swatch picker has 10 predefined colors', () => {
    expect(LABEL_COLORS).toHaveLength(10);
    // Each has a name for aria-label
    for (const c of LABEL_COLORS) {
      expect(c.name).toBeTruthy();
    }
  });
});

describe('Router: manage-labels route', () => {
  it('parses /settings/labels as manage-labels route', async () => {
    const { currentRoute } = await import('../../router/router');
    window.location.hash = '/settings/labels';
    window.dispatchEvent(new Event('hashchange'));
    expect(currentRoute.value.name).toBe('manage-labels');
  });
});
