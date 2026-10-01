// #239 — the Health and Body panels and the shared PanelStatus.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';

const loadHealth = vi.fn(async (_t: string) => {});
vi.mock('../../state/actions', () => ({ loadHealth: (t: string) => loadHealth(t) }));

import { AuthContext, type AuthState } from '../../auth/auth-context';
import { HealthPanel } from './health-panel';
import { BodyPanel, bodyView } from './body-panel';
import { PanelStatus } from './panel';
import { SLOTS } from './slots';
import { dailyHealth, bodyMeasurements } from '../../state/store';
import { DAILY_HEALTH_FIELDS, BODY_MEASUREMENT_FIELDS, type DailyHealthRow, type BodyMeasurementRow } from '../../api/health-api';
import { addDays, type DayState } from '../../day/dates';

afterEach(cleanup);
beforeEach(() => {
  loadHealth.mockClear();
  dailyHealth.value = { state: 'idle' };
  bodyMeasurements.value = { state: 'idle' };
});

const D = '2026-09-26';
const AUTH: AuthState = { token: 'tok', user: null, isAuthenticated: true, login: () => {}, logout: () => {} };

function hr(date: string, over: Partial<Record<string, string>> = {}): DailyHealthRow {
  const r = { sheetRow: 2 } as DailyHealthRow;
  for (const f of DAILY_HEALTH_FIELDS) (r as unknown as Record<string, string>)[f] = '';
  return { ...r, date, ...over } as DailyHealthRow;
}
function bm(over: Partial<BodyMeasurementRow>): BodyMeasurementRow {
  const r = { sheetRow: 2 } as BodyMeasurementRow;
  for (const f of BODY_MEASUREMENT_FIELDS) (r as unknown as Record<string, string>)[f] = '';
  return { ...r, attrib: '0', date: D, ...over };
}

function mount(Comp: typeof HealthPanel, state: DayState = 'past') {
  return render(
    <AuthContext.Provider value={AUTH}>
      <Comp date={D} state={state} today={state === 'today' ? D : '2026-09-30'} />
    </AuthContext.Provider>,
  );
}

describe('slots', () => {
  it('fills the health and body slots', () => {
    expect(SLOTS.health).toBe(HealthPanel);
    expect(SLOTS.body).toBe(BodyPanel);
  });
});

describe('AC5 — PanelStatus', () => {
  it('says Loading… for idle and loading, in a focusable status container', () => {
    for (const status of ['idle', 'loading'] as const) {
      const { container } = render(<PanelStatus status={status} what="x" onRetry={() => {}} />);
      const box = container.querySelector('[role="status"]')!;
      expect(box.getAttribute('tabindex')).toBe('-1');
      expect(box.textContent).toBe('Loading…');
      expect(box.querySelector('button')).toBeNull();
      cleanup();
    }
  });

  it('keeps one container from loading to error, and Try again moves focus to it before retrying', () => {
    const onRetry = vi.fn();
    const { container, rerender } = render(<PanelStatus status="loading" what="your health data" onRetry={onRetry} />);
    const box = container.querySelector('[role="status"]')!;
    rerender(<PanelStatus status="error" what="your health data" onRetry={onRetry} />);
    expect(container.querySelector('[role="status"]')).toBe(box);
    expect(box.querySelector('.panel-note')!.textContent).toBe("Couldn't load your health data.");
    const button = box.querySelector('button.btn.btn-secondary.panel-retry') as HTMLButtonElement;
    expect(button.textContent).toBe('Try again');
    let focusedAtRetry: Element | null = null;
    onRetry.mockImplementation(() => { focusedAtRetry = document.activeElement; });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(focusedAtRetry).toBe(box);
    expect(document.activeElement).toBe(box);
  });
});

describe('AC5 — each panel follows its own tab', () => {
  it('shows loading, and its own error with Try again calling loadHealth directly', () => {
    dailyHealth.value = { state: 'loading' };
    bodyMeasurements.value = { state: 'error' };
    const health = mount(HealthPanel);
    expect(health.container.querySelector('[role="status"]')!.textContent).toBe('Loading…');
    cleanup();
    const body = mount(BodyPanel);
    expect(body.container.querySelector('.panel-note')!.textContent).toBe("Couldn't load your body measurements.");
    fireEvent.click(body.container.querySelector('button')!);
    expect(loadHealth).toHaveBeenCalledWith('tok');
  });

  it('an error in one never changes the other; an empty tab is the no-reading note', () => {
    dailyHealth.value = { state: 'error' };
    bodyMeasurements.value = { state: 'loaded', rows: [] };
    const { container } = mount(BodyPanel);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('.panel-note')!.textContent).toBe('No weigh-in or blood pressure this day.');
  });
});

