import { signal } from '@preact/signals';

type ThemeChoice = 'light' | 'dark' | 'system';

function getStoredTheme(): ThemeChoice {
  try {
    const val = localStorage.getItem('gw-theme');
    if (val === 'light' || val === 'dark') return val;
  } catch { /* ignore */ }
  return 'system';
}

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'light' || choice === 'dark') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const themeChoice = signal<ThemeChoice>(getStoredTheme());

function applyTheme(choice: ThemeChoice) {
  const resolved = resolveTheme(choice);
  document.documentElement.setAttribute('data-theme', resolved);
  try {
    if (choice === 'system') {
      localStorage.removeItem('gw-theme');
    } else {
      localStorage.setItem('gw-theme', choice);
    }
  } catch { /* ignore */ }
}

// Apply on init
applyTheme(themeChoice.value);

// Listen for system theme changes when in 'system' mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themeChoice.value === 'system') {
    applyTheme('system');
  }
});

export function setTheme(choice: ThemeChoice) {
  themeChoice.value = choice;
  applyTheme(choice);
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemeToggle() {
  return (
    <div class="theme-toggle">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          class={`theme-toggle-btn${themeChoice.value === value ? ' active' : ''}`}
          onClick={() => setTheme(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
