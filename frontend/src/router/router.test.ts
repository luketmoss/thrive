import { describe, it, expect, beforeEach } from 'vitest';

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

  it('parses empty hash as activities route', async () => {
    // Re-import to re-evaluate
    window.location.hash = '';
    const { currentRoute } = await import('./router');
    // Trigger hashchange
    window.location.hash = '';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('activities');
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

  it('falls back to activities for unknown routes', async () => {
    const { currentRoute } = await import('./router');
    window.location.hash = '/nonexistent/path';
    window.dispatchEvent(new Event('hashchange'));

    expect(currentRoute.value.name).toBe('activities');
  });

  it('navigate() sets the window hash', async () => {
    const { navigate } = await import('./router');
    navigate('/templates');

    expect(window.location.hash).toBe('#/templates');
  });
});
