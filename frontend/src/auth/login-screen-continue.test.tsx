import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { LoginScreen } from './login-screen';

let state: any;
vi.mock('./auth-context', () => ({ useAuth: () => state }));
vi.mock('../components/shared/thrive-logo', () => ({ ThriveLogo: () => <div /> }));

const base = () => ({
  login: vi.fn(),
  continueAs: vi.fn(),
  ready: true,
  renewing: false,
  renewError: null,
  rememberedUser: { email: 'me@example.com', name: 'Me', picture: '' },
});

describe('LoginScreen with a remembered user (#353)', () => {
  afterEach(cleanup);
  beforeEach(() => {
    state = base();
  });

  it('AC2: primary button names the email and calls continueAs', () => {
    const { getByRole } = render(<LoginScreen />);
    const btn = getByRole('button', { name: 'Continue as me@example.com' });
    fireEvent.click(btn);
    expect(state.continueAs).toHaveBeenCalledTimes(1);
  });

  it('AC2: "Use a different account" runs the full sign-in', () => {
    const { getByRole } = render(<LoginScreen />);
    fireEvent.click(getByRole('button', { name: 'Use a different account' }));
    expect(state.login).toHaveBeenCalledTimes(1);
  });

  it('UX: focus starts on the Continue button', () => {
    const { getByRole } = render(<LoginScreen />);
    expect(document.activeElement).toBe(getByRole('button', { name: /Continue as/ }));
  });

  it('UX: buttons are disabled until the token client exists', () => {
    state.ready = false;
    const { getByRole } = render(<LoginScreen />);
    expect((getByRole('button', { name: /Continue as/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('AC2/UX: a failure is announced in a polite live region and full sign-in stays offered', () => {
    state.renewError = 'Could not sign you in. Try again, or use a different account.';
    const { getByRole } = render(<LoginScreen />);
    const status = getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Could not sign you in');
    expect(getByRole('button', { name: 'Use a different account' })).toBeTruthy();
  });

  it('AC1: with no remembered user the plain sign-in shows', () => {
    state.rememberedUser = null;
    const { getByRole, queryByText } = render(<LoginScreen />);
    expect(getByRole('button', { name: 'Sign in with Google' })).toBeTruthy();
    expect(queryByText(/Continue as/)).toBeNull();
  });
});
