// The COROS token file: one JSON file in the bot account's Drive, holding
// client_id, refresh_token, access_token, access_expires_at and updated_at.
//
// COROS rotates the refresh token on every use (#133), and a workflow cannot
// rewrite its own Actions secrets, so the current token lives here instead
// (sync plan §4). The sync creates the file itself and finds it again by its
// `appProperties`, so there is exactly one and no file ID to keep in a secret.

import {
  APP_PROPERTY_ROOT, APP_PROPERTY_TOKEN, DRIVE_ROOT_FOLDER,
} from './config.mjs';
import { registerSecret } from './redact.mjs';

export const TOKEN_FILE_NAME = 'coros-token.json';

export function createTokenStore(drive) {
  let fileId;

  async function locate() {
    if (fileId === undefined) fileId = (await drive.findOne(APP_PROPERTY_TOKEN))?.id ?? null;
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
      const rootId = await drive.ensureFolder(DRIVE_ROOT_FOLDER, APP_PROPERTY_ROOT);
      fileId = await drive.createJson({
        name: TOKEN_FILE_NAME, parentId: rootId, props: APP_PROPERTY_TOKEN, data: tokens,
      });
      return fileId;
    },
  };
}
