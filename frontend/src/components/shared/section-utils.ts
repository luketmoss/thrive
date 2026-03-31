/** Shared section badge styling utilities. */

export function sectionBadgeClass(section: string): string {
  if (section.startsWith('SS')) return 'section-badge section-ss';
  return `section-badge section-${section}`;
}

export function sectionPillClass(section: string, active: boolean): string {
  const base = 'section-picker-pill';
  if (!active) return base;
  if (section.startsWith('SS')) return `${base} section-picker-pill-active section-ss`;
  return `${base} section-picker-pill-active section-${section}`;
}
