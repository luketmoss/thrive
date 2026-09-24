// Retry with backoff. COROS availability is genuinely unreliable (sync plan
// §2), so a transient failure is expected, not exceptional.

/** Delays before the 2nd and 3rd attempts: three attempts in all. */
const DEFAULT_DELAYS_MS = (process.env.THRIVE_SYNC_RETRY_DELAYS_MS ?? '2000,8000')
  .split(',').filter(Boolean).map(Number);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying while `isRetryable(err)` is true. The last error is
 * rethrown unchanged, so the caller still classifies it.
 */
export async function withRetry(fn, { isRetryable, delays = DEFAULT_DELAYS_MS, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= delays.length || !isRetryable(err)) throw err;
      await wait(delays[attempt]);
    }
  }
}
