// Withings measure groups (#197): `getmeas` over a window, every page.
// Takes its `fetch` so tests need no network.
//
// A page is retried with backoff (retry.mjs) while the failure is transient.
// A page that still fails ends the fetch, but the groups of the pages before
// it are returned with the error, so the run can archive what it has.

import { WITHINGS_MEASURE_CATEGORY, WITHINGS_MEASURE_TYPES } from './config.mjs';
import { WithingsApiError } from './errors.mjs';
import { withRetry } from './retry.mjs';
import { isWithingsTransient, withingsPost } from './withings-oauth.mjs';
import { classifyWithingsError } from './withings-tokens.mjs';

/** The `getmeas` form for one page. `offset` is Withings' own, from the page before. */
export function getmeasForm({ startdate, enddate, offset }) {
  return {
    action: 'getmeas',
    category: String(WITHINGS_MEASURE_CATEGORY),
    meastypes: WITHINGS_MEASURE_TYPES.join(','),
    startdate: String(startdate),
    enddate: String(enddate),
    ...(offset !== undefined ? { offset: String(offset) } : {}),
  };
}

/**
 * Every measure group Withings has for `{ startdate, enddate }` (epoch
 * seconds), following `more`/`offset` until `more` is 0. The window is a
 * parameter so the backfill (#199) can pass `startdate: 0`.
 *
 * Never throws for a Withings failure: it returns
 * `{ groups, pages, error }`, where `error` is null or the classified error
 * (WithingsUnavailableError, WithingsGrantDeadError or WithingsRequestError)
 * that ended the fetch, and `groups` holds every group of the pages before it,
 * as Withings returned them.
 */
export async function fetchMeasureGroups({ fetchImpl = fetch, accessToken, startdate, enddate, retry = {} }) {
  const groups = [];
  let pages = 0;
  let offset;
  try {
    for (;;) {
      const body = await withRetry(
        () => withingsPost(fetchImpl, 'measure', getmeasForm({ startdate, enddate, offset }), { accessToken }),
        { isRetryable: isWithingsTransient, ...retry },
      );
      pages += 1;
      if (Array.isArray(body.measuregrps)) groups.push(...body.measuregrps);
      if (!Number(body.more)) break;
      if (body.offset === undefined || body.offset === null || String(body.offset) === String(offset)) {
        // Asking again for the same page would loop for ever.
        throw new WithingsApiError({
          httpStatus: 200, status: 0, category: 'request', endpoint: 'measure',
          detail: `getmeas said more=${body.more} but gave no new offset (${body.offset})`,
        });
      }
      offset = body.offset;
    }
  } catch (err) {
    return { groups, pages, error: classifyWithingsError(err) };
  }
  return { groups, pages, error: null };
}
