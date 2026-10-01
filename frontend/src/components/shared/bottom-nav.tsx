import { currentRoute, navigate, replaceRoute } from '../../router/router';

const TABS = [
  { name: 'day', label: 'Day', icon: '\u{1F5D3}️', path: '/' },
  { name: 'activities', label: 'Activities', icon: '\u{1F4CB}', path: '/activities' },
  { name: 'trends', label: 'Trends', icon: '\u{1F4C8}', path: '/trends' },
  { name: 'library', label: 'Library', icon: '\u{1F4DA}', path: '/templates' },
  { name: 'settings', label: 'Settings', icon: '⚙️', path: '/settings' },
];

/** Which tab each route belongs to (#235). Every route marks exactly one tab. */
const TAB_FOR_ROUTE: Record<string, string> = {
  day: 'day',
  calendar: 'day', // #241: reached from the Day header, so Day stays marked
  trends: 'trends',
  activities: 'activities',
  'workout-detail': 'activities',
  'workout-edit': 'activities',
  'workout-new': 'activities',
  'workout-active': 'activities',
  templates: 'library',
  'template-new': 'library',
  'template-detail': 'library',
  'template-edit': 'library',
  exercises: 'library',
  settings: 'settings',
  'manage-labels': 'settings',
};

/**
 * Re-tapping Day while Day shows (#237 AC1): back to today, replacing the
 * history entry rather than adding one, and to the top of the screen.
 */
function reselectDay() {
  replaceRoute('/');
  window.scrollTo({ top: 0 });
}

export function BottomNav() {
  const route = currentRoute.value;
  const activeTab = TAB_FOR_ROUTE[route.name];

  return (
    <nav class="bottom-nav">
      {TABS.map(tab => {
        const isActive = tab.name === activeTab;
        return (
          <button
            key={tab.name}
            class={`bottom-nav-tab ${isActive ? 'active' : ''}`}
            onClick={() => (isActive && tab.name === 'day' ? reselectDay() : navigate(tab.path))}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <span class="bottom-nav-icon">{tab.icon}</span>
            <span class="bottom-nav-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
