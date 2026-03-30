import { useAuth } from './auth-context';
import { ThriveLogo } from '../components/shared/thrive-logo';

export function LoginScreen() {
  const { login } = useAuth();
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
