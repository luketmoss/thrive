import { signal } from '@preact/signals';
import { validPlanDate } from '../components/workout/plan-date';
import { isIsoMonth } from '../calendar/dates';

export interface ParsedRoute {
  name: string;
  params: Record<string, string>;
  hash: string;
  /** A `#/day…` hash that names no real date (#237): shown as today, URL replaced with `#/`. */
  badDay?: boolean;
  /** A `#/calendar/…` hash that names no real month (#241): shown as today's month, URL replaced with `#/calendar`. */
  badCalendar?: boolean;
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

  // /day/YYYY-MM-DD (#237): one real calendar date. Anything else under /day
  // (no date, a date that does not exist, a loose or extra part) is today, and
  // `settle` replaces its URL with `#/`.
  match = path.match(/^\/day\/([^/]+)$/);
  if (match && validPlanDate(match[1])) return { name: 'day', params: { date: match[1] }, hash: path };
  if (path === '/day' || path.startsWith('/day/')) return { name: 'day', params: {}, hash: '/', badDay: true };

  // /calendar and /calendar/YYYY-MM (#241). Anything else under /calendar is
  // today's month, and `settle` replaces its URL with `#/calendar`.
  if (path === '/calendar') return { name: 'calendar', params: {}, hash: path };
  match = path.match(/^\/calendar\/([^/]+)$/);
  if (match && isIsoMonth(match[1])) return { name: 'calendar', params: { month: match[1] }, hash: path };
  if (path.startsWith('/calendar/')) return { name: 'calendar', params: {}, hash: '/calendar', badCalendar: true };

  // Default: Day, for the empty hash, `#/` and any hash that matches no route (#235)
  return { name: 'day', params: {}, hash: '/' };
}

/** Rewrite the current history entry's hash without adding one or firing hashchange. */
function replaceHash(hash: string): void {
  window.history.replaceState(window.history.state, '', hash);
}

/** Parse, and replace a bad `#/day…` or `#/calendar/…` URL in place (#237 AC1, #241 AC1). */
function settle(hash: string): ParsedRoute {
  const route = parseHash(hash);
  if (!route.badDay && !route.badCalendar) return route;
  replaceHash(route.badDay ? '#/' : '#/calendar');
  return { name: route.name, params: route.params, hash: route.hash };
}

export const currentRoute = signal<ParsedRoute>(settle(window.location.hash));

// In-app history (#235): lets a Back arrow use `history.back()` only when the
// screen before this one is a sensible place to land. A deep link opened fresh
// has nothing before it, and back would leave the app.
//
// `navigate()` and `goBack()` say which way they are going. A hashchange nobody
// announced (browser back/forward, a plain link) is a pop when it returns to the
// previous entry and a push otherwise.
const normalise = (hash: string): string => (hash === '' ? '#/' : hash);
const visited: string[] = [normalise(window.location.hash)]; // after `settle` above
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
  currentRoute.value = settle(window.location.hash);
  visited[visited.length - 1] = normalise(window.location.hash);
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

/**
 * Show `path` in place of the current screen, without a new history entry or
 * a hashchange (#237 AC1): moving between days on the Day screen replaces, so
 * Back leaves the Day screen rather than stepping back through every day seen.
 */
export function replaceRoute(path: string): void {
  const hash = normalise('#' + path.replace(/^#/, ''));
  if (hash === normalise(window.location.hash)) return;
  replaceHash(hash);
  visited[visited.length - 1] = hash;
  currentRoute.value = settle(hash);
}
