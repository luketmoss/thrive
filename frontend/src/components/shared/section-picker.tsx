import { useState, useEffect } from 'preact/hooks';
import { ALL_SECTIONS } from '../workout/section-management';
import { sectionPillClass } from './section-utils';

interface Props {
  value: string;
  onChange: (section: string) => void;
  /** If true, show warmup confirmation before switching to warmup. */
  warnOnWarmup?: boolean;
}

export function SectionPicker({ value, onChange, warnOnWarmup }: Props) {
  const [showWarmupConfirm, setShowWarmupConfirm] = useState(false);

  useEffect(() => {
    if (!showWarmupConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowWarmupConfirm(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showWarmupConfirm]);

  const handlePillClick = (section: string) => {
    if (section === value) return;
    if (warnOnWarmup && section === 'warmup' && value !== 'warmup') {
      setShowWarmupConfirm(true);
      return;
    }
    onChange(section);
  };

  const handleConfirmWarmup = () => {
    onChange('warmup');
    setShowWarmupConfirm(false);
  };

  return (
    <>
      <div class="section-picker-row" role="group" aria-label="Select section">
        {ALL_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            class={sectionPillClass(s, s === value)}
            onClick={() => handlePillClick(s)}
            aria-pressed={s === value ? 'true' : 'false'}
          >
            {s}
          </button>
        ))}
      </div>
      {showWarmupConfirm && (
        <div class="warmup-confirm-row">
          <p class="warmup-confirm-text">
            Warmup exercises are list-only — set data will be removed.
          </p>
          <div class="warmup-confirm-actions">
            <button type="button" class="btn btn-danger" onClick={handleConfirmWarmup}>
              Switch to Warmup
            </button>
            <button type="button" class="btn btn-secondary" onClick={() => setShowWarmupConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
