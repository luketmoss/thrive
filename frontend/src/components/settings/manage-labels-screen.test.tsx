// #280 AC2 — the icon-only Back on Manage Labels has an accessible name.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/preact';
import { h } from 'preact';
import { ManageLabelsScreen } from './manage-labels-screen';

afterEach(cleanup);

describe('Manage Labels back button (#280)', () => {
  it('is named "Back"', () => {
    render(<ManageLabelsScreen />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });
});
