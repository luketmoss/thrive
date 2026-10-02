// #249 AC2 — the shared visibility subscription and throttle.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onPageVisible, throttled } from './page-visible';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('onPageVisible', () => {
  afterEach(() => setVisibility('visible'));

  it('calls back on a change to visible, ignores hidden, and unsubscribes', () => {
    const cb = vi.fn();
    const off = onPageVisible(cb);
    setVisibility('hidden');
    expect(cb).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('adds exactly one document listener per subscription', () => {
    const spy = vi.spyOn(document, 'addEventListener');
    const off = onPageVisible(() => {});
    expect(spy.mock.calls.filter((c) => c[0] === 'visibilitychange')).toHaveLength(1);
    off();
    spy.mockRestore();
  });
});

describe('throttled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes the token and runs the first time', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    await throttled(load).run('tok');
    expect(load).toHaveBeenCalledWith('tok');
  });

  it('drops a run while one is in flight, without queueing it', async () => {
    let finish!: () => void;
    const load = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const t = throttled(load);
    const first = t.run('a');
    await t.run('a');
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await t.run('a'); // still inside 60 s of the start
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    const second = t.run('a');
    finish();
    await second;
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('measures 60 s from the start, even when the read fails', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'));
    const t = throttled(load);
    await t.run('a').catch(() => {});
    vi.advanceTimersByTime(59_000);
    await t.run('a').catch(() => {});
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await t.run('a').catch(() => {});
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('markStarted counts as a start', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const t = throttled(load);
    t.markStarted();
    await t.run('a');
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    await t.run('a');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('invalidate lifts the interval for the next run (#315)', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const t = throttled(load);
    await t.run('a');
    t.invalidate();
    await t.run('a');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('honours a custom interval', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const t = throttled(load, { minIntervalMs: 1000 });
    await t.run('a');
    vi.advanceTimersByTime(1000);
    await t.run('a');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('onPageHidden (#240)', () => {
  afterEach(() => setVisibility('visible'));

  it('calls back on a change to hidden, ignores visible, and unsubscribes', async () => {
    const { onPageHidden } = await import('./page-visible');
    const cb = vi.fn();
    const off = onPageHidden(cb);
    setVisibility('visible');
    expect(cb).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    setVisibility('hidden');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
