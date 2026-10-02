// #290 — the focus hand-off helper's conditions.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useFocusHandoff } from './focus-handoff';

function Holder() {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusHandoff(ref, () => document.getElementById('target'));
  return <button ref={ref}>held</button>;
}

function Page({ show }: { show: boolean }) {
  return (
    <div>
      <h2 id="target" tabIndex={-1}>target</h2>
      <input id="other" />
      {show && <Holder />}
    </div>
  );
}

const flush = () => act(async () => { await Promise.resolve(); });
afterEach(cleanup);

describe('useFocusHandoff', () => {
  it('focuses the target when the element goes while holding focus', async () => {
    const { container, rerender } = render(<Page show />);
    container.querySelector('button')!.focus();
    rerender(<Page show={false} />);
    await flush();
    expect(document.activeElement).toBe(document.getElementById('target'));
  });

  it('does nothing when the element did not hold focus', async () => {
    const { rerender } = render(<Page show />);
    rerender(<Page show={false} />);
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it('does not take focus on mount', async () => {
    render(<Page show />);
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves a focus the user moved elsewhere', async () => {
    const { container, rerender } = render(<Page show />);
    container.querySelector('button')!.focus();
    rerender(<Page show={false} />);
    document.getElementById('other')!.focus(); // before the microtask runs
    await flush();
    expect(document.activeElement).toBe(document.getElementById('other'));
  });

  it('does not focus a target that has left the document', async () => {
    const { container, unmount } = render(<Page show />);
    container.querySelector('button')!.focus();
    unmount();
    await flush();
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing when there is no target', async () => {
    function NoTarget() {
      const ref = useRef<HTMLButtonElement>(null);
      useFocusHandoff(ref, () => null);
      return <button ref={ref}>x</button>;
    }
    const { container, unmount } = render(<NoTarget />);
    container.querySelector('button')!.focus();
    unmount();
    await flush();
    expect(document.activeElement).toBe(document.body);
  });
});
