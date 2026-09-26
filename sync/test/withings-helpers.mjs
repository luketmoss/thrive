// Fakes for Withings (#196). Withings answers HTTP 200 and reports failure in
// the body's `status`, so these do too.

import { NOW } from './helpers.mjs';

export const CLIENT_ID = 'withings-client-id';
export const CLIENT_SECRET = 'withings-client-secret-xxxx';
export const HOUR = 60 * 60 * 1000;
export const MINUTE = 60 * 1000;

export const withingsTokens = (n, { expiresIn = 10800 } = {}) => ({
  status: 200,
  body: {
    status: 0,
    body: {
      userid: '1234567',
      access_token: `wt-access-${n}-xxxxxxxx`,
      refresh_token: `wt-refresh-${n}-xxxxxxxx`,
      expires_in: expiresIn,
      scope: 'user.metrics,user.info',
      token_type: 'Bearer',
    },
  },
});

/** HTTP 200, non-zero status: how Withings refuses. */
export const withingsStatus = (status, error = `status ${status} happened`) => ({
  status: 200,
  body: { status, body: {}, error },
});

export function storedWithings({ expiresInMs, refresh = 'wt-refresh-0-xxxxxxxx' } = {}) {
  return {
    userid: '1234567',
    access_token: 'wt-access-0-xxxxxxxx',
    refresh_token: refresh,
    access_expires_at: new Date(NOW + expiresInMs).toISOString(),
    updated_at: new Date(NOW - 3 * HOUR).toISOString(),
  };
}

// --- measures (#197) ----------------------------------------------------------

/** A measure group shaped as `getmeas` returns one. `date` is epoch seconds. */
export const measureGroup = (grpid, date, measures = [{ value: 81234, type: 1, unit: -3 }], extra = {}) => ({
  grpid,
  attrib: 0,
  date,
  created: date + 5,
  modified: date + 5,
  category: 1,
  deviceid: 'dev-scale-1',
  hash_deviceid: 'dev-scale-1',
  measures,
  modelid: 13,
  model: 'Body+',
  comment: null,
  timezone: 'America/Denver',
  ...extra,
});

/** One `getmeas` page. `offset` is only sent with `more`, as Withings does. */
export const getmeasPage = (groups, { more = 0, offset } = {}) => ({
  status: 200,
  body: {
    status: 0,
    body: {
      updatetime: 1790000000,
      timezone: 'America/Denver',
      measuregrps: groups,
      more,
      ...(offset !== undefined ? { offset } : {}),
    },
  },
});

// --- deletions (#215) -----------------------------------------------------------

/**
 * `reconcileBodyMeasurements` over an in-memory tab (a Map of grpid to row),
 * with the Apps Script action's rules: the window by local `date`, the cap,
 * and the empty-answer refusal. The action itself is tested in
 * apps-script/tests/body-measurements-reconcile.test.ts; this is its double.
 */
export function fakeReconcile(tab, calls = []) {
  return async function reconcileBodyMeasurements(payload) {
    calls.push(payload);
    const { from, to, present_grpids: present, max_deletions: max = 5, allow_empty: allowEmpty } = payload;
    const inWindow = [...tab.values()].filter((r) => r.date >= from && r.date <= to);
    const targets = inWindow.filter((r) => !present.includes(String(r.grpid))).map((r) => String(r.grpid));
    if (targets.length > max || (!present.length && inWindow.length && !allowEmpty)) {
      return { deleted: [], refused: true, would_delete: targets.length };
    }
    for (const g of targets) tab.delete(g);
    return { deleted: targets, refused: false };
  };
}
