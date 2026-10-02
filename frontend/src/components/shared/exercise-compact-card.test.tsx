// #301 AC5 — the editor row body is a keyboard-operable button when it has an onClick.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { ExerciseCompactCard } from './exercise-compact-card';

afterEach(() => cleanup());
const body = () => document.querySelector<HTMLElement>('.compact-card-body')!;
const base = { section: 'primary', exerciseName: 'Squat', sets: '', reps: '' };

describe('ExerciseCompactCard body', () => {
  it('with onClick: role=button, tabIndex 0, named by the exercise', () => {
    render(<ExerciseCompactCard {...base} onClick={() => {}} />);
    expect(body().getAttribute('role')).toBe('button');
    expect(body().tabIndex).toBe(0);
    expect(body().textContent).toContain('Squat');
  });

  it('Enter and Space toggle like a click; Space is not left to scroll', () => {
    const onClick = vi.fn();
    render(<ExerciseCompactCard {...base} onClick={onClick} />);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    body().dispatchEvent(enter);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    body().dispatchEvent(space);
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(enter.defaultPrevented).toBe(true);
    expect(space.defaultPrevented).toBe(true);
    fireEvent.keyDown(body(), { key: 'a' });
    expect(onClick).toHaveBeenCalledTimes(2);
    fireEvent.click(body());
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('aria-expanded follows the expanded prop; absent when not given', () => {
    const { rerender } = render(<ExerciseCompactCard {...base} onClick={() => {}} expanded={false} />);
    expect(body().getAttribute('aria-expanded')).toBe('false');
    rerender(<ExerciseCompactCard {...base} onClick={() => {}} expanded />);
    expect(body().getAttribute('aria-expanded')).toBe('true');
    rerender(<ExerciseCompactCard {...base} onClick={() => {}} />);
    expect(body().hasAttribute('aria-expanded')).toBe(false);
  });

  it('without onClick: plain element, no role, not focusable', () => {
    render(<ExerciseCompactCard {...base} expanded />);
    expect(body().hasAttribute('role')).toBe(false);
    expect(body().hasAttribute('tabindex')).toBe(false);
    expect(body().hasAttribute('aria-expanded')).toBe(false);
  });
});
