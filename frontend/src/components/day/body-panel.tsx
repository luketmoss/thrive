// #239 AC4 — the Day screen's Body panel: the day's first weigh-in and its
// mean blood pressure, in lb and mmHg. Reads the `bodyMeasurements` signal;
// the day's readings are reduced by `bodyDayOf`, DailySummary U:Y's rules.
// Nothing here is compared or coloured: values are shown as measured.

import { bodyMeasurements } from '../../state/store';
import { loadHealth } from '../../state/actions';
import { useAuth } from '../../auth/auth-context';
import { selectBodyMeasurementRange, type BodyMeasurementRow } from '../../api/health-api';
import { bodyDayOf } from '../../api/body-day';
import { formatWeight } from '../../api/units';
import { clock12 } from '../../day/format';
import { Panel, PanelNote, PanelStatus, type DayPanelProps } from './panel';

export interface BodyRowView {
  key: 'weight' | 'fat' | 'bp';
  label: string;
  /** '' for a blank, shown as "—". */
  value: string;
  /** Read instead of `value` by a screen reader, when set. */
  spoken?: string;
  caption: string;
}

export type BodyView = { kind: 'note'; note: string } | { kind: 'rows'; rows: BodyRowView[] };

/** The Body panel for one day's readings (any order). Pure. */
export function bodyView(readings: readonly BodyMeasurementRow[], isToday: boolean): BodyView {
  const day = bodyDayOf(readings);
  const hasBp = day.systolic_mmhg !== '' || day.diastolic_mmhg !== '';
  if (!day.weighIn && !hasBp) {
    return {
      kind: 'note',
      note: isToday
        ? 'No reading yet today. One taken on the scale or cuff shows here after the next sync.'
        : 'No weigh-in or blood pressure this day.',
    };
  }
  const none = isToday ? 'None yet today.' : 'No reading this day.';
  const rows: BodyRowView[] = [];

  if (day.weighIn) {
    rows.push({ key: 'weight', label: 'Weight', value: formatWeight(day.weight_kg), caption: clock12(day.weighIn.time) });
    const fat = Number(day.fat_ratio_pct);
    rows.push(day.fat_ratio_pct !== '' && Number.isFinite(fat)
      ? { key: 'fat', label: 'Body fat', value: `${fat.toFixed(1)}%`, caption: '' }
      : { key: 'fat', label: 'Body fat', value: '', caption: 'Not measured at this weigh-in.' });
  } else {
    rows.push({ key: 'weight', label: 'Weight', value: '', caption: none });
    rows.push({ key: 'fat', label: 'Body fat', value: '', caption: none });
  }

  if (hasBp) {
    const sys = day.systolic_mmhg || '—';
    const dia = day.diastolic_mmhg || '—';
    const n = day.bp.length;
    rows.push({
      key: 'bp',
      label: 'Blood pressure',
      value: `${sys}/${dia} mmHg`,
      spoken: `${day.systolic_mmhg || 'unknown'} over ${day.diastolic_mmhg || 'unknown'} millimetres of mercury`,
      caption: n > 1 ? `Average of ${n} readings` : `One reading, ${clock12(day.bp[0].time)}`,
    });
  } else {
    rows.push({ key: 'bp', label: 'Blood pressure', value: '', caption: none });
  }
  return { kind: 'rows', rows };
}

function BodyRow({ row }: { row: BodyRowView }) {
  return (
    <div class="health-row" data-metric={row.key}>
      <dt class="health-label">{row.label}</dt>
      <dd class="health-data">
        {!row.value && <span class="health-value health-value-blank">—</span>}
        {row.value && row.spoken && (
          <>
            <span class="sr-only">{row.spoken}</span>
            <span class="health-value" aria-hidden="true">{row.value}</span>
          </>
        )}
        {row.value && !row.spoken && <span class="health-value">{row.value}</span>}
        {row.caption && <span class="health-caption">{row.caption}</span>}
      </dd>
    </div>
  );
}

export function BodyPanel({ date, state }: DayPanelProps) {
  const { token } = useAuth();
  const tab = bodyMeasurements.value;
  if (tab.state !== 'loaded') {
    return (
      <Panel title="Body">
        <PanelStatus status={tab.state} what="your body measurements" onRetry={() => { if (token) void loadHealth(token); }} />
      </Panel>
    );
  }
  const view = bodyView(selectBodyMeasurementRange(tab.rows, date, date), state === 'today');
  return (
    <Panel title="Body">
      {view.kind === 'note'
        ? <PanelNote>{view.note}</PanelNote>
        : <dl class="health-list">{view.rows.map((r) => <BodyRow key={r.key} row={r} />)}</dl>}
    </Panel>
  );
}
