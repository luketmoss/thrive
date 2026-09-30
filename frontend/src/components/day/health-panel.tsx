// #239 — the Day screen's Health panel: the night's sleep, resting HR, HRV,
// average stress (once #231 lands) and steps, each against your range. Reads
// the `dailyHealth` signal; the Day screen decides when it loads. The rules
// are in `health-rows.ts`; this only draws them.

import { Fragment } from 'preact';
import { dailyHealth } from '../../state/store';
import { loadHealth } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { Panel, PanelNote, PanelStatus, type DayPanelProps } from './panel';
import { captionText, healthView, type HealthCaption, type HealthRowView } from './health-rows';

function Caption({ c }: { c: HealthCaption }) {
  if (c.kind === 'stages') {
    return (
      <span class="health-caption health-stages">
        {c.items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && ' · '}
            <span class="health-stage">{item}</span>
          </Fragment>
        ))}
      </span>
    );
  }
  if (c.kind === 'range' && c.zone !== 'within') {
    return (
      <span class="health-caption">
        {`Your range ${c.bounds} · `}
        <span class={c.attention ? 'health-attention' : undefined}>
          <span aria-hidden="true">{c.zone === 'above' ? '↑ ' : '↓ '}</span>
          {`${c.zone} your range`}
        </span>
      </span>
    );
  }
  return <span class="health-caption">{captionText(c)}</span>;
}

export function HealthRow({ row }: { row: HealthRowView }) {
  return (
    <div class="health-row" data-metric={row.key}>
      <dt class="health-label">
        {row.label}
        {row.qualifier && <span class="health-qualifier">{` · ${row.qualifier}`}</span>}
      </dt>
      <dd class="health-data">
        {row.value
          ? <span class="health-value">{row.value}</span>
          : <span class="health-value health-value-blank">—</span>}
        {row.captions.map((c, i) => <Caption key={i} c={c} />)}
      </dd>
    </div>
  );
}

export function HealthPanel({ date, state }: DayPanelProps) {
  const { token } = useAuth();
  const tab = dailyHealth.value;
  if (tab.state !== 'loaded') {
    return (
      <Panel title="Health">
        <PanelStatus status={tab.state} what="your health data" onRetry={() => { if (token) void loadHealth(token); }} />
      </Panel>
    );
  }
  const view = healthView(tab.rows, date, state === 'today');
  return (
    <Panel title="Health" sub={view.sub}>
      {view.kind === 'note'
        ? <PanelNote>{view.note}</PanelNote>
        : <dl class="health-list">{view.rows.map((r) => <HealthRow key={r.key} row={r} />)}</dl>}
    </Panel>
  );
}
