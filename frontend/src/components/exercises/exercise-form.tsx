import { useState } from 'preact/hooks';
import { LabelChipGrid } from '../shared/label-chip-grid';

interface ExerciseFormProps {
  initial?: { name: string; tags: string; notes: string };
  onSubmit: (data: { name: string; tags: string; notes: string }) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

export function ExerciseForm({ initial, onSubmit, onCancel, submitLabel = 'Save' }: ExerciseFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [tags, setTags] = useState<string[]>(() =>
    initial?.tags
      ? initial.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [],
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (tagName: string) => {
    setTags(prev =>
      prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName],
    );
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), tags: tags.join(', '), notes: notes.trim() });
    } catch {
      // caller handles the error
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div class="form-group">
        <label class="form-label">Name</label>
        <input
          class="form-input"
          type="text"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Exercise name"
          required
          autoFocus
        />
      </div>

      <div class="form-group">
        <label class="form-label">Labels</label>
        <LabelChipGrid
          selected={tags}
          onToggle={toggleTag}
        />
      </div>

      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea
          class="form-textarea"
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          placeholder="Optional notes"
        />
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={submitting || !name.trim()}
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
