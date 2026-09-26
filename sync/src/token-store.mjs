// A vendor's token file: one JSON file in the bot account's Drive, holding the
// current rotating token set. COROS's (#151) holds client_id, refresh_token,
// access_token, access_expires_at and updated_at; Withings' (#196) holds
// userid in place of client_id.
//
// Both vendors rotate the refresh token on every use, and a workflow cannot
// rewrite its own Actions secrets, so the current token lives here instead
// (sync plan §4). The sync creates the file itself and finds it again by its
// `appProperties`, so there is exactly one and no file ID to keep in a secret.
// Each vendor has its own root folder and tags, so neither can find the
// other's file.

import {
  APP_PROPERTY_ROOT, APP_PROPERTY_TOKEN, DRIVE_ROOT_FOLDER,
  WITHINGS_APP_PROPERTY_ROOT, WITHINGS_APP_PROPERTY_TOKEN, WITHINGS_DRIVE_ROOT_FOLDER,
  WITHINGS_TOKEN_FILE_NAME,
} from './config.mjs';
import { registerSecret } from './redact.mjs';

export const TOKEN_FILE_NAME = 'coros-token.json';

/** COROS's file, and the default: `createTokenStore(drive)` is unchanged. */
export const COROS_TOKEN_FILE = {
  rootName: DRIVE_ROOT_FOLDER,
  rootProps: APP_PROPERTY_ROOT,
  fileName: TOKEN_FILE_NAME,
  fileProps: APP_PROPERTY_TOKEN,
};

export const WITHINGS_TOKEN_FILE = {
  rootName: WITHINGS_DRIVE_ROOT_FOLDER,
  rootProps: WITHINGS_APP_PROPERTY_ROOT,
  fileName: WITHINGS_TOKEN_FILE_NAME,
  fileProps: WITHINGS_APP_PROPERTY_TOKEN,
};

export function createTokenStore(drive, {
  rootName, rootProps, fileName, fileProps,
} = COROS_TOKEN_FILE) {
  let fileId;

  async function locate() {
    if (fileId === undefined) fileId = (await drive.findOne(fileProps))?.id ?? null;
    return fileId;
  }

  return {
    /** The stored token set, or null when there is no token file yet. */
    async load() {
      const id = await locate();
      if (!id) return null;
      const tokens = await drive.readJson(id);
      registerSecret(tokens?.access_token);
      registerSecret(tokens?.refresh_token);
      return tokens;
    },

    /**
     * Replaces the file's content, or creates the file on first use. Always
     * re-reads the location rather than trusting a cached null, so two
     * authorize runs cannot each create a file.
     */
    async save(tokens) {
      const id = await locate();
      if (id) {
        await drive.updateJson(id, tokens);
        return id;
      }
      fileId = undefined;
      const again = await locate();
      if (again) {
        await drive.updateJson(again, tokens);
        return again;
      }
      const rootId = await drive.ensureFolder(rootName, rootProps);
      fileId = await drive.createJson({
        name: fileName, parentId: rootId, props: fileProps, data: tokens,
      });
      return fileId;
    },
  };
}

/** Withings' token file, under `Thrive Withings`. */
export const createWithingsTokenStore = (drive) => createTokenStore(drive, WITHINGS_TOKEN_FILE);
