// #410 AC1, AC3 — the one call to the Apps Script API: a form-encoded POST,
// the token never in the URL, every failure answered as a kind, never thrown.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let demo = false;
vi.mock('./demo-data', async () => {
  const actual = await vi.importActual<typeof import('./demo-data')>('./demo-data');
  return { ...actual, isDemo: () => demo };
});

import { requestSync, THRIVE_API_TIMEOUT_MS } from './thrive-api';

const URL_ = 'https://script.google.com/macros/s/EXAMPLE/exec';
const TOKEN = 'ya29.SPA/token+value=';
const IDS = ['sr_0000c0c0', 'sr_0000a1a1'];

function reply(body: unknown, init: { status?: number } = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200 });
}

const ok = {
  success: true,
  data: { requests: [{ request_id: IDS[0], status: 'started' }, { request_id: IDS[1], status: 'skipped' }] },
};

beforeEach(() => { demo = false; });
afterEach(() => { vi.useRealTimers(); });

describe('requestSync', () => {
  it('POSTs action, access_token and payload form-encoded, with nothing in the URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(ok));
    const outcome = await requestSync(IDS, TOKEN, { url: URL_, fetchImpl });
    expect(outcome).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(URL_);
    expect(String(url)).not.toContain('ya29');
    expect(init.method).toBe('POST');
    // No custom headers: a simple request, no CORS preflight.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(URLSearchParams);
    const body = init.body as URLSearchParams;
    expect([...body.keys()]).toEqual(['action', 'access_token', 'payload']);
    expect(body.get('action')).toBe('requestSync');
    expect(body.get('access_token')).toBe(TOKEN);
    expect(JSON.parse(body.get('payload')!)).toEqual({ request_ids: IDS });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('makes no call with no API URL, or in demo mode', async () => {
    const fetchImpl = vi.fn();
    expect(await requestSync(IDS, TOKEN, { url: undefined, fetchImpl })).toEqual({ ok: false, kind: 'no_api_url' });
    expect(await requestSync(IDS, TOKEN, { url: '', fetchImpl })).toEqual({ ok: false, kind: 'no_api_url' });
    demo = true;
    expect(await requestSync(IDS, TOKEN, { url: URL_, fetchImpl })).toEqual({ ok: false, kind: 'demo' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.skipIf(!!import.meta.env.VITE_THRIVE_API_URL)('the build without VITE_THRIVE_API_URL makes no call', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await requestSync(IDS, TOKEN)).toEqual({ ok: false, kind: 'no_api_url' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('aborts after 20 s', async () => {
    expect(THRIVE_API_TIMEOUT_MS).toBe(20_000);
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = requestSync(IDS, TOKEN, { url: URL_, fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchImpl.mock.calls[0][1].signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, kind: 'timeout' });
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch')), 'network'],
    ['an HTTP error', () => Promise.resolve(reply('<html>' + TOKEN + '</html>', { status: 500 })), 'http_500'],
    ['a body that is not JSON', () => Promise.resolve(reply('<html>sign in</html>')), 'bad_response'],
    ['token_invalid', () => Promise.resolve(reply({ success: false, error: 'x', code: 'token_invalid' })), 'token_invalid'],
    ['token_forbidden', () => Promise.resolve(reply({ success: false, error: 'x', code: 'token_forbidden' })), 'token_forbidden'],
    ['token_unavailable', () => Promise.resolve(reply({ success: false, error: 'x', code: 'token_unavailable' })), 'token_unavailable'],
    ['success:false without a code', () => Promise.resolve(reply({ success: false, error: 'Unknown action' })), 'failed'],
    ['a code that is not a plain word', () => Promise.resolve(reply({ success: false, error: 'x', code: TOKEN })), 'failed'],
    ['a row not found', () => Promise.resolve(reply({ success: true, data: { requests: [{ request_id: IDS[0], status: 'not_found' }] } })), 'not_found'],
    ['a success with no requests', () => Promise.resolve(reply({ success: true, data: {} })), 'bad_response'],
  ])('%s is answered as a kind, never thrown', async (_name, impl, kind) => {
    const outcome = await requestSync(IDS, TOKEN, { url: URL_, fetchImpl: vi.fn(impl) as unknown as typeof fetch });
    expect(outcome).toEqual({ ok: false, kind });
    expect(JSON.stringify(outcome)).not.toContain('ya29');
  });
});
