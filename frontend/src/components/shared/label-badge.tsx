import { getLabelByName } from '../../state/store';
import { getLabelColor } from '../../api/label-colors';

interface LabelBadgeProps {
  name: string;
  active?: boolean;
  onClick?: () => void;
}

/** Renders a tag badge using the label's assigned color. Falls back to default primary styling. */
export function LabelBadge({ name, active, onClick }: LabelBadgeProps) {
  const label = getLabelByName(name);
  const color = label ? getLabelColor(label.color_key) : undefined;

  const style: Record<string, string> = {};
  if (color) {
    // We use CSS custom properties per-badge, consumed by the .tag-badge rule
    style['--label-bg'] = color.light.bg;
    style['--label-text'] = color.light.text;
    style['--label-bg-dark'] = color.dark.bg;
    style['--label-text-dark'] = color.dark.text;
  }

  const Tag = onClick ? 'button' : 'span';
  const extraProps = onClick ? { type: 'button' as const, onClick } : {};

  return (
    <Tag
      class={`tag-badge${color ? ' tag-badge-colored' : ''}${active ? ' active' : ''}`}
      style={style}
      {...extraProps}
    >
      {name}
    </Tag>
  );
}
