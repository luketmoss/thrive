import { useAuth } from './auth-context';

export function LoginScreen() {
  const { login } = useAuth();
  return (
    <div class="login-screen">
      <div class="login-card">
        <img
          src={`${import.meta.env.BASE_URL}groundwork-favicon.svg`}
          alt=""
          class="login-icon"
          width="64"
          height="64"
        />
        <h1>Groundwork</h1>
        <p>Personal Workout Tracker</p>
        <button class="login-btn" onClick={login}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
