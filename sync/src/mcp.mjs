// The COROS MCP connection. COROS's server is stateless (#133), so a
// connection is cheap and nothing is kept between calls.
//
// Not read-specific (sync plan §12): the v2 write path uses the same client.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { COROS_MCP_URL } from './config.mjs';

export async function connectCoros(accessToken) {
  const client = new Client({ name: 'thrive-sync', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(COROS_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return client;
}
