import { useState, useRef } from 'preact/hooks';
import { allTags } from '../../state/store';

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
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    }
    if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const handleTagBlur = () => {
    if (tagInput.trim()) addTag(tagInput);
  };

  const suggestions = allTags.value.filter(
    (t) => !tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase()),
  );

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
        <label class="form-label">Tags</label>
        <div
          class="tag-input-wrapper"
          onClick={() => inputRef.current?.focus()}
        >
          {tags.map((tag) => (
            <span key={tag} class="tag-badge tag-badge-removable">
              {tag}
              <button
                type="button"
                class="tag-badge-remove"
                onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                aria-label={`Remove ${tag}`}
              >
                &times;
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            class="tag-input-field"
            type="text"
            value={tagInput}
            onInput={(e) => setTagInput((e.target as HTMLInputElement).value)}
            onKeyDown={handleTagKeyDown}
            onBlur={handleTagBlur}
            placeholder={tags.length === 0 ? 'Add tags...' : ''}
          />
        </div>
        {tagInput && suggestions.length > 0 && (
          <div class="tag-suggestions">
            {suggestions.map((s) => (
              <span
                key={s}
                class="tag-badge tag-suggestion"
                onClick={() => addTag(s)}
              >
                {s}
              </span>
            ))}
          </div>
        )}
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
