import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';
import { LoginScreen } from './login-screen';

vi.mock('./auth-context', () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

vi.mock('../components/shared/thrive-logo', () => ({
  ThriveLogo: (props: any) => <div data-testid="thrive-logo" {...props} />,
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1: renders tagline "Stronger every day." as subtitle', () => {
    const { container } = render(<LoginScreen />);
    const subtitle = container.querySelector('.login-card p');
    expect(subtitle).not.toBeNull();
    expect(subtitle!.textContent).toBe('Stronger every day.');
  });

  it('AC2: does not render "Personal Workout Tracker"', () => {
    const { container } = render(<LoginScreen />);
    expect(container.textContent).not.toContain('Personal Workout Tracker');
  });

  it('AC1: tagline appears between title and sign-in button', () => {
    const { container } = render(<LoginScreen />);
    const children = Array.from(container.querySelector('.login-card')!.children);
    const h1Index = children.findIndex((el) => el.tagName === 'H1');
    const pIndex = children.findIndex((el) => el.tagName === 'P');
    const buttonIndex = children.findIndex((el) => el.tagName === 'BUTTON');
    expect(h1Index).toBeLessThan(pIndex);
    expect(pIndex).toBeLessThan(buttonIndex);
  });

  it('AC3: tagline uses existing p element', () => {
    const { container } = render(<LoginScreen />);
    const subtitle = container.querySelector('.login-card p');
    expect(subtitle).not.toBeNull();
  });
});
