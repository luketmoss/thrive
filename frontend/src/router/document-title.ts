// #291 — each route's document title, from one pure function and one owner.
//
// `titleFor` is pure and clock-free: a date in the URL is the viewed day, and a
// route with no date is "Today". `useDocumentTitle` is called once, from
// `RouteFocus`, so the title changes in the same commit as the screen and the
// focus move (#256). No screen sets `document.title` itself, and nothing here
// is announced: #256's heading focus is the announcement.

import { useEffect, useLayoutEffect } from 'preact/hooks';
import { currentRoute, type ParsedRoute, type RouteName } from './router';
import { workouts, templates } from '../state/store';
import { shortDate } from '../day/format';
import { monthTitle } from '../calendar/dates';

/** What the pure function may know about the user's data. */
export interface TitleLookups {
  workout(id: string): { name: string; type: string } | undefined;
  template(id: string): { name: string } | undefined;
}

export const TITLE_SUFFIX = ' — Thrive';
/** index.html's title: the first load, the login screen, and signed out. */
export const DEFAULT_TITLE = 'Thrive — Workout Tracker';
const MAX_NAME = 60;

/** A user's name as title text: whitespace collapsed, cut at 60 characters with an ellipsis. */
function clean(name: string | undefined): string {
  const s = (name ?? '').replace(/\s+/g, ' ').trim();
  return s.length > MAX_NAME ? `${s.slice(0, MAX_NAME).trimEnd()}…` : s;
}

function unreachable(name: never): never {
  throw new Error(`No document title for route ${String(name)}`);
}

/** The title for a route, always non-empty and ending in " — Thrive". */
export function titleFor(route: Pick<ParsedRoute, 'name' | 'params'>, lookups: TitleLookups): string {
  const name: RouteName = route.name;
  const id = route.params.id ?? '';
  const workoutName = () => {
    const w = lookups.workout(id);
    return w ? clean(w.name) || clean(w.type) : '';
  };
  const templateName = () => clean(lookups.template(id)?.name);
  const screen = ((): string => {
    switch (name) {
      case 'day': return route.params.date ? shortDate(route.params.date) : 'Today';
      case 'calendar': return route.params.month ? monthTitle(route.params.month) : 'Calendar';
      case 'trends': return 'Trends';
      case 'activities': return 'Activities';
      case 'settings': return 'Settings';
      case 'manage-labels': return 'Manage Labels';
      case 'templates': return 'Templates';
      case 'exercises': return 'Exercises';
      case 'template-new': return 'New Template';
      case 'template-detail': return templateName() || 'Template';
      case 'template-edit': { const n = templateName(); return n ? `Edit ${n}` : 'Template'; }
      case 'workout-new': return 'New Workout';
      case 'workout-detail': return workoutName() || 'Workout';
      case 'workout-active': { const n = workoutName(); return n ? `Log ${n}` : 'Workout'; }
      case 'workout-edit': { const n = workoutName(); return n ? `Edit ${n}` : 'Workout'; }
      default: return unreachable(name);
    }
  })();
  return screen + TITLE_SUFFIX;
}

/**
 * Keeps `document.title` on the current route's title. Reads the route and the
 * stores, so a rename that lands while the route is open retitles it. Layout
 * effect: set in the commit that shows the screen. Leaving (sign-out) restores
 * the default.
 */
export function useDocumentTitle(): void {
  const route = currentRoute.value;
  const ws = workouts.value;
  const ts = templates.value;
  const title = titleFor(route, {
    workout: (id) => ws.find((w) => w.id === id),
    template: (id) => ts.find((t) => t.id === id),
  });
  useLayoutEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => () => { document.title = DEFAULT_TITLE; }, []);
}