describe('AC1–AC3 — the Health panel draws its rows', () => {
  const history = Array.from({ length: 20 }, (_, i) =>
    hr(addDays(D, -(i + 1)), { resting_hr: i % 2 ? '49' : '55', hrv: i % 2 ? '41' : '50', steps: '9000' }));

  it('is a dl of div > dt + dd: label, then value, then captions', () => {
    dailyHealth.value = { state: 'loaded', rows: [...history, hr(D, { resting_hr: '52', hrv: '', steps: '9412', sleep_total_s: '25920', sleep_deep_s: '3960' })] };
    const { container } = mount(HealthPanel);
    const rows = [...container.querySelectorAll('dl.health-list > div.health-row')];
    expect(rows.map((r) => r.querySelector('dt')!.textContent)).toEqual(['Sleep · Fri night', 'Resting HR', 'HRV', 'Steps']);
    const sleep = rows[0].querySelector('dd')!;
    expect(sleep.querySelector('.health-value')!.textContent).toBe('7h 12m');
    expect(sleep.querySelector('.health-stage')!.textContent).toBe('Deep 1h 06m');
    const hrv = rows[2].querySelector('dd')!;
    expect(hrv.querySelector('.health-value-blank')!.textContent).toBe('—');
    expect(hrv.textContent).toBe('—No reading this day.');
    expect(rows[1].querySelector('dd')!.textContent).toBe('52 bpmYour range 49–55 bpm · in range');
  });

  it('bolds and colours only the unwelcome direction; the arrow is hidden from screen readers', () => {
    dailyHealth.value = { state: 'loaded', rows: [...history, hr(D, { resting_hr: '60', hrv: '60', steps: '1' })] };
    const { container } = mount(HealthPanel);
    const [rhr, hrvRow, steps] = [...container.querySelectorAll('.health-row')].slice(1).map((r) => r.querySelector('dd')!);
    const attention = rhr.querySelector('.health-attention')!;
    expect(attention.textContent).toBe('↑ above your range');
    expect(attention.querySelector('[aria-hidden="true"]')!.textContent).toBe('↑ ');
    expect(hrvRow.querySelector('.health-attention')).toBeNull();
    expect(hrvRow.textContent).toContain('↑ above your range');
    expect(steps.querySelector('.health-attention')).toBeNull();
    expect(steps.textContent).toContain('↓ below your range');
    expect(container.querySelectorAll('.health-attention')).toHaveLength(1);
  });

  it('on today before the sync: one note and the sub', () => {
    dailyHealth.value = { state: 'loaded', rows: history };
    const { container } = mount(HealthPanel, 'today');
    expect(container.querySelector('.day-panel-sub')!.textContent).toBe('Not synced yet today');
    expect(container.querySelectorAll('.panel-note')).toHaveLength(1);
    expect(container.querySelector('dl')).toBeNull();
  });

  it('keeps showing loaded rows, not the status, while a reload runs', () => {
    dailyHealth.value = { state: 'loaded', rows: [hr(D, { steps: '5' })] };
    const { container } = mount(HealthPanel);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('dl')).not.toBeNull();
  });
});

describe('AC4 — Body', () => {
  const scale = (time: string, weight: string, fat = '') =>
    bm({ grpid: time, kind: 'scale', time, measured_at_utc: `${D}T${time}:00-06:00`, weight_kg: weight, fat_ratio_pct: fat });
  const bp = (time: string, sys: string, dia: string) =>
    bm({ grpid: `bp${time}`, kind: 'bp', time, measured_at_utc: `${D}T${time}:00-06:00`, systolic_mmhg: sys, diastolic_mmhg: dia });

  it('shows the first weigh-in in lb with its time, its body fat, and the mean BP', () => {
    expect(bodyView([scale('19:10', '82.0', '19.0'), scale('06:58', '80.9', '18.2'), bp('07:04', '125', '80'), bp('07:08', '126', '81')], false)).toEqual({
      kind: 'rows',
      rows: [
        { key: 'weight', label: 'Weight', value: '178.4 lb', caption: '6:58 AM' },
        { key: 'fat', label: 'Body fat', value: '18.2%', caption: '' },
        { key: 'bp', label: 'Blood pressure', value: '126/81 mmHg', spoken: '126 over 81 millimetres of mercury', caption: 'Average of 2 readings' },
      ],
    });
  });

  it('says one reading with its time', () => {
    const v = bodyView([bp('07:04', '126', '81')], false);
    expect(v.kind === 'rows' && v.rows[2].caption).toBe('One reading, 7:04 AM');
  });

  it('says a blank fat is not measured, and the missing kind is "No reading this day." or "None yet today."', () => {
    const past = bodyView([scale('06:58', '80.9')], false);
    expect(past.kind === 'rows' && past.rows.map((r) => [r.value, r.caption])).toEqual([
      ['178.4 lb', '6:58 AM'], ['', 'Not measured at this weigh-in.'], ['', 'No reading this day.'],
    ]);
    const today = bodyView([bp('07:04', '126', '81')], true);
    expect(today.kind === 'rows' && today.rows.slice(0, 2).map((r) => [r.value, r.caption])).toEqual([
      ['', 'None yet today.'], ['', 'None yet today.'],
    ]);
  });

  it('shows one note on a day with no reading', () => {
    expect(bodyView([], false)).toEqual({ kind: 'note', note: 'No weigh-in or blood pressure this day.' });
    expect(bodyView([], true)).toEqual({ kind: 'note', note: 'No reading yet today. One taken on the scale or cuff shows here after the next sync.' });
  });

  it('reads BP as words with the visible value hidden, in the dl structure, for its own day only', () => {
    bodyMeasurements.value = {
      state: 'loaded',
      rows: [bp('07:04', '126', '81'), bm({ grpid: 'x', kind: 'bp', date: '2026-09-25', systolic_mmhg: '140', diastolic_mmhg: '90', measured_at_utc: '2026-09-25T07:00:00-06:00' })],
    };
    const { container } = mount(BodyPanel);
    const dd = container.querySelector('dl.health-list > div[data-metric="bp"] > dd')!;
    expect(dd.querySelector('.sr-only')!.textContent).toBe('126 over 81 millimetres of mercury');
    const shown = dd.querySelector('.health-value')!;
    expect(shown.textContent).toBe('126/81 mmHg');
    expect(shown.getAttribute('aria-hidden')).toBe('true');
    expect(dd.textContent).toContain('One reading, 7:04 AM');
    expect(container.querySelector('.health-attention')).toBeNull();
  });
});
