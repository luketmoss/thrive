import { signal } from '@preact/signals';

export interface ParsedRoute {
  name: string;
  params: Record<string, string>;
  hash: string;
}

function parseHash(hash: string): ParsedRoute {
  const path = hash.replace(/^#/, '') || '/';

  // Match routes
  // /history/:id/edit
  let match = path.match(/^\/history\/([^/]+)\/edit$/);
  if (match) return { name: 'workout-edit', params: { id: match[1] }, hash: path };

  // /history/:id
  match = path.match(/^\/history\/([^/]+)$/);
  if (match) return { name: 'workout-detail', params: { id: match[1] }, hash: path };

  // /workout/new
  if (path === '/workout/new') return { name: 'workout-new', params: {}, hash: path };

  // /workout/:id
  match = path.match(/^\/workout\/([^/]+)$/);
  if (match) return { name: 'workout-active', params: { id: match[1] }, hash: path };

  // /templates/new
  if (path === '/templates/new') return { name: 'template-new', params: {}, hash: path };

  // /templates/:id/edit
  match = path.match(/^\/templates\/([^/]+)\/edit$/);
  if (match) return { name: 'template-edit', params: { id: match[1] }, hash: path };

  // /templates/:id
  match = path.match(/^\/templates\/([^/]+)$/);
  if (match) return { name: 'template-detail', params: { id: match[1] }, hash: path };

  // /templates
  if (path === '/templates') return { name: 'templates', params: {}, hash: path };

  // /exercises
  if (path === '/exercises') return { name: 'exercises', params: {}, hash: path };

  // /settings/labels
  if (path === '/settings/labels') return { name: 'manage-labels', params: {}, hash: path };

  // /settings
  if (path === '/settings') return { name: 'settings', params: {}, hash: path };

  // Default: activities
  return { name: 'activities', params: {}, hash: '/' };
}

export const currentRoute = signal<ParsedRoute>(parseHash(window.location.hash));

window.addEventListener('hashchange', () => {
  currentRoute.value = parseHash(window.location.hash);
});

export function navigate(path: string) {
  window.location.hash = path;
}
