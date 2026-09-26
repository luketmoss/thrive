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

/**
 * An in-memory Drive with the same contract as drive.mjs: files and folders
 * found by `appProperties`, updated in place by ID. `writes` records every
 * create and update, so a test can assert that nothing was written.
 */
export function memoryDrive() {
  const files = new Map();
  const writes = [];
  // Per-method call counts, so a perf test can assert a bulk lookup ran
  // once rather than once per file (#199).
  const calls = { findFiles: 0, findAll: 0, findOne: 0, readJson: 0 };
  let seq = 0;
  const matches = (file, props) => Object.entries(props).every(([k, v]) => file.props[k] === String(v));
  const drive = {
    files,
    writes,
    calls,
    async findFiles(props, { mimeType } = {}) {
      calls.findFiles += 1;
      return [...files.values()].filter((f) => matches(f, props) && (!mimeType || f.mimeType === mimeType));
    },
    /** As drive.mjs's findAll: every match, tagged, with no 10-file cap. */
    async findAll(props, { mimeType } = {}) {
      calls.findAll += 1;
      return (await drive.findFiles(props, { mimeType })).map((f) => ({ id: f.id, name: f.name, appProperties: f.props }));
    },
    async findOne(props, opts) {
      calls.findOne += 1;
      const found = await drive.findFiles(props, opts);
      if (found.length > 1) throw new Error(`${found.length} files match`);
      return found[0] ?? null;
    },
    async ensureFolder(name, props, parentId) {
      const existing = await drive.findOne(props, { mimeType: 'folder' });
      if (existing) return existing.id;
      const id = `folder-${++seq}`;
      files.set(id, { id, name, props, parentId, mimeType: 'folder' });
      writes.push({ op: 'folder', id, name });
      return id;
    },
    async createJson({ name, parentId, props, data }) {
      const id = `file-${++seq}`;
      files.set(id, { id, name, props, parentId, mimeType: 'application/json', data: JSON.parse(JSON.stringify(data)) });
      writes.push({ op: 'create', id, name });
      return id;
    },
    async createBinary({ name, parentId, props, bytes, mimeType = 'application/octet-stream' }) {
      if (drive.failBinary) throw drive.failBinary;
      const id = `file-${++seq}`;
      files.set(id, { id, name, props, parentId, mimeType, bytes: Buffer.from(bytes), modifiedTime: '2026-09-24T17:41:12.345Z' });
      writes.push({ op: 'create', id, name });
      return id;
    },
    async readJson(id) {
      calls.readJson += 1;
      return JSON.parse(JSON.stringify(files.get(id).data));
    },
    async updateJson(id, data) {
      files.get(id).data = JSON.parse(JSON.stringify(data));
      writes.push({ op: 'update', id });
    },
    /** The folder path of a file, from the root down. */
    pathOf(id) {
      const names = [];
      for (let f = files.get(id); f; f = files.get(f.parentId)) names.unshift(f.name);
      return names.join('/');
    },
  };
  return drive;
}

/** A text result the way COROS sends one: prose inside a JSON string. */
export const corosText = (prose, { isError = false } = {}) => ({
  content: [{ type: 'text', text: JSON.stringify(prose) }],
  isError,
});

/**
 * A fake MCP client. `handlers[tool]` is a result, an Error to throw, or a
 * function of the arguments returning either. Every call is recorded.
 */
export function fakeCoros(handlers) {
  const calls = [];
  return {
    calls,
    async callTool({ name, arguments: args }) {
      calls.push({ name, args });
      let h = handlers[name];
      if (typeof h === 'function') h = h(args, calls.filter((c) => c.name === name).length);
      if (h === undefined) throw new Error(`unexpected tool ${name}`);
      if (h instanceof Error) throw h;
      return h;
    },
  };
}

export const noWait = { wait: async () => {} };
