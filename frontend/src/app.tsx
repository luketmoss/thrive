import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { AuthProvider } from './auth/auth-provider';
import { useAuth } from './auth/auth-context';
import { LoginScreen } from './auth/login-screen';
import { BottomNav } from './components/shared/bottom-nav';
import { Toast } from './components/shared/toast';
import { loadInitialData, workoutsRefresh, libraryRefresh } from './state/actions';
import { loading, pendingSyncCount, isSyncing } from './state/store';
import { onPageVisible } from './state/page-visible';
import { currentRoute } from './router/router';
import { RouteFocus } from './router/route-focus';
import { ActivitiesScreen } from './components/activities/activities-screen';
import { TemplatesScreen } from './components/templates/templates-screen';
import { SettingsScreen } from './components/settings/settings-screen';
import { ExercisesScreen } from './components/exercises/exercises-screen';
import { WorkoutFlow } from './components/workout/workout-flow';
import { WorkoutDetail } from './components/activities/workout-detail';
import { WorkoutEdit } from './components/activities/workout-edit';
import { DayScreen } from './components/day/day-screen';
import { CalendarScreen } from './components/calendar/calendar-screen';
import { TrendsScreen } from './components/trends/trends-screen';
import { ManageLabelsScreen } from './components/settings/manage-labels-screen';

function Router() {
  const route = currentRoute.value;

  switch (route.name) {
    case 'day':
      return <DayScreen />;
    case 'calendar':
      return <CalendarScreen />;
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
      return <DayScreen />;
  }
}

const EDIT_ROUTES = new Set(['workout-new', 'workout-active', 'workout-edit']);
// #252: TemplatesScreen renders TemplateEditor full-screen on these two.
const LIBRARY_EDIT_ROUTES = new Set([...EDIT_ROUTES, 'template-new', 'template-edit']);

function queueBusy(): boolean {
  return pendingSyncCount.value > 0 || isSyncing.value;
}

/** True while a refresh of workouts/sets could overwrite something in progress (#249 AC3). */
function refreshHeld(): boolean {
  return EDIT_ROUTES.has(currentRoute.value.name) || queueBusy();
}

/** The same for exercises/templates/labels (#252 AC3): also the template editor routes. */
function libraryRefreshHeld(): boolean {
  return LIBRARY_EDIT_ROUTES.has(currentRoute.value.name) || queueBusy();
}

/**
 * Refresh on the page coming back into view; hold each loader while an edit it
 * could clobber is in progress, and run it once when its hold lifts.
 */
function useRefreshOnVisible(token: string | null) {
  useEffect(() => {
    if (!token) return;
    const loaders = [
      { run: (t: string) => workoutsRefresh.run(t), held: refreshHeld, pending: false },
      { run: (t: string) => libraryRefresh.run(t), held: libraryRefreshHeld, pending: false },
    ];
    const unsubscribe = onPageVisible(() => {
      for (const l of loaders) {
        if (l.held()) l.pending = true;
        else void l.run(token);
      }
    });
    const stop = effect(() => {
      for (const l of loaders) {
        if (l.held() || !l.pending) continue;
        l.pending = false;
        void l.run(token);
      }
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
      {/* #256: tabindex so focus can land on main when a screen has no heading. */}
      <main class="app-content" tabIndex={-1}>
        <Router />
        <RouteFocus />
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
