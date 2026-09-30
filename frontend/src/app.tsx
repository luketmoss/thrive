import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { AuthProvider } from './auth/auth-provider';
import { useAuth } from './auth/auth-context';
import { LoginScreen } from './auth/login-screen';
import { BottomNav } from './components/shared/bottom-nav';
import { Toast } from './components/shared/toast';
import { loadInitialData, workoutsRefresh } from './state/actions';
import { loading, pendingSyncCount, isSyncing } from './state/store';
import { onPageVisible } from './state/page-visible';
import { currentRoute } from './router/router';
import { ActivitiesScreen } from './components/activities/activities-screen';
import { TemplatesScreen } from './components/templates/templates-screen';
import { SettingsScreen } from './components/settings/settings-screen';
import { ExercisesScreen } from './components/exercises/exercises-screen';
import { WorkoutFlow } from './components/workout/workout-flow';
import { WorkoutDetail } from './components/activities/workout-detail';
import { WorkoutEdit } from './components/activities/workout-edit';
import { DayPlaceholder } from './components/day/day-placeholder';
import { TrendsScreen } from './components/trends/trends-screen';
import { ManageLabelsScreen } from './components/settings/manage-labels-screen';

function Router() {
  const route = currentRoute.value;

  switch (route.name) {
    case 'day':
      return <DayPlaceholder />;
    case 'trends':
      return <TrendsScreen />;
    case 'activities':
      return <ActivitiesScreen />;
    case 'workout-new':
      return <WorkoutFlow planDate={route.params.plan} />;
    case 'workout-active':
      return <WorkoutFlow workoutId={route.params.id} />;
    case 'workout-detail':
      return <WorkoutDetail workoutId={route.params.id} />;
    case 'workout-edit':
      return <WorkoutEdit workoutId={route.params.id} />;
    case 'templates':
    case 'template-new':
    case 'template-detail':
    case 'template-edit':
      return <TemplatesScreen />;
    case 'exercises':
      return <ExercisesScreen />;
    case 'manage-labels':
      return <ManageLabelsScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <DayPlaceholder />;
  }
}

const EDIT_ROUTES = new Set(['workout-new', 'workout-active', 'workout-edit']);

/** True while a refresh of workouts/sets could overwrite something in progress (#249 AC3). */
function refreshHeld(): boolean {
  return (
    EDIT_ROUTES.has(currentRoute.value.name) ||
    pendingSyncCount.value > 0 ||
    isSyncing.value
  );
}

/** Refresh on the page coming back into view; hold it while an edit is in progress. */
function useRefreshOnVisible(token: string | null) {
  useEffect(() => {
    if (!token) return;
    let pending = false;
    const unsubscribe = onPageVisible(() => {
      if (refreshHeld()) {
        pending = true;
        return;
      }
      void workoutsRefresh.run(token);
    });
    const stop = effect(() => {
      if (refreshHeld() || !pending) return;
      pending = false;
      void workoutsRefresh.run(token);
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, [token]);
}

function AuthenticatedApp() {
  const { token } = useAuth();
  useRefreshOnVisible(token);

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
