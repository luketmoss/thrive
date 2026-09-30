import { describe, it, expect, beforeEach, vi } from 'vitest';

// We cannot directly test parseHash since it's not exported,
// but we can test the router behavior by manipulating window.location.hash
// and reading the signal. Since the module initializes on import,
// we test the navigate function and route matching through integration.

// Import the module — currentRoute initializes from window.location.hash
// and navigate() sets window.location.hash.

describe('router', () => {
  beforeEach(() => {
    // Reset hash before each test
    window.location.hash = '';
  });

  it('parses empty hash as day route', async () => {
    // Re-import to re-evaluate
    window.location.hash = '';
    const { currentRoute } = await import('./router');
    // Trigger hashchange
    window.location.hash = '';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('day');
    expect(currentRoute.value.params).toEqual({});
  });

  it('parses /templates as templates route', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/templates';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('templates');
  });

  it('parses /settings as settings route', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/settings';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('settings');
  });

  it('parses /history/:id as workout-detail with params', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/history/w_abc123';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('workout-detail');
    expect(currentRoute.value.params).toEqual({ id: 'w_abc123' });
  });

  it('parses /history/:id/edit as workout-edit with params', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/history/w_abc123/edit';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('workout-edit');
    expect(currentRoute.value.params).toEqual({ id: 'w_abc123' });
  });

  it('parses /workout/new as workout-new route', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/workout/new';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('workout-new');
    expect(currentRoute.value.params).toEqual({});
  });

  it('parses /workout/:id as workout-active with params', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/workout/w_xyz789';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('workout-active');
    expect(currentRoute.value.params).toEqual({ id: 'w_xyz789' });
  });

  it('parses /templates/new as template-new route', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/templates/new';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('template-new');
    expect(currentRoute.value.params).toEqual({});
  });

  it('parses /templates/:id as template-detail with params', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/templates/tpl_demo001';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('template-detail');
    expect(currentRoute.value.params).toEqual({ id: 'tpl_demo001' });
  });

  it('parses /templates/:id/edit as template-edit with params', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/templates/tpl_demo001/edit';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('template-edit');
    expect(currentRoute.value.params).toEqual({ id: 'tpl_demo001' });
  });

  // #143: `#/workout/new?plan=YYYY-MM-DD` is almanac's Plan link.
  describe('workout-new ?plan= (#143 AC5)', () => {
    async function parse(hash: string) {
      const { currentRoute } = await import('./router');
      window.location.hash = hash;
      window.dispatchEvent(new Event('hashchange'));
      return currentRoute.value;
    }

    it('parses ?plan=<date> as workout-new with the raw plan param', async () => {
      const route = await parse('/workout/new?plan=2026-09-24');
      expect(route.name).toBe('workout-new');
      expect(route.params).toEqual({ plan: '2026-09-24' });
    });

    it('keeps an empty or malformed plan raw — validation belongs to the flow', async () => {
      expect((await parse('/workout/new?plan=')).params).toEqual({ plan: '' });
      expect((await parse('/workout/new?plan=tomorrow')).params).toEqual({ plan: 'tomorrow' });
    });

    it('has no plan param when the key is absent', async () => {
      expect((await parse('/workout/new')).params).toEqual({});
      expect((await parse('/workout/new?type=bike')).params).toEqual({});
    });

    it('never resolves /workout/new?… to workout-active (the old bounce to Activities)', async () => {
      for (const hash of ['/workout/new?plan=2026-09-24', '/workout/new?plan=', '/workout/new?']) {
        const route = await parse(hash);
        expect(route.name).toBe('workout-new');
        expect(route.params.id).toBeUndefined();
      }
    });

    it('carries the query in route.hash, so ?plan=A and ?plan=B are distinct routes', async () => {
      const a = await parse('/workout/new?plan=2026-09-24');
      const b = await parse('/workout/new?plan=2026-09-25');
      expect(a.hash).toBe('/workout/new?plan=2026-09-24');
      expect(b.hash).toBe('/workout/new?plan=2026-09-25');
    });

    it('matches other routes on their path, ignoring a query', async () => {
      const route = await parse('/history/w_abc123?from=almanac');
      expect(route.name).toBe('workout-detail');
      expect(route.params).toEqual({ id: 'w_abc123' });
    });
  });

  it('falls back to day for unknown routes', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/nonexistent/path';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('day');
  });

  it('parses #/ as day, /activities as activities and /trends as trends (#235)', async () => {
    const { currentRoute } = await import('./router');
    for (const [hash, name] of [['/', 'day'], ['/activities', 'activities'], ['/trends', 'trends'], ['/exercises', 'exercises'], ['/settings/labels', 'manage-labels']]) {
      window.location.hash = hash;
      window.dispatchEvent(new Event('hashchange'));
      expect(currentRoute.value.name).toBe(name);
    }
  });

  it('navigate() sets the window hash', async () => {
    const { navigate } = await import('./router');
    navigate('/templates');

    expect(window.location.hash).toBe('#/templates');
  });

  // #235 AC3: Back uses history.back() only when an earlier in-app screen exists.
  describe('goBack (#235 AC3)', () => {
    it('falls back to the given route when there is no earlier in-app screen', async () => {
      vi.resetModules();
      window.location.hash = '/workout/new';
      const r = await import('./router');
      expect(r.canGoBack()).toBe(false);
      r.goBack();
      expect(window.location.hash).toBe('#/activities');
    });

    it('calls history.back() once the user has navigated in-app', async () => {
      vi.resetModules();
      window.location.hash = '/';
      const r = await import('./router');
      window.location.hash = '/workout/new';
      window.dispatchEvent(new Event('hashchange'));
      expect(r.canGoBack()).toBe(true);
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      r.goBack();
      expect(back).toHaveBeenCalledOnce();
      back.mockRestore();
    });

    it('never returns to the edit form after editing (A -> D -> E -> D, then Back)', async () => {
      vi.resetModules();
      window.location.hash = '/activities';
      const r = await import('./router');
      r.navigate('/history/w1');
      window.dispatchEvent(new Event('hashchange'));
      r.navigate('/history/w1/edit');
      window.dispatchEvent(new Event('hashchange'));
      r.navigate('/history/w1');
      window.dispatchEvent(new Event('hashchange'));
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      r.goBack();
      expect(back).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('#/activities');
      back.mockRestore();
    });

    it('does not use Back to reach a workout tracker', async () => {
      vi.resetModules();
      window.location.hash = '/activities';
      const r = await import('./router');
      r.navigate('/workout/w1');
      window.dispatchEvent(new Event('hashchange'));
      r.navigate('/history/w1');
      window.dispatchEvent(new Event('hashchange'));
      expect(r.canGoBack()).toBe(false);
    });

    it('treats a browser back to the previous entry as a pop', async () => {
      vi.resetModules();
      window.location.hash = '/activities';
      const r = await import('./router');
      r.navigate('/history/w1');
      window.dispatchEvent(new Event('hashchange'));
      window.location.hash = '/activities';
      window.dispatchEvent(new Event('hashchange'));
      expect(r.canGoBack()).toBe(false);
    });
  });
});
