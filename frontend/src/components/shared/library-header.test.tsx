// #235 AC5 — the Library h1 and its Templates / Exercises switch.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { h } from 'preact';
import { LibraryHeader } from './library-header';
import { currentRoute } from '../../router/router';

afterEach(cleanup);

function renderAt(name: string) {
  currentRoute.value = { name, params: {}, hash: '/' };
  return render(h(LibraryHeader, {}));
}

describe('LibraryHeader', () => {
  it('shows one h1 "Library" and a nav labelled Library, not a tablist', () => {
    const { container } = renderAt('templates');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('Library');
    const nav = container.querySelector('nav[aria-label="Library"]');
    expect(nav).not.toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect([...nav!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Templates', 'Exercises']);
  });

  it('marks the current section with aria-current="page"', () => {
    for (const [route, label] of [['templates', 'Templates'], ['exercises', 'Exercises']]) {
      const { container } = renderAt(route);
      const current = [...container.querySelectorAll('[aria-current="page"]')];
      expect(current.map((b) => b.textContent)).toEqual([label]);
      cleanup();
    }
  });

  it('changes the route when an option is tapped', () => {
    const { getByText } = renderAt('templates');
    fireEvent.click(getByText('Exercises'));
    expect(window.location.hash).toBe('#/exercises');
    fireEvent.click(getByText('Templates'));
    expect(window.location.hash).toBe('#/templates');
  });
});
