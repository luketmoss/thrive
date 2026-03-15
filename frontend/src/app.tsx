import { useEffect } from 'preact/hooks';
import { AuthProvider } from './auth/auth-provider';
import { useAuth } from './auth/auth-context';
import { LoginScreen } from './auth/login-screen';
import { BottomNav } from './components/shared/bottom-nav';
import { Toast } from './components/shared/toast';
import { loadInitialData } from './state/actions';
import { loading } from './state/store';
import { currentRoute } from './router/router';
import { ActivitiesScreen } from './components/activities/activities-screen';
import { TemplatesScreen } from './components/templates/templates-screen';
import { SettingsScreen } from './components/settings/settings-screen';
import { ExercisesScreen } from './components/exercises/exercises-screen';
import { WorkoutFlow } from './components/workout/workout-flow';
import { WorkoutDetail } from './components/activities/workout-detail';
import { ManageLabelsScreen } from './components/settings/manage-labels-screen';

function Router() {
  const route = currentRoute.value;

  switch (route.name) {
    case 'activities':
      return <ActivitiesScreen />;
    case 'workout-new':
      return <WorkoutFlow />;
    case 'workout-active':
      return <WorkoutFlow workoutId={route.params.id} />;
    case 'workout-detail':
      return <WorkoutDetail workoutId={route.params.id} />;
    case 'workout-edit':
      return <WorkoutDetail workoutId={route.params.id} />;
    case 'templates':
    case 'template-new':
    case 'template-edit':
      return <TemplatesScreen />;
    case 'exercises':
      return <ExercisesScreen />;
    case 'manage-labels':
      return <ManageLabelsScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <ActivitiesScreen />;
  }
}

function AuthenticatedApp() {
  const { token } = useAuth();

  useEffect(() => {
    if (!token) return;
    loadInitialData(token);
  }, [token]);

  if (loading.value) {
    return (
      <div class="loading-screen">
        <div class="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div class="app-layout">
      <main class="app-content">
        <Router />
      </main>
      <BottomNav />
    </div>
  );
}

function AppContent() {
  const { isAuthenticated } = useAuth();
  return (
    <>
      {isAuthenticated ? <AuthenticatedApp /> : <LoginScreen />}
      <Toast />
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
