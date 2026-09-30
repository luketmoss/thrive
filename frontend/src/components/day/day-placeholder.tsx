import { navigate } from '../../router/router';

/** Today's date for display, from the device clock. */
function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Stand-in for the Day screen (#237 replaces it). Keeps the landing screen useful. */
export function DayPlaceholder() {
  return (
    <div class="screen day-screen">
      <header class="screen-header">
        <h1>Day</h1>
      </header>
      <div class="screen-body">
        <p class="placeholder-date">{todayLabel()}</p>
        <p class="placeholder-copy">
          The Day view is on its way. For now, your workouts are in Activities.
        </p>
        <a class="btn btn-secondary placeholder-link" href="#/activities"
          onClick={(e: Event) => {
            e.preventDefault();
            navigate('/activities');
          }}
        >
          Go to Activities
        </a>
      </div>
      <button class="fab" onClick={() => navigate('/workout/new')} aria-label="Start workout">
        +
      </button>
    </div>
  );
}
