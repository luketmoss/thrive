// #249 — the app's one `visibilitychange` listener and its one throttle rule.
// #237's Day screen reuses both for `loadHealth`.

/**
 * Call `cb` whenever the page changes *to* visible. The only `document`
 * `visibilitychange` subscription in the app. Returns an unsubscribe.
 */
export function onPageVisible(cb: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

export interface Throttled {
  /** Runs the loader unless one is in flight or the last start was under minIntervalMs ago. */
  run(token: string): Promise<void>;
  /** Stamp the clock as if a run had just started (for loaders that do not go through `run`). */
  markStarted(): void;
}

/**
 * Wrap a loader so it runs at most once per `minIntervalMs`, measured from when
 * a run *starts* (a slow or failed read cannot cause a burst), and never twice
 * at once. Dropped calls are not queued.
 */
export function throttled(
  load: (token: string) => Promise<void>,
  { minIntervalMs = 60_000 }: { minIntervalMs?: number } = {},
): Throttled {
  let inFlight = false;
  let lastStart: number | null = null;
  return {
    async run(token) {
      if (inFlight) return;
      if (lastStart !== null && Date.now() - lastStart < minIntervalMs) return;
      inFlight = true;
      lastStart = Date.now();
      try {
        await load(token);
      } finally {
        inFlight = false;
      }
    },
    markStarted() {
      lastStart = Date.now();
    },
  };
}
