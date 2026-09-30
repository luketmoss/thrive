// #237 — the Day screen's panel shell: the contract #238, #239 and #240 plug into.
//
// A slot component (see `slots.ts`) is a `ComponentType<DayPanelProps>` that
// draws its own card with `Panel` and says one-line things with `PanelNote`.
// Loading and error presentation for panels that read is added here by the
// first panel that needs it (#239), so every panel says it the same way.

import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
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
          <h2 class="day-panel-title" id={id}>{title}</h2>
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
