// The browser half of the two one-time sign-ins: open a URL, and catch the
// redirect back on a loopback port. Used only by the authorize scripts, which
// a person runs at a desk, never by a scheduled run.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

/**
 * Listens on 127.0.0.1 for one request to `path`. `port: 0` picks a free one,
 * which Google's Desktop clients accept; COROS's redirect is registered, so it
 * passes a fixed port.
 */
export async function listenForRedirect({ port = 0, path = '/' } = {}) {
  let resolveParams;
  const params = new Promise((resolve) => { resolveParams = resolve; });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== path) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Signed in. You can close this tab and return to the terminal.');
    resolveParams(url.searchParams);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  return {
    redirectUri: `http://127.0.0.1:${actualPort}${path === '/' ? '' : path}`,
    params,
    close: () => server.close(),
  };
}

/** Best effort. The URL is always printed as well, so a failure here is harmless. */
export function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch { /* printed URL is the fallback */ }
}
