import { useState } from 'preact/hooks';
import { labels, labelUsageCount } from '../../state/store';
import { addLabel, renameLabel, updateLabelColor, removeLabel } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { getLabelColor, LABEL_COLORS } from '../../api/label-colors';
import { ColorSwatchPicker } from '../shared/color-swatch-picker';
import { ConfirmModal } from '../shared/confirm-modal';
import { navigate } from '../../router/router';
import type { LabelWithRow } from '../../api/types';

export function ManageLabelsScreen() {
  const { token } = useAuth();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(LABEL_COLORS[0].key);
  const [saving, setSaving] = useState(false);
  const [deletingLabel, setDeletingLabel] = useState<LabelWithRow | null>(null);

  const startEdit = (label: LabelWithRow) => {
    setEditingId(label.id);
    setEditName(label.name);
  };

  const saveEdit = async (label: LabelWithRow) => {
    if (!token || !editName.trim() || saving) return;
    if (editName.trim() === label.name) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    try {
      await renameLabel(label, editName.trim(), token);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleColorChange = async (label: LabelWithRow, colorKey: string) => {
    if (!token || label.color_key === colorKey) return;
    await updateLabelColor(label, colorKey, token);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !token || saving) return;
    setSaving(true);
    try {
      await addLabel({ name: newName.trim(), color_key: newColor }, token);
      setCreating(false);
      setNewName('');
      setNewColor(LABEL_COLORS[0].key);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deletingLabel) return;
    await removeLabel(deletingLabel, token);
    setDeletingLabel(null);
  };

  const allLabels = labels.value;

  return (
    <div class="screen manage-labels-screen">
      <header class="screen-header" style="display: flex; align-items: center; gap: var(--space-sm);">
        <button
          type="button"
          class="template-editor-back"
          onClick={() => navigate('/settings')}
        >
          &larr;
        </button>
        <h1>Manage Labels</h1>
      </header>

      <div class="screen-body">
        {allLabels.length === 0 && !creating ? (
          <div class="empty-state">
            <p>No labels yet.</p>
            <p>Create one to start organizing your exercises.</p>
            <button
              type="button"
              class="btn btn-primary"
              style="margin-top: var(--space-md);"
              onClick={() => setCreating(true)}
            >
              New Label
            </button>
          </div>
        ) : (
          <>
            <div class="manage-labels-list">
              {allLabels.map(label => {
                const color = getLabelColor(label.color_key);
                const usage = labelUsageCount(label.name);
                const isEditing = editingId === label.id;

                return (
                  <div key={label.id} class="manage-label-row">
                    <div class="manage-label-main">
                      <span
                        class="manage-label-swatch"
                        style={{
                          background: color ? color.light.text : 'var(--color-primary)',
                        }}
                      />
                      {isEditing ? (
                        <input
                          class="form-input manage-label-edit-input"
                          type="text"
                          value={editName}
                          onInput={e => setEditName((e.target as HTMLInputElement).value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); saveEdit(label); }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          onBlur={() => saveEdit(label)}
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          class="manage-label-name"
                          onClick={() => startEdit(label)}
                          aria-label={`Rename ${label.name}`}
                        >
                          {label.name}
                        </button>
                      )}
                      <span class="manage-label-usage">Used by {usage}</span>
                      <button
                        type="button"
                        class="manage-label-delete"
                        onClick={() => setDeletingLabel(label)}
                        aria-label={`Delete ${label.name}`}
                      >
                        &times;
                      </button>
                    </div>
                    <ColorSwatchPicker
                      selected={label.color_key}
                      onSelect={key => handleColorChange(label, key)}
                    />
                  </div>
                );
              })}
            </div>

            {creating ? (
              <div class="manage-label-create-form">
                <input
                  class="form-input"
                  type="text"
                  value={newName}
                  onInput={e => setNewName((e.target as HTMLInputElement).value)}
                  placeholder="New label name"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
                    if (e.key === 'Escape') setCreating(false);
                  }}
                />
                <ColorSwatchPicker selected={newColor} onSelect={setNewColor} />
                <div class="form-actions">
                  <button type="button" class="btn btn-secondary" onClick={() => setCreating(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={saving || !newName.trim()}
                    onClick={handleCreate}
                  >
                    {saving ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                class="btn btn-primary"
                style="width: 100%;"
                onClick={() => setCreating(true)}
              >
                + New Label
              </button>
            )}
          </>
        )}
      </div>

      {deletingLabel && (
        <ConfirmModal
          title="Delete Label"
          message={`Remove '${deletingLabel.name}'? It is used by ${labelUsageCount(deletingLabel.name)} exercises. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setDeletingLabel(null)}
        />
      )}
    </div>
  );
}
