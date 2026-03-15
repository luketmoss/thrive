import { LABEL_COLORS } from '../../api/label-colors';

interface ColorSwatchPickerProps {
  selected: string;
  onSelect: (colorKey: string) => void;
}

export function ColorSwatchPicker({ selected, onSelect }: ColorSwatchPickerProps) {
  return (
    <div class="color-swatch-grid" role="radiogroup" aria-label="Label color">
      {LABEL_COLORS.map(color => {
        const isSelected = selected === color.key;
        return (
          <button
            key={color.key}
            type="button"
            class={`color-swatch${isSelected ? ' selected' : ''}`}
            style={{ background: color.light.bg, color: color.light.text, borderColor: color.light.text }}
            onClick={() => onSelect(color.key)}
            aria-label={color.name}
            role="radio"
            aria-checked={isSelected}
          >
            {isSelected && (
              <span class="color-swatch-check" aria-hidden="true">&#10003;</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
