// Focus on route change (#256): a forward move focuses the new screen's
// heading, and Back returns focus to the control that opened the screen.
//
// One rule in one place. The router tells us about a change before the old
// screen leaves the DOM (`onRouteChange`), which is when the opener is captured;
// `RouteFocus` acts after the new screen has committed. Replace moves and moves
// within one route name are left alone: the Day and Calendar screens own those.

import { useEffect } from 'preact/hooks';
import { currentRoute, onRouteChange, type RouteChange } from './router';

/** How a control is found again: its `data-focus-key`, its `id`, or an `<a>`'s `href`. */
export interface FocusKey {
  by: 'key' | 'id' | 'href';
  value: string;
}

/**
 * The key of a focused element (AC3): its closest `[data-focus-key]` (within
 * `root` when given), else its own `id`, else its `href` if it is an `<a>`.
 * Nothing else (no index, no text): an element without one has no key.
 */
export function keyOf(el: Element | null, root?: Element | null): FocusKey | null {
  if (!el) return null;
  const keyed = el.closest('[data-focus-key]');
  if (keyed && (!root || root.contains(keyed))) {
    const value = keyed.getAttribute('data-focus-key');
    if (value) return { by: 'key', value };
  }
  if (el.id) return { by: 'id', value: el.id };
  if (el.tagName === 'A') {
    const href = el.getAttribute('href');
    if (href) return { by: 'href', value: href };
  }
  return null;
}

/** The first element under `root` with `key`, or null. Compared as strings: no selector escaping. */
export function findByKey(root: ParentNode, key: FocusKey): HTMLElement | null {
  const [selector, attr] =
    key.by === 'key' ? ['[data-focus-key]', 'data-focus-key']
    : key.by === 'id' ? ['[id]', 'id']
    : ['a[href]', 'href'];
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (el.getAttribute(attr) === key.value) return el;
  }
  return null;
}

/** A screen's heading (AC1): `[data-screen-heading]`, else the first `h1`, else the first `h2`. */
export function headingOf(main: ParentNode): HTMLElement | null {
  return main.querySelector<HTMLElement>('[data-screen-heading]')
    ?? main.querySelector<HTMLElement>('h1')
    ?? main.querySelector<HTMLElement>('h2');
}

// Openers by the hash of the screen they were on: memory only, per page load.
const MAX_REMEMBERED = 50;
const memory = new Map<string, FocusKey>();

export function remember(hash: string, key: FocusKey | null): void {
  memory.delete(hash);
  if (!key) return;
  memory.set(hash, key);
  if (memory.size > MAX_REMEMBERED) memory.delete(memory.keys().next().value as string);
}

export function remembered(hash: string): FocusKey | undefined {
  return memory.get(hash);
}

// True only while a focus() call of ours runs, so a screen's onFocus can tell a
// script restore from a Tab arrival (AC5: Trends must not select a day).
let restoring = false;
export function isRestoringFocus(): boolean {
  return restoring;
}

function tryFocus(el: HTMLElement): boolean {
  restoring = true;
  try {
    el.focus({ preventScroll: true });
  } finally {
    restoring = false;
  }
  return document.activeElement === el;
}

function mainOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main');
}

interface Pending {
  kind: 'push' | 'pop';
  toHash: string;
  /** A `data-focus-key` control that held focus on departure: kept if the new screen has it too. */
  carry: FocusKey | null;
  /** The element that held focus on departure, so a survivor is not mistaken for an autoFocus. */
  departed: Element | null;
}

let pending: Pending | null = null;

/** On a heading while it holds the focus a route change gave it (#256). */
export const ROUTE_FOCUS_ATTR = 'data-route-focus';

/** Captures the opener (AC3), before the old screen is removed. */
function capture(change: RouteChange): void {
  if (change.kind === 'replace' || change.from.name === change.to.name) return;
  const main = mainOf();
  const active = document.activeElement;
  const inMain = !!main && !!active && active !== main && main.contains(active);
  const key = inMain ? keyOf(active, main) : null;
  // Focus outside `main` (the tab bar) is not remembered, and forgets an older opener.
  remember(change.fromHash, key);
  pending = {
    kind: change.kind,
    toHash: change.toHash,
    carry: key?.by === 'key' ? key : null,
    departed: inMain ? active : null,
  };
}

function offScreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom < 0 || r.top > window.innerHeight;
}

/** Moves focus for an arrival, after the new screen has committed. */
function arrive(p: Pending): void {
  const main = mainOf();
  if (!main) return;
  const active = document.activeElement;
  // Something on the new screen took focus on mount (an autoFocus field): leave it.
  if (active && active !== main && main.contains(active) && active !== p.departed) return;

  if (p.kind === 'pop') {
    // Back: the remembered opener, scroll left to the browser (AC3).
    const key = remembered(p.toHash);
    const el = key ? findByKey(main, key) : null;
    if (el && tryFocus(el)) {
      if (offScreen(el)) el.scrollIntoView({ block: 'nearest' });
      return;
    }
  } else {
    // A push never restores (AC3); it starts at the top (AC1).
    window.scrollTo(0, 0);
  }

  // A control both screens render keeps focus (AC1: Library's switch).
  const shared = p.carry ? findByKey(main, p.carry) : null;
  if (shared && tryFocus(shared)) return;

  const heading = headingOf(main);
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    // Marks this focus as ours, for global.css's no-ring rule: a heading a screen
    // focuses itself (Day's h1 after Today, a Day panel title after Try again)
    // keeps its own ring.
    heading.setAttribute(ROUTE_FOCUS_ATTR, '');
    heading.addEventListener('blur', () => heading.removeAttribute(ROUTE_FOCUS_ATTR), { once: true });
    if (tryFocus(heading)) return;
    heading.removeAttribute(ROUTE_FOCUS_ATTR);
  }
  // No heading (or it would not take focus): `main`, never `body` (AC1, AC4).
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  tryFocus(main);
}

/** Rendered once, beside `<Router />` inside `main`. Renders nothing. */
export function RouteFocus(): null {
  const route = currentRoute.value;
  useEffect(() => onRouteChange(capture), []);
  useEffect(() => {
    const p = pending;
    pending = null;
    if (p) arrive(p);
  }, [route]);
  return null;
}
