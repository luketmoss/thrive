import { signal } from '@preact/signals';

export interface ParsedRoute {
  name: string;
  params: Record<string, string>;
  hash: string;
}

function parseHash(hash: string): ParsedRoute {
  const full = hash.replace(/^#/, '') || '/';

  // Match on the path alone (#143): `/workout/new?plan=…` must not fall through
  // to `/workout/:id`, and a query on any route must not end up inside an `:id`.
  const queryAt = full.indexOf('?');
  const path = (queryAt === -1 ? full : full.slice(0, queryAt)) || '/';
  const query = new URLSearchParams(queryAt === -1 ? '' : full.slice(queryAt + 1));

  // Match routes
  // /history/:id/edit
  let match = path.match(/^\/history\/([^/]+)\/edit$/);
  if (match) return { name: 'workout-edit', params: { id: match[1] }, hash: path };

  // /history/:id
  match = path.match(/^\/history\/([^/]+)$/);
  if (match) return { name: 'workout-detail', params: { id: match[1] }, hash: path };

  // /workout/new, optionally ?plan=YYYY-MM-DD (#143). `plan` is passed through
  // raw, and only when the key is present; WorkoutFlow validates it.
  if (path === '/workout/new') {
    const plan = query.get('plan');
    return { name: 'workout-new', params: plan === null ? {} : { plan }, hash: full };
  }

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

  // /trends (#235)
  if (path === '/trends') return { name: 'trends', params: {}, hash: path };

  // /activities (#235): the list that used to live at `/`
  if (path === '/activities') return { name: 'activities', params: {}, hash: path };

  // Default: Day, for the empty hash, `#/` and any hash that matches no route (#235)
  return { name: 'day', params: {}, hash: '/' };
}

export const currentRoute = signal<ParsedRoute>(parseHash(window.location.hash));

// In-app history (#235): lets a Back arrow use `history.back()` only when the
// screen before this one is a sensible place to land. A deep link opened fresh
// has nothing before it, and back would leave the app.
//
// `navigate()` and `goBack()` say which way they are going. A hashchange nobody
// announced (browser back/forward, a plain link) is a pop when it returns to the
// previous entry and a push otherwise.
const normalise = (hash: string): string => (hash === '' ? '#/' : hash);
const visited: string[] = [normalise(window.location.hash)];
let expected: 'push' | 'pop' | null = null;

// Screens that are steps of a flow, never somewhere to go "back" to: returning
// from a workout's detail must not reopen its edit form or its tracker (#235).
const NOT_A_BACK_TARGET = ['workout-edit', 'workout-active'];

window.addEventListener('hashchange', () => {
  const hash = normalise(window.location.hash);
  const previous = visited[visited.length - 2];
  const isPop = expected === 'pop' || (expected === null && previous === hash);
  expected = null;
  if (isPop) visited.pop();
  else visited.push(hash);
  currentRoute.value = parseHash(window.location.hash);
});

/** True when the previous in-app screen is a sensible place for Back to land. */
export function canGoBack(): boolean {
  if (visited.length < 2) return false;
  const previous = parseHash(visited[visited.length - 2]);
  return !NOT_A_BACK_TARGET.includes(previous.name);
}

/** Back to the previous in-app screen, or to `fallback` when there is none. */
export function goBack(fallback = '/activities'): void {
  if (canGoBack()) {
    expected = 'pop';
    window.history.back();
  } else {
    navigate(fallback);
  }
}

export function navigate(path: string): void {
  // Setting the hash it already has fires no hashchange, so announce nothing.
  if (normalise('#' + path.replace(/^#/, '')) !== normalise(window.location.hash)) expected = 'push';
  window.location.hash = path;
}
