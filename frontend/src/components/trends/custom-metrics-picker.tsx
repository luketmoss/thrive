// The custom set's picker (#246 AC2): a modal of labelled checkboxes, up to
// four. A choice applies the moment it is made (like Range and Average), so
// there is no Save and no Cancel; every way out is the same close.
//
// At the cap the unchecked rows keep `aria-disabled` rather than `disabled`:
// they stay in the tab order so a screen-reader user reaches them and hears
// why, and the click itself is refused.

import { useEffect, useRef } from 'preact/hooks';
import { CUSTOM_SECTIONS, CUSTOM_MAX, normaliseCustom } from './metrics';

interface Props {
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  /** Done, Escape or the overlay. The caller returns focus to its trigger. */
  onClose: () => void;
}

const TITLE_ID = 'trends-custom-title';
const FOCUSABLE = 'input, button, [tabindex]:not([tabindex="-1"])';

export function CustomMetricsPicker({ selected, onChange, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const atCap = selected.length >= CUSTOM_MAX;

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // Keep Tab inside the dialog.
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...selected, id] : selected.filter((x) => x !== id);
    onChange(normaliseCustom(next));
  };

  return (
    <div class="modal-overlay" onClick={(e) => { if ((e.target as HTMLElement).classList.contains('modal-overlay')) onClose(); }}>
      <div class="modal-content trends-picker" role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} ref={dialog}>
        <h2 id={TITLE_ID} class="trends-picker-title">Choose metrics</h2>
        <p class="trends-picker-hint">Up to {CUSTOM_MAX}. Each applies as you choose it.</p>
        <p class="trends-picker-status" role="status">
          {atCap ? `${CUSTOM_MAX} selected — remove one to add another.` : ''}
        </p>
        <div class="trends-picker-list">
          {CUSTOM_SECTIONS.map((section) => {
            const headingId = `trends-picker-${section.label.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <div key={section.label} role="group" aria-labelledby={headingId}>
                <h3 class="trends-picker-heading" id={headingId}>{section.label}</h3>
                {section.metrics.map((m) => {
                  const checked = selected.includes(m.id);
                  const blocked = atCap && !checked;
                  return (
                    <label key={m.id} class={`trends-picker-row${blocked ? ' is-blocked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-disabled={blocked ? 'true' : undefined}
                        onClick={(e) => { if (blocked) e.preventDefault(); }}
                        onChange={(e) => { if (!blocked) toggle(m.id, (e.currentTarget as HTMLInputElement).checked); }}
                      />
                      <span>{m.label}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        <button type="button" class="btn btn-primary trends-picker-done" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
