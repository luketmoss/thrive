// #328 — Move up/down in the template editor and the workout planner.
// Rows carry a client-only key (never part of the slot, so it cannot reach the
// sheet), focus is put back on the moved row's button after the re-render
// (moving a keyed DOM node can blur it), and each move is announced in the
// workout tracker's words.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export type MoveDirection = 'up' | 'down';

let seq = 0;

/** A fresh per-row identity; unique within the page, unlike `exercise_id`. */
export function newRowKey(): string {
  seq += 1;
  return `row-${seq}`;
}

/** A copy of `items` with positions `a` and `b` swapped. */
export function swapAt<T>(items: T[], a: number, b: number): T[] {
  const next = [...items];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

export function reorderAnnouncementText(name: string, position: number, total: number): string {
  return `${name} moved to position ${position} of ${total}`;
}

/**
 * The live-region text, a ref for the list container, and `moved()` to call
 * after a move: it focuses the same-direction button of the row whose
 * `data-row-key` is `key` once the list has re-rendered, and announces it.
 */
export function useReorderFocus() {
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ key: string; dir: MoveDirection } | null>(null);

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p || !listRef.current) return;
    pending.current = null;
    const row = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-row-key]')).find(
      (el) => el.dataset.rowKey === p.key,
    );
    row?.querySelector<HTMLElement>(`[data-move="${p.dir}"]`)?.focus();
  });

  const moved = (key: string, dir: MoveDirection, name: string, position: number, total: number) => {
    pending.current = { key, dir };
    setAnnouncement(reorderAnnouncementText(name, position, total));
  };

  return { announcement, listRef, moved };
}
