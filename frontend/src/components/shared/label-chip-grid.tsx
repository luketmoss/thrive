import { useState } from 'preact/hooks';
import { labels } from '../../state/store';
import { addLabel } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { getLabelColor, LABEL_COLORS } from '../../api/label-colors';
import { ColorSwatchPicker } from './color-swatch-picker';
import { navigate } from '../../router/router';

interface LabelChipGridProps {
  selected: string[];
  onToggle: (labelName: string) => void;
  onCreated?: (labelName: string) => void;
}

export function LabelChipGrid({ selected, onToggle, onCreated }: LabelChipGridProps) {
  const { token } = useAuth();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(LABEL_COLORS[0].key);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim() || !token || saving) return;
    setSaving(true);
    try {
      const label = await addLabel({ name: newName.trim(), color_key: newColor }, token);
      onToggle(label.name);
      if (onCreated) onCreated(label.name);
      setCreating(false);
      setNewName('');
      setNewColor(LABEL_COLORS[0].key);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="label-chip-grid-wrapper">
      <div class="label-chip-grid">
        {labels.value.map(label => {
          const isActive = selected.includes(label.name);
          const color = getLabelColor(label.color_key);
          const style: Record<string, string> = {};
          if (color) {
            style['--label-bg'] = color.light.bg;
            style['--label-text'] = color.light.text;
            style['--label-bg-dark'] = color.dark.bg;
            style['--label-text-dark'] = color.dark.text;
          }
          return (
            <button
              key={label.id}
              type="button"
              class={`label-chip${isActive ? ' label-chip-active' : ''}${color ? ' tag-badge-colored' : ''}`}
              style={style}
              onClick={() => onToggle(label.name)}
              aria-pressed={isActive}
            >
              {label.name}
            </button>
          );
        })}
        {!creating && (
          <button
            type="button"
            class="label-chip label-chip-create"
            onClick={() => setCreating(true)}
          >
            + New Label
          </button>
        )}
      </div>

      {creating && (
        <div class="label-create-inline">
          <input
            class="form-input"
            type="text"
            value={newName}
            onInput={e => setNewName((e.target as HTMLInputElement).value)}
            placeholder="Label name"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <ColorSwatchPicker selected={newColor} onSelect={setNewColor} />
          <div class="form-actions">
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={saving || !newName.trim()}
              onClick={handleCreate}
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        class="manage-labels-link"
        onClick={() => navigate('/settings/labels')}
      >
        Manage labels
      </button>
    </div>
  );
}
