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

// #321 — editable controls: disabled ends and exercise-bearing names.
describe('ExerciseCompactCard editable controls (#321)', () => {
  const btns = (name: string) => ({
    up: document.querySelector<HTMLButtonElement>(`button[aria-label="Move ${name} up"]`)!,
    down: document.querySelector<HTMLButtonElement>(`button[aria-label="Move ${name} down"]`)!,
    remove: document.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name}"]`)!,
  });
  const props = { section: 'primary', exerciseName: 'Row BB', sets: '3', reps: '8', editable: true };

  it('names all three controls after the exercise, as type=button, glyphs hidden', () => {
    render(<ExerciseCompactCard {...props} index={1} total={3} />);
    const b = btns('Row BB');
    for (const el of [b.up, b.down, b.remove]) {
      expect(el).toBeTruthy();
      expect(el.getAttribute('type')).toBe('button');
      expect(el.querySelector('[aria-hidden="true"]')).toBeTruthy();
    }
    expect(document.querySelector('.compact-card')!.classList.contains('compact-card-editable')).toBe(true);
  });

  // #328 AC2: an end is aria-disabled, never natively disabled, so it keeps focus.
  it('first: up unavailable; middle: both available; last: down unavailable; only: both unavailable', () => {
    const cases: [number, number, boolean, boolean][] = [
      [0, 3, true, false],
      [1, 3, false, false],
      [2, 3, false, true],
      [0, 1, true, true],
    ];
    for (const [index, total, upOff, downOff] of cases) {
      const onMoveUp = vi.fn();
      const onMoveDown = vi.fn();
      const { unmount } = render(
        <ExerciseCompactCard {...props} index={index} total={total} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />,
      );
      const b = btns('Row BB');
      for (const el of [b.up, b.down, b.remove]) expect(el.disabled).toBe(false);
      expect(b.up.getAttribute('aria-disabled')).toBe(upOff ? 'true' : null);
      expect(b.down.getAttribute('aria-disabled')).toBe(downOff ? 'true' : null);
      fireEvent.click(b.up);
      fireEvent.click(b.down);
      expect(onMoveUp).toHaveBeenCalledTimes(upOff ? 0 : 1);
      expect(onMoveDown).toHaveBeenCalledTimes(downOff ? 0 : 1);
      unmount();
    }
  });

  it('an end button can hold focus and keeps its name (#328 AC2)', () => {
    render(<ExerciseCompactCard {...props} index={0} total={3} />);
    const b = btns('Row BB');
    b.up.focus();
    expect(document.activeElement).toBe(b.up);
    expect(b.up.getAttribute('aria-label')).toBe('Move Row BB up');
    expect(b.up.dataset.move).toBe('up');
    expect(b.down.dataset.move).toBe('down');
  });

  it('controls are not inside the row body; read-only cards have none', () => {
    const { unmount } = render(<ExerciseCompactCard {...props} index={1} total={3} onClick={() => {}} />);
    const b = btns('Row BB');
    for (const el of [b.up, b.down, b.remove]) expect(el.closest('.compact-card-body')).toBeNull();
    unmount();
    render(<ExerciseCompactCard {...props} editable={false} />);
    expect(document.querySelector('.reorder-btn')).toBeNull();
    expect(document.querySelector('.compact-card-editable')).toBeNull();
  });
});
