import { isDemo } from './demo-data';

// The one call the SPA makes to the Apps Script API (#410). Everything else
// still reads and writes Sheets directly.
//
// After a "Sync now" press appends its SyncRequests rows, `requestSync` asks
// the API to dispatch those rows at once instead of waiting up to 5 minutes for
// the poller. The rows are already recorded, so every failure here is silent:
// the poller takes them on its next tick. This never throws.
//
// Transport (#144's): a form-encoded POST, so the access token travels in the
// body and never in a URL. A form POST is a simple request (no preflight), and
// `fetch` follows Apps Script's 302 as a GET; both hops allow any origin.

/** The live `/exec` URL. Unset means no call is made, by design. */
const API_URL: string | undefined = import.meta.env.VITE_THRIVE_API_URL;

/** Well clear of the 2-6 s a warm call takes. */
export const THRIVE_API_TIMEOUT_MS = 20_000;

/**
 * What became of the call. `kind` names a failure without carrying the token
 * or the response body: `no_api_url`, `demo`, `timeout`, `network`,
 * `http_<status>`, `bad_response`, an API error `code` (`token_invalid`,
 * `token_forbidden`, `token_unavailable`, `read_only`, `bad_request`, or
 * `failed` when the envelope has none), or `not_found`.
 */
export type RequestSyncOutcome = { ok: true } | { ok: false; kind: string };

interface RequestSyncOptions {
  url?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Ask the API to dispatch the just-appended request rows now. The answer is
 * ignored beyond ok / not ok: the sheet is the truth, and the caller re-reads it.
 */
export async function requestSync(
  requestIds: readonly string[],
  token: string,
  options: RequestSyncOptions = {},
): Promise<RequestSyncOutcome> {
  const url = 'url' in options ? options.url : API_URL;
  if (isDemo()) return { ok: false, kind: 'demo' };
  if (!url) return { ok: false, kind: 'no_api_url' };

  const body = new URLSearchParams();
  body.set('action', 'requestSync');
  body.set('access_token', token);
  body.set('payload', JSON.stringify({ request_ids: requestIds }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? THRIVE_API_TIMEOUT_MS);
  try {
    const res = await (options.fetchImpl ?? fetch)(url, { method: 'POST', body, signal: controller.signal });
    if (!res.ok) return { ok: false, kind: `http_${res.status}` };
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      return { ok: false, kind: 'bad_response' };
    }
    return outcomeOf(parsed);
  } catch {
    return { ok: false, kind: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

const CODE = /^[a-z_]{1,40}$/;

function outcomeOf(parsed: unknown): RequestSyncOutcome {
  if (!parsed || typeof parsed !== 'object') return { ok: false, kind: 'bad_response' };
  const env = parsed as { success?: unknown; code?: unknown; data?: { requests?: unknown } };
  if (env.success !== true) {
    // Only a plain code word passes through to the log, never the message.
    return { ok: false, kind: typeof env.code === 'string' && CODE.test(env.code) ? env.code : 'failed' };
  }
  const requests = env.data?.requests;
  if (!Array.isArray(requests)) return { ok: false, kind: 'bad_response' };
  if (requests.some((r) => r && (r as { status?: unknown }).status === 'not_found')) {
    return { ok: false, kind: 'not_found' };
  }
  return { ok: true };
}
