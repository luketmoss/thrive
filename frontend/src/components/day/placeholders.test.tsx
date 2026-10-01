// #237 AC5 — the panel shell contract and the slot registry.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { JournalPanel } from './journal-panel';
import { SLOTS, SLOT_ORDER, slotsFor } from './slots';
import { Panel, PanelNote } from './panel';

afterEach(cleanup);

describe('slots', () => {
  it('orders the four slots and drops health and body on a future day', () => {
    expect(SLOT_ORDER).toEqual(['training', 'health', 'body', 'note']);
    expect(slotsFor('past')).toEqual(['training', 'health', 'body', 'note']);
    expect(slotsFor('today')).toEqual(['training', 'health', 'body', 'note']);
    expect(slotsFor('future')).toEqual(['training', 'note']);
  });

  it('fills the note slot with the journal panel', () => {
    expect(SLOTS.note).toBe(JournalPanel);
  });
});

describe('Panel', () => {
  it('is a section labelled by its h2, with optional sub and action', () => {
    const { container } = render(
      <Panel title="Training" sub="6:30 AM" action={<button>Edit</button>}>
        <PanelNote>Nothing yet.</PanelNote>
      </Panel>,
    );
    const section = container.querySelector('section.day-panel')!;
    const h2 = section.querySelector('h2')!;
    expect(section.getAttribute('aria-labelledby')).toBe(h2.id);
    expect(h2.id).not.toBe('');
    expect(section.querySelector('.day-panel-sub')!.textContent).toBe('6:30 AM');
    expect(section.querySelector('.day-panel-action button')!.textContent).toBe('Edit');
    expect(section.querySelector('p.panel-note')!.textContent).toBe('Nothing yet.');
  });

  it('leaves out sub and action when not given', () => {
    const { container } = render(<Panel title="Note" />);
    expect(container.querySelector('.day-panel-sub')).toBeNull();
    expect(container.querySelector('.day-panel-action')).toBeNull();
  });
});
