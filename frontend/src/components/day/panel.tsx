// #237 — the Day screen's panel shell: the contract #238, #239 and #240 plug into.
//
// A slot component (see `slots.ts`) is a `ComponentType<DayPanelProps>` that
// draws its own card with `Panel` and says one-line things with `PanelNote`.
// Panels that read a store signal say loading and failure with `PanelStatus`
// (#239), so every panel says it the same way.

import type { ComponentChildren } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import type { DayState } from '../../day/dates';

/** What the Day screen passes every slot. Dates are `YYYY-MM-DD` in Denver. */
export interface DayPanelProps {
  date: string;
  state: DayState;
  today: string;
}

export interface PanelProps {
  /** The `h2` that labels the section. Shown upper case. */
  title: string;
  /** Optional line under the title, such as a time or a range. */
  sub?: ComponentChildren;
  /** Optional control at the right of the title row. */
  action?: ComponentChildren;
  children?: ComponentChildren;
}

/** One card on the Day screen: a `section` labelled by its `h2` title. */
export function Panel({ title, sub, action, children }: PanelProps) {
  const id = useId();
  return (
    <section class="day-panel" aria-labelledby={id}>
      <div class="day-panel-head">
        <div class="day-panel-heading">
          <h2 class="day-panel-title" id={id} tabIndex={-1}>{title}</h2>
          {sub != null && <p class="day-panel-sub">{sub}</p>}
        </div>
        {action != null && <div class="day-panel-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A one-line message inside a panel, at `--text-sm` in `--color-text-muted`. */
export function PanelNote({ children }: { children: ComponentChildren }) {
  return <p class="panel-note">{children}</p>;
}

export interface PanelStatusProps {
  /** A store signal's state short of `loaded`. A panel with loaded rows renders them instead. */
  status: 'idle' | 'loading' | 'error';
  /** What failed to load, in words: "your health data". */
  what: string;
  /** Load again. Called by Try again, as a user's request (no throttle). */
  onRetry: () => void;
  /**
   * Where focus goes when the status goes away holding it (#276). Defaults to
   * the enclosing panel's `h2`; the Calendar passes the pressed shading button.
   */
  returnFocusTo?: () => HTMLElement | null | undefined;
}

/**
 * Loading and failure for a panel that reads (#239 AC5). One persistent
 * `role="status"` container, so the change from loading to error is announced
 * once, politely. Try again moves focus to that container before the button
 * goes, so focus never falls to `body`.
 *
 * When the status unmounts while it holds focus (a retry succeeded), focus is
 * handed to the panel's heading instead of falling to `body` (#276). It never
 * takes focus on mount, and stands down if anything but `body` holds focus by
 * then or the target has left the document (a date change).
 */
export function PanelStatus({ status, what, onRetry, returnFocusTo }: PanelStatusProps) {
  const ref = useRef<HTMLDivElement>(null);
  const returnRef = useRef(returnFocusTo);
  returnRef.current = returnFocusTo;
  useLayoutEffect(() => () => {
    const node = ref.current;
    if (!node || document.activeElement !== node) return;
    const heading = node.closest('.day-panel')?.querySelector<HTMLElement>('.day-panel-title');
    // After Preact's commit, so a date change has already removed the panel.
    queueMicrotask(() => {
      const target = returnRef.current ? returnRef.current() : heading;
      const active = document.activeElement;
      if (target && target.isConnected && (active === document.body || active == null)) target.focus();
    });
  }, []);
  return (
    <div class="panel-status" role="status" tabIndex={-1} ref={ref}>
      {status === 'error' ? (
        <>
          <PanelNote>{`Couldn't load ${what}.`}</PanelNote>
          <button
            type="button"
            class="btn btn-secondary panel-retry"
            onClick={() => {
              ref.current?.focus();
              onRetry();
            }}
          >
            Try again
          </button>
        </>
      ) : (
        <PanelNote>Loading…</PanelNote>
      )}
    </div>
  );
}
