// Predefined label color palette — 10 colors with light + dark theme pairs.

export interface LabelColor {
  key: string;
  name: string;
  light: { bg: string; text: string };
  dark: { bg: string; text: string };
}

export const LABEL_COLORS: LabelColor[] = [
  { key: 'red',     name: 'Red',     light: { bg: '#fde8e8', text: '#c53030' }, dark: { bg: '#3b1515', text: '#fca5a5' } },
  { key: 'orange',  name: 'Orange',  light: { bg: '#fff3e0', text: '#e65100' }, dark: { bg: '#2d1b06', text: '#ffb74d' } },
  { key: 'amber',   name: 'Amber',   light: { bg: '#fef7e8', text: '#b45309' }, dark: { bg: '#2d2210', text: '#fbbf24' } },
  { key: 'green',   name: 'Green',   light: { bg: '#e8f5e9', text: '#2e7d32' }, dark: { bg: '#14291a', text: '#86efac' } },
  { key: 'teal',    name: 'Teal',    light: { bg: '#e0f2f1', text: '#00695c' }, dark: { bg: '#0a2623', text: '#80cbc4' } },
  { key: 'blue',    name: 'Blue',    light: { bg: '#e3f2fd', text: '#1565c0' }, dark: { bg: '#0d1f33', text: '#93c5fd' } },
  { key: 'indigo',  name: 'Indigo',  light: { bg: '#eef1fe', text: '#3b5de5' }, dark: { bg: '#1e2440', text: '#a5b4fc' } },
  { key: 'purple',  name: 'Purple',  light: { bg: '#f3e5f5', text: '#7b1fa2' }, dark: { bg: '#2a1533', text: '#d8b4fe' } },
  { key: 'pink',    name: 'Pink',    light: { bg: '#fce4ec', text: '#c62828' }, dark: { bg: '#2d0a0a', text: '#f9a8d4' } },
  { key: 'gray',    name: 'Gray',    light: { bg: '#f0f2f4', text: '#5f6b7a' }, dark: { bg: '#25252b', text: '#9ba1a6' } },
];

/** Get a LabelColor by key, or undefined if not found. */
export function getLabelColor(key: string): LabelColor | undefined {
  return LABEL_COLORS.find(c => c.key === key);
}

/** Deterministic color assignment: hash a string to a palette index. */
export function colorKeyFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % LABEL_COLORS.length;
  return LABEL_COLORS[index].key;
}
