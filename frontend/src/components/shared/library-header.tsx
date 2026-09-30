import { currentRoute, navigate } from '../../router/router';

const SECTIONS = [
  { name: 'templates', label: 'Templates', path: '/templates' },
  { name: 'exercises', label: 'Exercises', path: '/exercises' },
];

/** The Library h1 and its Templates / Exercises switch (#235). */
export function LibraryHeader() {
  const route = currentRoute.value;
  return (
    <>
      <header class="screen-header">
        <h1>Library</h1>
      </header>
      <nav class="library-switch" aria-label="Library">
        {SECTIONS.map((s) => {
          const current = route.name === s.name;
          return (
            <button
              key={s.name}
              type="button"
              class={`library-switch-btn${current ? ' active' : ''}`}
              aria-current={current ? 'page' : undefined}
              onClick={() => navigate(s.path)}
            >
              {s.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
