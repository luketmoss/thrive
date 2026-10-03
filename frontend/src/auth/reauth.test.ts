import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attemptReauth,
  registerReauthCallback,
  onReauthFailed,
  ReauthFailedError,
  _resetForTesting,
} from './reauth';

describe('attemptReauth (#353)', () => {
  const failed = vi.fn();
  beforeEach(() => {
    _resetForTesting();
    failed.mockReset();
    onReauthFailed(failed);
  });

  it('returns the new token and does not call the failed callback', async () => {
    registerReauthCallback(async () => 'new');
    await expect(attemptReauth()).resolves.toBe('new');
    expect(failed).not.toHaveBeenCalled();
  });

  it('AC4: a failed 401-path renewal calls the failed callback', async () => {
    registerReauthCallback(async () => { throw new Error('popup blocked'); });
    await expect(attemptReauth()).rejects.toBeInstanceOf(ReauthFailedError);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('AC3: a quiet renewal that fails leaves the user signed in', async () => {
    registerReauthCallback(async () => { throw new Error('popup blocked'); });
    await expect(attemptReauth({ quiet: true })).rejects.toBeInstanceOf(ReauthFailedError);
    expect(failed).not.toHaveBeenCalled();
  });

  it('AC3: never two renewals at once; a 401 piggybacks on a quiet renewal', async () => {
    let resolve!: (t: string) => void;
    const cb = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    registerReauthCallback(cb);
    const quiet = attemptReauth({ quiet: true });
    const loud = attemptReauth();
    resolve('tok');
    await expect(Promise.all([quiet, loud])).resolves.toEqual(['tok', 'tok']);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a 401 piggybacking on a failing quiet renewal still signs out', async () => {
    registerReauthCallback(async () => { throw new Error('nope'); });
    const quiet = attemptReauth({ quiet: true }).catch(() => {});
    await expect(attemptReauth()).rejects.toBeInstanceOf(ReauthFailedError);
    await quiet;
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
