/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_SPREADSHEET_ID: string;
  readonly VITE_DEMO_MODE?: string;
  /** The Apps Script API's live /exec URL (#410). Unset: Sync now waits for the poller. */
  readonly VITE_THRIVE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
