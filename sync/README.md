# thrive-sync

The COROS → Thrive sync (epic #163, design in `docs/coros-sync-plan.md`).
It is a plain Node script with no model in the loop. It runs in GitHub Actions
(`.github/workflows/coros-sync.yml`).

So far (#151) it authorizes against COROS, keeps the rotating token in Drive,
and proves both with one authenticated read. #152 adds ingestion.

## Credentials

| What | Where | Rotates? |
|---|---|---|
| Bot account's Google OAuth client ID and secret | Actions secrets `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | No |
| Bot account's Drive refresh token (`drive.file`) | Actions secret `GOOGLE_DRIVE_REFRESH_TOKEN` | No, once published to Production |
| COROS client ID, refresh and access tokens | `Thrive COROS/coros-token.json` in the bot's Drive | **Yes, on every refresh** |

**Why Drive, and why the bot account.** COROS rotates its refresh token on every use, and a workflow
cannot rewrite its own secrets, so the current token lives in a Drive file the sync rewrites. The
file is owned by **luketmossbot@gmail.com**, not the service account: a service account has no
Drive storage quota, and free Gmail has no shared drives. `drive.file` lets the sync see only files
it created.

For local runs, `google-authorize.mjs` also saves the Google credential to
`sync/.google-credentials.json` (gitignored). Environment variables take precedence over it.

## One-time setup

### 1. Google Cloud Console, as luketmossbot@gmail.com

In the bot account's Cloud project:

1. **APIs & Services → Library → Google Drive API → Enable.**
2. **OAuth consent screen** (Google Auth Platform):
   - **Branding:** app name `Thrive Sync`, support and developer contact luketmossbot@gmail.com.
     **Leave the logo empty**, because a logo requires verification.
   - **Data Access:** add the `.../auth/drive.file` scope.
   - **Audience:** External, then **Publish app**. It must say **In production**: in Testing,
     the refresh token expires after 7 days.
3. **Clients → Create client → Desktop app**, named `thrive-sync`. Download the JSON and keep it
   outside the repo.
4. Store the client ID and secret:
   ```bash
   gh secret set GOOGLE_OAUTH_CLIENT_ID --repo luketmoss/thrive
   gh secret set GOOGLE_OAUTH_CLIENT_SECRET --repo luketmoss/thrive
   ```

### 2. Sign the sync in to Drive

```bash
cd sync && npm ci
node google-authorize.mjs --client-json <path to the downloaded JSON>
```

A browser opens. Sign in as **luketmossbot@gmail.com**. Google warns that it hasn't verified the
app, which is expected for a personal one: click **Advanced → Go to Thrive Sync (unsafe) →
Continue**. The script prints the refresh token once. Store it:

```bash
gh secret set GOOGLE_DRIVE_REFRESH_TOKEN --repo luketmoss/thrive
```

### 3. Authorize COROS

```bash
node authorize.mjs
```

This registers a fresh public COROS client (no secret) and asks you to approve it in the browser.
It uses the device-code grant where COROS allows it, and falls back to a browser redirect on
`127.0.0.1:43123`. It creates `Thrive COROS/coros-token.json`, or updates it on a re-run. There is
only ever one. It ends by listing COROS's tools as a check.

### 4. Prove it from Actions

Actions → **coros-sync** → Run workflow, with **force_refresh** ticked. Then run it again
unticked. Both should log `Authenticated: …`. The second run authenticates with the token the first
one rotated in.

## When a run fails

| Error | Meaning | Fix |
|---|---|---|
| `CorosGrantDeadError` | COROS refused the refresh token, and Drive held no newer one | `node authorize.mjs` |
| `DriveAuthError` | Google refused the bot's Drive credential, or a secret is missing | `node google-authorize.mjs`, then update `GOOGLE_DRIVE_REFRESH_TOKEN` |
| `TokenPersistError` | A rotated COROS token could not be written to Drive | Re-run the workflow. If it then reports a dead grant, `node authorize.mjs` |
| `CorosUnavailableError` | COROS is down or erroring after 3 attempts | Nothing. The next run retries |

## How the token is kept

- **Refresh only near expiry.** Access tokens live 30 days. A run refreshes only within 5 days of
  expiry, so rotation happens about monthly, not on every run.
- **Persist before use.** A rotated token is written to Drive before the run does anything else
  with it.
- **One re-read before giving up.** An `invalid_grant` usually means another process rotated
  first. The run re-reads Drive and retries once, but only if the file holds a different token.
- **Never two at once.** The workflow's `concurrency: coros-sync` group queues runs, and never
  cancels one mid-refresh.

## Tests

```bash
npm test
```

`node --test` with fakes for COROS and Drive: no network, no secrets. The unfiltered `sync` job in
`.github/workflows/ci.yml` runs it on every PR.
