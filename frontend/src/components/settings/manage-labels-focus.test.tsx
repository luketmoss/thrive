// #339 AC5: deleting a label removes the opener; focus lands on the heading.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { labels } from '../../state/store';

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../state/actions', () => ({
  addLabel: vi.fn(),
  renameLabel: vi.fn(),
  updateLabelColor: vi.fn(),
  removeLabel: vi.fn(async (l: any) => {
    labels.value = labels.value.filter((x) => x.id !== l.id);
    return 0;
  }),
}));

import { ManageLabelsScreen } from './manage-labels-screen';

afterEach(cleanup);

describe('Manage Labels delete focus (#339 AC5)', () => {
  it('moves focus to the heading when the deleted label takes its Delete button with it', async () => {
    labels.value = [{ id: 'l1', name: 'Push', colorKey: 'blue', sheetRow: 2 } as any];
    const { container, getByText } = render(<ManageLabelsScreen />);
    const del = [...container.querySelectorAll<HTMLElement>('button')].find((b) =>
      /delete/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
    )!;
    del.focus();
    fireEvent.click(del);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    fireEvent.click(getByText('Delete', { selector: '.modal-content button' }));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('h1')));
    expect(container.querySelector('h1')!.getAttribute('tabindex')).toBe('-1');
  });
});
