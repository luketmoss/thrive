import { signal } from '@preact/signals';
import { validPlanDate } from '../components/workout/plan-date';
import { isIsoMonth } from '../calendar/dates';

/**
 * Every route name, in one list (#291). `ParsedRoute.name` is typed against it,
 * and `titleFor` switches over it exhaustively, so a route cannot be added
 * without a document title.
 */
export const ROUTE_NAMES = [
  'day', 'calendar', 'trends', 'activities',
  'workout-new', 'workout-active', 'workout-detail', 'workout-edit',
  'templates', 'template-new', 'template-detail', 'template-edit',
  'exercises', 'settings', 'manage-labels',
] as const;

export type RouteName = (typeof ROUTE_NAMES)[number];

export interface ParsedRoute {
  name: RouteName;
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

// In-app history (#235, #264). Every history entry is stamped with its depth in
// `history.state` (`thrive: { depth, prev }`), so a hashchange is classified by
// where the arrived entry sits, not guessed: a lower depth is a pop (Back,
// `go(-n)`), a higher one a push (Forward, `go(+n)`), an unstamped entry a new
// one (a push). A Back arrow uses `history.back()` only when the entry below this
// one is a sensible place to land; a deep link opened fresh has nothing below it,
// and back would leave the app.
const normalise = (hash: string): string => (hash === '' ? '#/' : hash);

interface Stamp {
  depth: number;
  /** The normalised hash of the entry below, fixed when this entry was made; `null` at depth 0. */
  prev: string | null;
}

/** The current entry's stamp, or null when it has none (or one that is not valid). */
function stampOf(state: unknown): Stamp | null {
  if (!state || typeof state !== 'object') return null;
  const t = (state as { thrive?: unknown }).thrive;
  if (!t || typeof t !== 'object') return null;
  const { depth, prev } = t as { depth?: unknown; prev?: unknown };
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return null;
  return { depth, prev: typeof prev === 'string' ? normalise(prev) : null };
}

/** Stamp the current entry, keeping whatever else its state holds; the URL is untouched. */
function stamp(s: Stamp): void {
  const existing: unknown = window.history.state;
  const base = existing && typeof existing === 'object' ? existing : {};
  window.history.replaceState({ ...base, thrive: s }, '');
}

// The depth of the current entry, and the hashes of the entries seen at each
// depth this page load. The trail is the entry below's hash when it is known:
// it beats a stamp's `prev`, which `replaceRoute` on that entry makes stale.
let depth = stampOf(window.history.state)?.depth ?? 0;
if (!stampOf(window.history.state)) stamp({ depth, prev: null });
const trail: string[] = [];
trail[depth] = normalise(window.location.hash); // after `settle` above

// Screens that are steps of a flow, never somewhere to go "back" to: returning
// from a workout's detail must not reopen its edit form or its tracker (#235).
const NOT_A_BACK_TARGET = ['workout-edit', 'workout-active'];

/**
 * A route change (#256), told to listeners before `currentRoute` changes, so the
 * old screen is still in the DOM. `kind` is exact (#264): `pop` arrived at an
 * older history entry, `push` at a new entry or a newer one (Forward), and
 * `replace` stayed on the same entry (`replaceRoute`). The hashes are the
 * history entries left and arrived at, normalised (`#/` for the empty hash).
 */
export interface RouteChange {
  kind: 'push' | 'pop' | 'replace';
  from: ParsedRoute;
  to: ParsedRoute;
  fromHash: string;
  toHash: string;
}

const listeners = new Set<(change: RouteChange) => void>();

/** Listen for route changes; returns the unsubscribe. */
export function onRouteChange(listener: (change: RouteChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(change: RouteChange): void {
  for (const listener of [...listeners]) listener(change);
}

// One handler: hashchange fires for links, assignments and traversals, with
// `history.state` already the arrived entry's. A popstate handler as well would
// count every hash traversal twice.
window.addEventListener('hashchange', () => {
  const fromHash = trail[depth];
  const arrived = stampOf(window.history.state);
  let kind: RouteChange['kind'];
  if (!arrived) {
    // A new entry: the browser dropped every entry above the one left.
    kind = 'push';
    trail.length = depth + 1;
    depth += 1;
    stamp({ depth, prev: fromHash ?? null });
  } else if (arrived.depth < depth) {
    kind = 'pop';
    depth = arrived.depth;
  } else if (arrived.depth > depth) {
    kind = 'push';
    depth = arrived.depth;
  } else if (normalise(window.location.hash) === fromHash) {
    return; // the same entry, told twice
  } else {
    kind = 'replace';
  }
  const to = settle(window.location.hash);
  trail[depth] = normalise(window.location.hash);
  emit({ kind, from: currentRoute.value, to, fromHash, toHash: trail[depth] });
  currentRoute.value = to;
});

/** True when the entry below this one is a sensible place for Back to land. */
export function canGoBack(): boolean {
  if (depth === 0) return false;
  const below = trail[depth - 1] ?? stampOf(window.history.state)?.prev ?? null;
  if (below === null) return false;
  return !NOT_A_BACK_TARGET.includes(parseHash(below).name);
}

/** Back to the previous in-app screen, or to `fallback` when there is none. */
export function goBack(fallback = '/activities'): void {
  if (canGoBack()) window.history.back();
  else navigate(fallback);
}

export function navigate(path: string): void {
  window.location.hash = path;
}

/**
 * Show `path` in place of the current screen, without a new history entry or
 * a hashchange (#237 AC1): moving between days on the Day screen replaces, so
 * Back leaves the Day screen rather than stepping back through every day seen.
 * The entry keeps its depth stamp: `replaceHash` passes `history.state` through.
 */
export function replaceRoute(path: string): void {
  const hash = normalise('#' + path.replace(/^#/, ''));
  if (hash === normalise(window.location.hash)) return;
  const fromHash = trail[depth];
  replaceHash(hash);
  trail[depth] = hash;
  const to = settle(hash);
  emit({ kind: 'replace', from: currentRoute.value, to, fromHash, toHash: hash });
  currentRoute.value = to;
}
