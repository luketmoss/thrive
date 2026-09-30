import { currentRoute, navigate } from '../../router/router';

const TABS = [
  { name: 'day', label: 'Day', icon: '\u{1F5D3}️', path: '/' },
  { name: 'activities', label: 'Activities', icon: '\u{1F4CB}', path: '/activities' },
  { name: 'trends', label: 'Trends', icon: '\u{1F4C8}', path: '/trends' },
  { name: 'library', label: 'Library', icon: '\u{1F4DA}', path: '/templates' },
  { name: 'settings', label: 'Settings', icon: '⚙️', path: '/settings' },
];

/** Which tab each route belongs to (#235). Every route marks exactly one tab. */
export const TAB_FOR_ROUTE: Record<string, string> = {
  day: 'day',
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
            onClick={() => navigate(tab.path)}
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
