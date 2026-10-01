export interface Route {
  pattern: string;
  name: string;
}

export const routes: Route[] = [
  { pattern: '/', name: 'day' },
  { pattern: '/calendar', name: 'calendar' },
  { pattern: '/calendar/:month', name: 'calendar' },
  { pattern: '/trends', name: 'trends' },
  { pattern: '/activities', name: 'activities' },
  { pattern: '/history/:id', name: 'workout-detail' },
  { pattern: '/history/:id/edit', name: 'workout-edit' },
  { pattern: '/workout/new', name: 'workout-new' },
  { pattern: '/workout/:id', name: 'workout-active' },
  { pattern: '/templates', name: 'templates' },
  { pattern: '/templates/new', name: 'template-new' },
  { pattern: '/templates/:id/edit', name: 'template-edit' },
  { pattern: '/templates/:id', name: 'template-detail' },
  { pattern: '/exercises', name: 'exercises' },
  { pattern: '/settings', name: 'settings' },
  { pattern: '/settings/labels', name: 'manage-labels' },
];
