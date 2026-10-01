// Test harness for the router's history depth (#264). Not a test file itself.
//
// Each `vi.resetModules()` import of the router adds another hashchange
// listener to `window`, and a stale router left listening would stamp new
// history entries before the fresh one sees them. Recording every hashchange
// listener lets `freshRouter` drop the stale ones first. Import this module
// before anything that imports the router, so the first router is recorded too.

import { vi } from 'vitest';

type Router = typeof import('./router');

const hashListeners: EventListenerOrEventListenerObject[] = [];
const realAdd = window.addEventListener;
window.addEventListener = function (
  this: Window,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) {
  if (!listener) return;
  if (type === 'hashchange') hashListeners.push(listener);
  realAdd.call(this, type, listener, options);
} as typeof window.addEventListener;

/** Drop every router loaded so far, then load a fresh one on `hash` with `state` (a reload). */
export async function freshRouter(hash: string, state: unknown = null): Promise<Router> {
  for (const listener of hashListeners.splice(0)) window.removeEventListener('hashchange', listener);
  vi.resetModules();
  window.history.replaceState(state, '', hash === '' ? window.location.pathname : hash);
  return import('./router');
}

/** Run `move`, and resolve once the hashchange it causes has been handled. */
export function nextHashchange(move: () => void): Promise<void> {
  return new Promise((resolve) => {
    realAdd.call(window, 'hashchange', () => setTimeout(resolve, 0), { once: true });
    move();
  });
}

/** The current entry's depth stamp. */
export function stampNow(): { depth: number; prev: string | null } | undefined {
  return (window.history.state as { thrive?: { depth: number; prev: string | null } } | null)?.thrive;
}
