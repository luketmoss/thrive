// #246 AC2 — the picker: labelled checkboxes, a cap that stays reachable, every way out.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { CustomMetricsPicker } from './custom-metrics-picker';

afterEach(cleanup);

function Harness({ initial, onClose = () => {} }: { initial: string[]; onClose?: () => void }) {
  const [ids, setIds] = useState(initial);
  return h(CustomMetricsPicker, { selected: ids, onChange: setIds, onClose });
}
const boxes = (c: Element) => [...c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const FOUR = ['resting_hr', 'hrv', 'sleep_total', 'sleep_deep'];

describe('CustomMetricsPicker', () => {
  it('is a labelled modal dialog listing 20 labelled checkboxes under six headings', () => {
    const { container } = render(h(Harness, { initial: [] }));
    const dlg = container.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)!.textContent).toBe('Choose metrics');
    expect(boxes(container)).toHaveLength(20);
    expect([...container.querySelectorAll('h3')].map((x) => x.textContent))
      .toEqual(['Recovery', 'Sleep', 'Fitness', 'Body', 'Blood Pressure', 'Activity']);
    expect(container.querySelector('label')!.textContent).toBe('Resting HR');
  });

  it('focuses the first checkbox on open', () => {
    const { container } = render(h(Harness, { initial: [] }));
    expect(document.activeElement).toBe(boxes(container)[0]);
  });

  it('applies a check at once, and an uncheck', () => {
    const { container } = render(h(Harness, { initial: [] }));
    fireEvent.click(boxes(container)[0]);
    expect(boxes(container)[0].checked).toBe(true);
    fireEvent.click(boxes(container)[0]);
    expect(boxes(container)[0].checked).toBe(false);
  });

  it('at four, unchecked rows stay focusable, are aria-disabled, ignore clicks, and a status says why', () => {
    const { container } = render(h(Harness, { initial: FOUR }));
    const unchecked = boxes(container).filter((b) => !b.checked);
    expect(unchecked).toHaveLength(16);
    for (const b of unchecked) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
    }
    fireEvent.click(unchecked[0]);
    expect(boxes(container).filter((b) => b.checked)).toHaveLength(4);
    expect(unchecked[0].checked).toBe(false);
    expect(container.querySelector('[role="status"]')!.textContent).toBe('4 selected — remove one to add another.');
  });

  it('unchecking one re-enables the rest and clears the status', () => {
    const { container } = render(h(Harness, { initial: FOUR }));
    fireEvent.click(boxes(container)[0]);
    expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
    fireEvent.click(boxes(container)[10]);
    expect(boxes(container)[10].checked).toBe(true);
  });

  it('Done, Escape and an overlay click each close', () => {
    const onClose = vi.fn();
    const { container } = render(h(Harness, { initial: [], onClose }));
    fireEvent.click(container.querySelector('.trends-picker-done')!);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('a click inside the dialog does not close it', () => {
    const onClose = vi.fn();
    const { container } = render(h(Harness, { initial: [], onClose }));
    fireEvent.click(container.querySelector('.trends-picker-title')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Tab wraps inside the dialog', () => {
    const { container } = render(h(Harness, { initial: [] }));
    (container.querySelector('.trends-picker-done') as HTMLElement).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(boxes(container)[0]);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(container.querySelector('.trends-picker-done'));
  });
});
