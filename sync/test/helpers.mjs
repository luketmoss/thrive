// Shared fakes. No test in sync/ touches the network.

/** A fetch that answers from a list, in order, and records every request. */
export function scriptedFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init, form: init.body && typeof init.body === 'string' && !init.body.startsWith('{') && !init.body.startsWith('--') ? Object.fromEntries(new URLSearchParams(init.body)) : undefined });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request: ${url}`);
    if (next instanceof Error) throw next;
    const { status = 200, body = {} } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { fetchImpl, calls };
}

export const tokenResponse = (n, { expiresIn = 30 * 86400, rotate = true } = {}) => ({
  status: 200,
  body: {
    access_token: `access-token-${n}-xxxxxxxx`,
    ...(rotate ? { refresh_token: `refresh-token-${n}-xxxxxxxx` } : {}),
    token_type: 'Bearer',
    expires_in: expiresIn,
  },
});

export const oauthError = (status, error) => ({ status, body: { error, error_description: `${error} happened` } });

/** An in-memory token store with the same contract as token-store.mjs. */
export function memoryStore(initial, { onSave } = {}) {
  let tokens = initial ? { ...initial } : null;
  const events = [];
  return {
    events,
    get tokens() { return tokens; },
    set tokens(t) { tokens = t; },
    async load() {
      events.push('load');
      return tokens ? { ...tokens } : null;
    },
    async save(next) {
      events.push('save');
      if (onSave) await onSave(next);
      tokens = { ...next };
      return 'file-1';
    },
  };
}

export const DAY = 24 * 60 * 60 * 1000;
export const NOW = Date.parse('2026-09-24T09:17:00Z');

export function storedTokens({ expiresInMs, refresh = 'refresh-token-0-xxxxxxxx' } = {}) {
  return {
    client_id: 'client-abc',
    access_token: 'access-token-0-xxxxxxxx',
    refresh_token: refresh,
    access_expires_at: new Date(NOW + expiresInMs).toISOString(),
    updated_at: new Date(NOW - 25 * DAY).toISOString(),
  };
}
