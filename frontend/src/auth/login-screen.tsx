import { useEffect, useRef } from 'preact/hooks';
import { useAuth } from './auth-context';
import { ThriveLogo } from '../components/shared/thrive-logo';

export function LoginScreen() {
  const { login, rememberedUser, ready, renewing, renewError, continueAs } = useAuth();
  const continueRef = useRef<HTMLButtonElement>(null);

  // #353: the Continue button is the screen's one action; start on it.
  useEffect(() => {
    if (rememberedUser) continueRef.current?.focus();
  }, [!!rememberedUser]);

  if (rememberedUser) {
    return (
      <div class="login-screen">
        <div class="login-card">
          <ThriveLogo size={64} class="login-icon" />
          <h1>Thrive</h1>
          <p>Welcome back{rememberedUser.name ? `, ${rememberedUser.name}` : ''}.</p>
          <button
            ref={continueRef}
            class="login-btn"
            onClick={continueAs}
            disabled={!ready || renewing}
            aria-busy={renewing || undefined}
          >
            Continue as {rememberedUser.email}
          </button>
          <p class="login-error" role="status" aria-live="polite">
            {renewError ?? ''}
          </p>
          <button class="login-link" onClick={login} disabled={!ready}>
            Use a different account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="login-screen">
      <div class="login-card">
        <ThriveLogo size={64} class="login-icon" />
        <h1>Thrive</h1>
        <p>Stronger every day.</p>
        <button class="login-btn" onClick={login}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
