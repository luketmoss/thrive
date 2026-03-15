import { useAuth } from '../../auth/auth-context';
import { ThemeToggle } from '../shared/theme-toggle';
import { workouts, exercises, templates } from '../../state/store';

export function SettingsScreen() {
  const { user, logout } = useAuth();

  return (
    <div class="screen settings-screen">
      <header class="screen-header">
        <h1>Settings</h1>
      </header>
      <div class="screen-body">
        <div class="settings-section">
          <h2>Appearance</h2>
          <div class="settings-row">
            <span>Theme</span>
            <ThemeToggle />
          </div>
        </div>

        <div class="settings-section">
          <h2>Data</h2>
          <div class="settings-row">
            <span>Workouts</span>
            <span class="settings-detail">{workouts.value.length} logged</span>
          </div>
          <div class="settings-row">
            <span>Exercises</span>
            <span class="settings-detail">{exercises.value.length} in library</span>
          </div>
          <div class="settings-row">
            <span>Templates</span>
            <span class="settings-detail">{templates.value.length} saved</span>
          </div>
        </div>

        <div class="settings-section">
          <h2>Account</h2>
          {user && (
            <div class="settings-row">
              <span>{user.name}</span>
              <span class="settings-detail">{user.email}</span>
            </div>
          )}
          <button class="settings-btn danger" onClick={logout}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
