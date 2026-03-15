import { currentRoute, navigate } from '../../router/router';

export function BottomNav() {
  const route = currentRoute.value;

  const tabs = [
    { name: 'history', label: 'History', icon: '\u{1F4CB}', path: '/' },
    { name: 'templates', label: 'Templates', icon: '\u{1F4DD}', path: '/templates' },
    { name: 'exercises', label: 'Exercises', icon: '\u{1F4AA}', path: '/exercises' },
    { name: 'settings', label: 'Settings', icon: '\u2699\uFE0F', path: '/settings' },
  ];

  return (
    <nav class="bottom-nav">
      {tabs.map(tab => {
        const isActive = route.name === tab.name ||
          (tab.name === 'history' && ['workout-detail', 'workout-edit', 'workout-new', 'workout-active'].includes(route.name)) ||
          (tab.name === 'templates' && ['template-new', 'template-edit'].includes(route.name)) ||
          (tab.name === 'settings' && route.name === 'manage-labels');
        return (
          <button
            key={tab.name}
            class={`bottom-nav-tab ${isActive ? 'active' : ''}`}
            onClick={() => navigate(tab.path)}
            aria-label={tab.label}
          >
            <span class="bottom-nav-icon">{tab.icon}</span>
            <span class="bottom-nav-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
