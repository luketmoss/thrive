export interface Route {
  pattern: string;
  name: string;
}

export const routes: Route[] = [
  { pattern: '/', name: 'history' },
  { pattern: '/history/:id', name: 'workout-detail' },
  { pattern: '/history/:id/edit', name: 'workout-edit' },
  { pattern: '/workout/new', name: 'workout-new' },
  { pattern: '/workout/:id', name: 'workout-active' },
  { pattern: '/templates', name: 'templates' },
  { pattern: '/templates/new', name: 'template-new' },
  { pattern: '/templates/:id', name: 'template-edit' },
  { pattern: '/exercises', name: 'exercises' },
  { pattern: '/settings', name: 'settings' },
  { pattern: '/settings/labels', name: 'manage-labels' },
];
