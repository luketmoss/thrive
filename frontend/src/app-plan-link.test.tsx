// #143 AC6: almanac's Plan link survives signing in.
//
// Signing in (GIS token model) happens in a popup with no redirect, so nothing
// between the login screen and the loaded app may touch the hash. This drives
// the real App shell and router, with the auth state and data load stubbed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';

const auth = signal<{ token: string | null }>({ token: null });
const login = vi.fn();
const loadInitialData = vi.fn();

vi.mock('./auth/auth-provider', () => ({
  AuthProvider: ({ children }: { children: ComponentChildren }) => children,
}));
vi.mock('./auth/auth-context', () => ({
  useAuth: () => ({
    token: auth.value.token,
    user: null,
    isAuthenticated: !!auth.value.token,
    login,
    logout: vi.fn(),
  }),
}));
vi.mock('./state/actions', () => ({
  loadInitialData: (token: string) => loadInitialData(token),
  startWorkout: vi.fn(),
  saveWorkoutForLater: vi.fn(),
}));

const LINK = '#/workout/new?plan=2026-09-24';
window.location.hash = LINK;

const { App } = await import('./app');
const { loading, templates } = await import('./state/store');

afterEach(() => cleanup());

describe('the Plan link through sign-in (#143 AC6)', () => {
  it('shows the login screen, then lands on the planner for the linked date', async () => {
    loading.value = true;
    templates.value = [];
    const { container, findByText } = render(<App />);

    // Signed out: the login screen, with the link still in the address bar.
    await findByText('Sign in with Google');
    fireEvent.click(await findByText('Sign in with Google'));
    expect(login).toHaveBeenCalled();
    expect(window.location.hash).toBe(LINK);

    // The popup returns a token; data loads.
    auth.value = { token: 'fresh-token' };
    await waitFor(() => expect(loadInitialData).toHaveBeenCalledWith('fresh-token'));
    expect(container.querySelector('.loading-screen')).not.toBeNull();
    loading.value = false;

    // Plan mode, straight to the template picker, then the planner on the date.
    await findByText('Choose a template');
    fireEvent.click(await findByText('Build Custom'));
    await waitFor(() =>
      expect(container.querySelector<HTMLInputElement>('#planner-date')?.value).toBe('2026-09-24'),
    );
    expect(window.location.hash).toBe(LINK);
  });
});
