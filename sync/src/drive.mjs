// A small Drive v3 client over plain REST, as the bot account (#151 AC0).
//
// The sync holds only `drive.file`, so every query sees only files the sync
// itself created. Files are found again by `appProperties` rather than by name
// or a stored ID: a renamed or moved file is still found, and no file ID has to
// be kept in step with a secret. #152 builds its archive on the same helper.

import { randomBytes } from 'node:crypto';
import { DriveAuthError } from './errors.mjs';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveError extends Error {
  constructor(status, message) {
    super(`Drive ${status}: ${message}`);
    this.name = 'DriveError';
    this.status = status;
  }
}

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A Drive query matching every given app property, excluding trashed files. */
export function appPropertiesQuery(props, mimeType) {
  const clauses = Object.entries(props).map(
    ([k, v]) => `appProperties has { key=${quote(k)} and value=${quote(v)} }`,
  );
  if (mimeType) clauses.push(`mimeType = ${quote(mimeType)}`);
  clauses.push('trashed = false');
  return clauses.join(' and ');
}

/**
 * @param {{ getToken: () => Promise<string>, fetchImpl?: typeof fetch }} deps
 *   `getToken` returns a Google access token, or throws DriveAuthError.
 */
export function createDrive({ getToken, fetchImpl = fetch }) {
  async function request(method, url, { json, body, headers = {} } = {}) {
    const token = await getToken();
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    const text = await res.text();
    if (res.status === 401) throw new DriveAuthError(`Drive answered 401`);
    if (!res.ok) {
      let message = text.slice(0, 300);
      try { message = JSON.parse(text).error?.message ?? message; } catch { /* keep text */ }
      throw new DriveError(res.status, message);
    }
    return text;
  }

  async function findFiles(props, { mimeType } = {}) {
    const url = new URL(API);
    url.searchParams.set('q', appPropertiesQuery(props, mimeType));
    url.searchParams.set('fields', 'files(id,name,parents,modifiedTime)');
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('pageSize', '10');
    return JSON.parse(await request('GET', url)).files ?? [];
  }

  /**
   * The one file with these properties, or null. Two is refused rather than
   * guessed between: for the token file especially, picking the wrong one
   * means presenting a spent refresh token.
   */
  async function findOne(props, opts) {
    const files = await findFiles(props, opts);
    if (files.length > 1) {
      throw new DriveError(409, `${files.length} files match ${JSON.stringify(props)} ` +
        `(${files.map((f) => f.id).join(', ')}). Trash all but one and re-run.`);
    }
    return files[0] ?? null;
  }

  async function ensureFolder(name, props, parentId) {
    const existing = await findOne(props, { mimeType: FOLDER_MIME });
    if (existing) return existing.id;
    const created = JSON.parse(await request('POST', `${API}?fields=id`, {
      json: { name, mimeType: FOLDER_MIME, appProperties: props, ...(parentId ? { parents: [parentId] } : {}) },
    }));
    return created.id;
  }

  async function createJson({ name, parentId, props, data }) {
    const boundary = `thrive-sync-${Date.now().toString(36)}`;
    const metadata = { name, mimeType: 'application/json', appProperties: props, parents: [parentId] };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data, null, 2)}\r\n` +
      `--${boundary}--`;
    const created = JSON.parse(await request('POST', `${UPLOAD}?uploadType=multipart&fields=id`, {
      body,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    }));
    return created.id;
  }

  /**
   * A binary file (a FIT, #154), in one multipart upload. The boundary is
   * random, and checked against the bytes, so it cannot occur inside them.
   */
  async function createBinary({ name, parentId, props, bytes, mimeType = 'application/octet-stream' }) {
    let boundary;
    do boundary = `thrive-sync-${randomBytes(12).toString('hex')}`;
    while (bytes.includes(boundary));
    const metadata = { name, mimeType, appProperties: props, parents: [parentId] };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const created = JSON.parse(await request('POST', `${UPLOAD}?uploadType=multipart&fields=id`, {
      body,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    }));
    return created.id;
  }

  async function readJson(fileId) {
    return JSON.parse(await request('GET', `${API}/${encodeURIComponent(fileId)}?alt=media`));
  }

  /** Replaces the content. The file ID, and anything pointing at it, is unchanged. */
  async function updateJson(fileId, data) {
    await request('PATCH', `${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, {
      body: JSON.stringify(data, null, 2),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { findFiles, findOne, ensureFolder, createJson, createBinary, readJson, updateJson };
}
