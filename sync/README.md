# thrive-sync

The COROS → Thrive sync (epic #163, design in `docs/coros-sync-plan.md`).
It is a plain Node script with no model in the loop. It runs in GitHub Actions
(`.github/workflows/coros-sync.yml`).

It authorizes against COROS and keeps the rotating token in Drive (#151), lands
the window's raw COROS payloads in Drive, unmodified (#152), then normalizes
daily health from that archive into the sheet's `DailyHealth` tab through the
Thrive API and rebuilds `DailySummary` for the window (#165). Activities are
#166's.

## Credentials

| What | Where | Rotates? |
|---|---|---|
| Bot account's Google OAuth client ID and secret | Actions secrets `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | No |
| Bot account's Drive refresh token (`drive.file`) | Actions secret `GOOGLE_DRIVE_REFRESH_TOKEN` | No, once published to Production |
| COROS client ID, refresh and access tokens | `Thrive COROS/coros-token.json` in the bot's Drive | **Yes, on every refresh** |
| Thrive API URL and key | Actions secrets `THRIVE_API_URL` (the Apps Script `/exec` URL) and `THRIVE_API_KEY` (its `API_KEY` script property); environment variables for a local run | No |

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

## The raw archive (#152)

Each run fetches a rolling window, **D − 10 days to D + 1 day**, where D is today's date in
`America/Denver` (never the runner's UTC clock). Ten days back, because a multi-day trip reaches
the COROS cloud only when the phone gets signal again (sync plan §6). Everything lands under
`Thrive COROS` in the bot's Drive:

| File | Tagged (`appProperties`) | Holds |
|---|---|---|
| `activities/<YYYY>/<MM>/<activityId>.json`, foldered by local start date | `source=coros`, `activity_id` | `source`, `activity_id`, `tool`, `args`, `list_entry`, `payload`, `payload_hash`, `fetched_at`, `normalized` |
| `health/<YYYY>/<MM>/<YYYY-MM-DD>.json`, one per local run date | `source=coros`, `kind=health`, `run_date` | `calls` (each `tool`, `args`, `payload`), `window`, `payload_hash`, `fetched_at` |

- **`payload` is COROS's text byte-for-byte**, JSON string quoting included. COROS answers in
  prose, and this text is the only way to re-parse after it changes its format.
- **Idempotent.** A file is found by its `appProperties`, never by name, so moving or renaming it
  in Drive is harmless. An unchanged `payload_hash` writes nothing; a changed one rewrites the
  same file, so its Drive ID (the future `Workouts!raw_ref`) never changes, and `normalized`
  (#153's) is carried over untouched.
- **Errors are never archived.** A thrown call, an `isError` result, or error text served as a
  result ("temporarily unavailable", "Tool call anomalies detected") is retried, three attempts in
  all. A detail that still fails is logged with its activity ID and the run carries on; a failed
  list call ends the run; a failed health call skips that run's bundle. Any failure exits non-zero.
- Recovery and fitness take no date, so the bundle holds them as of `fetched_at`.
- A payload containing a FIT download URL (`s3.coros.com/fit/…`, an unauthenticated secret) is
  refused rather than archived.

The tools and arguments, from the live `tools/list`:

| Tool | Arguments |
|---|---|
| `querySportRecords` | `startDate`, `endDate` (`yyyyMMdd`, the whole window), `limit: 100` |
| `getActivityDetail` | `labelId` (string), `sportType` (number), both from the list |
| `querySleepOverview` | `startDate`, `endDate` (the whole window) |
| `querySleepHrv` | `startDate`, `endDate`, in ranges of at most 7 days |
| `queryDailyHealthData`, `queryRestingHeartRate`, `queryTrainingLoadAssessment` | `days: 11` (D − 10 through D; they count back from today and cannot reach D + 1) |
| `queryRecoveryStatus`, `queryFitnessAssessmentOverview` | none |

`querySportRecords` and `querySleepHrv` mark every argument required in their schemas, but
accept these subsets. A run checks `tools/list` first and fails naming any tool that has gone.

## Daily health into the sheet (#165)

After the archive lands, the run reads **the run date's health bundle back from
Drive** and parses it (`src/normalize-health.mjs`) into one row per local date,
D − 10 to D:

| Field | From |
|---|---|
| `resting_hr` | `queryRestingHeartRate` (not `queryDailyHealthData`'s header, a window summary) |
| `hrv` | `querySleepHrv`'s official daily average, never the raw series |
| `steps`, `calories`, `sleep_*_s` | `queryDailyHealthData`. `sleep_total_s` includes awake time |
| `sleep_score`, `bed_time`, `wake_time` | `querySleepOverview`, main sleep window |
| `training_load` | `queryTrainingLoadAssessment`'s short-term load |
| `vo2max`, `recovery` | `queryFitnessAssessmentOverview`, `queryRecoveryStatus`: the run date's row only |

- **Blank, never 0.** A value the text does not carry is sent as `''`. A date
  every tool was silent about gets no row.
- **Strict.** A label the parser does not use is ignored. A label it does use
  with a value, unit or shape it does not recognize fails **that date**: the
  date gets no row, the log names the date, tool and line, the other dates are
  still written, and the run exits non-zero. The archive is never modified, so
  the fix is a parser change and a re-run.
- Rows go to `upsertDailyHealth` in batches under the API's payload limit
  (11 full dates take two), each row carrying `raw_ref` (the bundle's Drive file
  ID) and the run's single `synced_at`.
- Then, once and last, `rebuildDailySummary(D − 10, D)`, so `DailySummary!M–Q`
  pick up the new values. A date with health data and no workouts gets a
  health-only summary row. #166's activity writes go before it, in
  `src/sheet.mjs`.

A missing `THRIVE_API_URL`/`THRIVE_API_KEY` costs the sheet write, never the
archive: the run archives first, then fails naming both.

## When a run fails

| Error | Meaning | Fix |
|---|---|---|
| `CorosGrantDeadError` | COROS refused the refresh token, and Drive held no newer one | `node authorize.mjs` |
| `DriveAuthError` | Google refused the bot's Drive credential, or a secret is missing | `node google-authorize.mjs`, then update `GOOGLE_DRIVE_REFRESH_TOKEN` |
| `TokenPersistError` | A rotated COROS token could not be written to Drive | Re-run the workflow. If it then reports a dead grant, `node authorize.mjs` |
| `CorosUnavailableError` | COROS is down or erroring after 3 attempts | Nothing. The next run retries |
| `N failure(s): activity …` | One activity's detail, or the health bundle, failed after 3 attempts. Everything else landed | Nothing, if it clears on the next run. If one activity keeps failing, look at its logged error |
| `COROS no longer offers …` | A tool was renamed or removed | Check `tools/list` and update `src/ingest.mjs` |
| `health <date>: not written, unrecognized format in <tool>: …` | COROS changed how it words a value the parser reads | Fix `src/normalize-health.mjs` for the quoted line, then re-run. The archive still holds the text |
| `THRIVE_API_URL and THRIVE_API_KEY not set` | The Actions secrets are missing | `gh secret set THRIVE_API_URL` and `gh secret set THRIVE_API_KEY` |
| `DailyHealth: …` / `DailySummary rebuild: …` | The Thrive API refused the write or was unreachable | Read the quoted error. The next run re-sends the whole window |

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
