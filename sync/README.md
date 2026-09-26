# thrive-sync

The COROS → Thrive sync (epic #163, design in `docs/coros-sync-plan.md`).
It is a plain Node script with no model in the loop. It runs in GitHub Actions
(`.github/workflows/coros-sync.yml`), four times a day (#156), and every run
writes one `SyncLog` row.

It authorizes against COROS and keeps the rotating token in Drive (#151), lands
the window's raw COROS payloads in Drive, unmodified (#152), then normalizes
daily health (#165) and activities (#166) from that archive into the sheet's
`DailyHealth` and `Workouts` tabs through the Thrive API, and rebuilds
`DailySummary` for the window. Each synced activity's FIT file is stored in
Drive too, within COROS's 50-a-day allowance (#154).

## Credentials

| What | Where | Rotates? |
|---|---|---|
| Bot account's Google OAuth client ID and secret | Actions secrets `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | No |
| Bot account's Drive refresh token (`drive.file`) | Actions secret `GOOGLE_DRIVE_REFRESH_TOKEN` | No, once published to Production |
| COROS client ID, refresh and access tokens | `Thrive COROS/coros-token.json` in the bot's Drive | **Yes, on every refresh** |
| Withings client ID and secret (#196) | Actions secrets `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`; environment variables for a local run | No |
| Withings user ID, refresh and access tokens | `Thrive Withings/withings-token.json` in the bot's Drive | **Yes, on every refresh** |
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
- Then, once and last, after the activities below, `rebuildDailySummary(D − 10, D)`,
  so `DailySummary` picks up both. A date with health data and no workouts gets a
  health-only summary row.

## Activities into the sheet (#166)

Every activity the run's list named is read back from the archive and merged
into `Workouts`, on every run, not only when its payload changed: the merge is
idempotent, and a parser fix then re-applies without a replay.

**Type from the sport code** (`src/sport-codes.mjs`):

| Code | `type` | `sub_type` |
|---|---|---|
| 100 run, 102 trail run, 103 track run | `run` | `outdoor` |
| 101 indoor run | `run` | `indoor` |
| 104 hike | `hike` | blank |
| 200 bike, 202 e-bike, 299 helmet bike | `bike` | blank: terrain unknown, never defaulted |
| 201 indoor bike | `bike` | `indoor` |
| 203 gravel bike | `bike` | `gravel` |
| 204 mountain bike, 205 mountain e-bike | `bike` | `mountain` |
| 900 walk | `walk` | `outdoor` if the list entry has `Start Coordinates`, else `indoor` |
| 402 strength | no row of its own: enriches the hand-logged `weight` row (below) | |
| 1200 hybrid fitness | as 402, without moving time (below) | |
| anything else | archived, no row, logged with its ID and code; not a failure | |

**Numbers from the detail prose** (`src/normalize-activity.mjs`), strictly, as
in #165: an unused label is ignored, a used label with a value or unit the
parser does not know fails that activity (no row, the line logged, the run
non-zero), and an absent label is blank, never 0.

| Field | From |
|---|---|
| `date`, `time`, `started_at_utc` | the list entry's `startTimestamp`, in `America/Denver`; `started_at_utc` is ISO 8601 with the offset then in effect |
| `name` | the list entry's name (the detail payload has none) |
| `elapsed_seconds` | `Total Time`, else the list entry's end − start (a walk has no `Total Time`) |
| `moving_seconds` | `Workout Time`: timer time with pauses removed, COROS's nearest to moving time |
| `distance_m` | `Distance: 0.52 km`, ×1000. COROS shows two decimals, so 10 m resolution |
| `ascent_m`, `descent_m` | `Elevation Gain / Loss: 3 m / 3 m`. No ascent indoors; descent for `hike` only (`cardioFieldsFor()`) |
| `avg_hr`, `calories` | `Average Heart Rate: 84 bpm`, `Calories: 17 kcal` |

Durations read `m:ss`/`mm:ss`, and `h:mm:ss` **unconfirmed**: nothing archived
so far ran over an hour.

**The merge runs in the API** (`upsertSyncedWorkout`, see `apps-script/README.md`).
The sync sends the normalized fields as `incoming` and the archive's
`normalized` as `last_written`; the action writes a field only while the sheet
still holds what the sync last wrote, so a rename or a corrected `sub_type`
made in Thrive survives every later run. What the sheet then holds is written
back to the archive's `normalized` (only when it changed), with `edited`
naming the fields the user changed. A row deleted in Thrive is not recreated.

**A rename in COROS** shows only in the list, which #152 archived only when the
detail changed. The archive now also refreshes an activity's `list_entry` when
it changed, ignoring its position in the list, so the name follows it (unless
the name was edited in Thrive).

A missing `THRIVE_API_URL`/`THRIVE_API_KEY` costs the sheet write, never the
archive: the run archives first, then fails naming both.

## Strength sessions (#155)

A COROS strength session (402) never gets a `Workouts` row. Hand logging is
the record: COROS has set counts but no reps or weight (#133). Instead, the
session fills blanks on the matching hand-logged `weight` row through the
API's `enrichWorkout` action (see `apps-script/README.md`). The match and the
write happen in one execution. Sync plan §7 is the design.

- **Parsed like any activity** (`normalizeActivity`): `Workout Time` gives
  `moving_seconds`, `Total Time` gives `elapsed_seconds`, and `Average Heart
  Rate` and `Calories` fill their fields. `Sets:` is not used. A line it does
  use but cannot read fails the activity, as for any sport.
- **The match:** `type = 'weight'`, the same local date, hand-logged, not yet
  linked, finished (not `planned` or `active`), with `Time` within **30
  minutes** of the session's local start. A blank `Time` counts as within.
  Exactly one such row matches. None, or several, is `unmatched`: a line in
  the run's `SyncLog.notes`, never a failure, and nothing is written. Every
  run while the session is in the window tries again, so a workout logged late
  still matches.
- **What it writes:** `avg_hr`, `calories`, `moving_seconds` and
  `elapsed_seconds`, each **only where the row holds a blank**, plus
  `source_activity_id`, `raw_ref` and `synced_at`. `source` stays `''`.
- **Once filled, a field is the user's.** The archive's `normalized` is
  `{ enrichment: { workout_id, filled } }`, and a field named there is never
  written again, even after an edit or a clearing in Thrive. A re-run with
  nothing new writes nothing. A row whose link cells are cleared by hand is
  matched afresh.
- **No FIT** is requested for strength.
- **Hybrid Fitness (1200) takes the same path** (#194), for when it is used
  as a set/rest timer. Its `Workout Time` equals `Total Time` and includes
  the rests, so `moving_seconds` is sent blank and never filled from it.
  Every sub-mode (Race, Training, Test) is treated alike: the detail does not
  say which, and a race with nothing hand-logged is simply unmatched. Its
  logs and notes say `strength`.
- `SYNC_LOG=summary` prints only `Strength: N enriched, M unmatched`. The IDs
  are in `SyncLog.notes`.

The tolerance is one constant, `STRENGTH_MATCH_TOLERANCE_MINUTES` in
`apps-script/src/types.js`. It was set from one real session, whose watch start
was about 9 minutes before the row's `Time` (the SPA stamps `Time` when Start
is tapped).

## FIT files (#154)

Every activity that gets a `Workouts` row gets its FIT file, indoor ones
included: an indoor ride's FIT still carries its second-by-second heart rate.
Strength (402) and Hybrid Fitness (1200) are §7's and get none, and an unmapped code (400 gym cardio
included) has no row to record one on. `src/fit.mjs`:

- **The tool is `downloadActivityFitFiles`**, with `{ labelId, sportType }` from
  the list. It returns the file as a base64 `resource` blob
  (`coros://activity-fit-files/<labelId>.fit`). `queryActivityFitFileDownloadUrls`
  would return an unauthenticated S3 URL instead, a secret, so the sync never
  calls it and the URL never exists in the process. `redact()` masks one
  anyway.
- **Stored, not parsed.** The bytes are checked for being whole FIT files
  (header, declared size, header and file CRC), then stored as they came in
  `Thrive COROS/fit/<YYYY>/<MM>/<activityId>.fit`, foldered by local start
  date and tagged `{ source: coros, kind: fit, fit_activity_id }`. The tag is
  not `activity_id`, which would make the activity JSON's lookup match two
  files.
- **On the row**, through the same `upsertSyncedWorkout` call, as sync-owned
  fields: `fit_ref` is the FIT's Drive file ID, and `fit_fetched_at` the run
  that fetched it. Both blank means not fetched yet. `fit_fetched_at` set
  with `fit_ref` blank means the sync gave up: no FIT will be fetched.
- **The archive remembers.** Each activity's archive file carries a `fit`
  record (`status`, `file_id`, `fetched_at`, `attempts`, `last_error`), which
  an ingest update carries over like `normalized`. A FIT on record is never
  requested again, and is re-sent to the row on every run, so a row write
  that failed heals. A FIT that is in Drive while the record is missing (a
  run died between the two) is adopted without a request.

**The budget** is `50 − sum(n_fit_fetched)` over the `SyncLog` rows that
started in the 24 hours before this run. It is derived, never stored. COROS's
allowance is a fixed 24-hour window opening at its first request, and a rolling
24 hours always covers it, so the sync can under-spend but never over-spend.

- The budget is read (`getSyncLog`, 100 rows) only when an activity needs a
  request, oldest activity first. At 0 the run stops asking, logs how many
  activities are waiting, and carries on. That is not a failure; the next run
  resumes.
- If it cannot be read, nothing is requested, and the run records why.
- `n_fit_fetched` counts **requests**, failed ones included, because COROS may
  have counted each.
- **A FIT that keeps failing** is requested once a run, with no retry inside
  the run, and each failure is a run failure. After **3** failed requests the
  sync gives up on it for good. A Drive failure after a good download does
  not use up an attempt.
- `THRIVE_FIT_BUDGET=<n>` lowers a run's budget to `n`, never raises it. It is
  for testing the cap without spending the real allowance.
- A request made outside the sync (a probe, another client) does not appear
  in `SyncLog`, so the sync cannot count it.

## Schedule, SyncLog and the dead-man's switch (#156)

**Four runs a day**, `17 9,13,18,0 * * *`: 03:17, 07:17, 12:17 and 18:17 MDT,
an hour earlier in MST. DST drift is accepted (sync plan §9). 03:17 closes out
yesterday; 07:17 brings in last night's sleep. `workflow_dispatch` still works,
with `force_refresh`. The `coros-sync` concurrency group queues and never
cancels a running job. GitHub keeps one *pending* run per group, so a newer one
cancels an older pending one. That run never started and writes no row, and the
window covers it.

**One `SyncLog` row per run**, written last, whatever happened (`src/sync-run.mjs`):

| Field | Holds |
|---|---|
| `run_id` | `schedule-<run id>-<attempt>`, `workflow_dispatch-…`, or `local-<started_at>` |
| `started_at`, `finished_at` | ISO instants; `started_at` is the run's `synced_at` |
| `window_start`, `window_end` | D − 10 and D + 1 |
| `n_seen` | activities the COROS list named |
| `n_new`, `n_updated` | `Workouts` rows created; rows whose merged fields actually changed |
| `n_enriched` | hand-logged strength rows the run wrote to (#155) |
| `n_fit_fetched` | FIT requests made, failed ones included (#154). The next run's FIT budget is summed from it |
| `n_errors`, `status`, `error_detail` | `ok` (exit 0), `partial` (completed with failures, exit 1), `failed` (aborted, exit 1, detail led by the error class, e.g. `CorosGrantDeadError: …`) |
| `notes` | what the run noted that is not a failure: a strength session left unmatched, with its ID, local start, reason and any candidate workout IDs (#155). Blank when none |

A row that cannot be written fails the run too.

**The Actions log is public**, because the repo is. The workflow sets
`SYNC_LOG=summary`. The log then carries counts, dates, `status`, `run_id` and
error class names, and nothing COROS sent. The detail is in the run's
`SyncLog.error_detail` in the sheet. Run `node run.mjs` locally, without
`SYNC_LOG`, for the full step-by-step log.

**The dead-man's switch** is `coros-sync-watchdog.yml`. Every 3 hours it runs
`node deadman.mjs` and fails when the newest `SyncLog` row, of any status, is
more than **16 hours** old:
- The gaps between runs are 9, 4, 5 and 6 h, so one dropped run leaves at most
  15 h. That never alarms.
- A stopped job is reported within 19 h.
- To prove it trips without touching data, run
  `node deadman.mjs --now <an ISO instant a day ahead>` or `--threshold-hours 0.01`.

It cannot see GitHub's scheduler stopping for the whole repo. That includes
the auto-disable after 60 days with no activity on a public repo. That layer is
#157's "last synced" line.

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
| `THRIVE_API_URL and THRIVE_API_KEY not set`, or `ThriveApiError (config)` in a summary log | The Actions secrets are missing | `gh secret set THRIVE_API_URL` and `gh secret set THRIVE_API_KEY` |
| `SyncLog row … was not written` | The API refused or missed the run's row. The rest of the run may have landed | Read the quoted error (a local run shows it). A missing tab means `scripts/migrate-156-sync-log-tab.mjs` has not run |
| `coros-sync-watchdog`: `has not run for N hours` | No sync has recorded a run within 16 h | Actions → coros-sync: is the schedule enabled, and are runs cancelled or timing out? |
| `Lock timeout` | Another API caller held the script lock for over 30 s | Nothing, if it clears. The next run re-sends the window |
| `DailyHealth: …` / `DailySummary rebuild: …` | The Thrive API refused the write or was unreachable | Read the quoted error. The next run re-sends the whole window |
| `activity <id>: not written, unrecognized format in getActivityDetail: …` | COROS changed how it words a value the activity parser reads | Fix `src/normalize-activity.mjs` for the quoted line, then re-run. The archive still holds the text |
| `activity <id>: upsertSyncedWorkout: N Workouts rows are coros activity …` | Two rows claim one COROS activity | Delete all but one in Thrive, then re-run |
| `activity <id>: enrichWorkout: N Workouts rows are enriched from activity …` | Two hand-logged rows carry one strength session's ID | Clear `source_activity_id` on all but one, then re-run |
| `SyncLog row … was not written` naming `notes` | The API is newer than the tab | Run `scripts/migrate-155-sync-log-notes.mjs` |
| `activity <id>: FIT request n of 3 failed` | COROS errored, or sent something that is not one whole FIT file for that activity | Nothing. The next run tries again, up to 3 requests in all |
| `activity <id>: FIT request failed 3 times, so the sync has stopped asking for it` | It gave up. The row gets `fit_fetched_at` with `fit_ref` blank | Read `fit.last_error` in the activity's archive file. To retry, delete its `fit` record there |
| `FIT budget unknown, so no FIT was requested this run` | `getSyncLog` failed, or 100 rows of the last 24 h leave older ones unread | Read the quoted reason. The next run tries again |
| `activity <id>: FIT downloaded but not stored in Drive` | The Drive upload failed | Nothing. The next run requests it again, which spends one more of the allowance |
| `COROS no longer offers downloadActivityFitFiles` | The FIT tool was renamed or removed. Everything else still ran | Check `tools/list` and update `src/fit.mjs` |
| `WithingsGrantDeadError` | Withings refused the refresh token (or the grant was revoked), and Drive held no newer one | `node withings-authorize.mjs` |
| `WithingsTokenPersistError` | A rotated Withings token could not be written to Drive | Re-run the workflow. If it then reports a dead grant, `node withings-authorize.mjs` |
| `WithingsUnavailableError` | Withings is down, rate limiting, or erroring after 3 attempts | Nothing. The next run retries |
| `WithingsRequestError` | Withings refused a request with a status that is neither the grant nor an outage | Look the quoted status up in Withings' [response status list](https://developer.withings.com/api-reference/#section/Response-status) and fix `src/withings-oauth.mjs` |
| `WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET are not both set` | The Actions secrets are missing | `gh secret set WITHINGS_CLIENT_ID` and `gh secret set WITHINGS_CLIENT_SECRET` |
| `withings-sync-watchdog`: `has not run for N hours` | No Withings run has recorded a row within 14 h | Actions → withings-sync: is the schedule enabled, and are runs cancelled or timing out? |
| `withings-sync-watchdog`: `WithingsSyncLog is empty` or `Could not read WithingsSyncLog` | No run has logged yet, the tab is missing, or the API is down | Run `scripts/migrate-200-withings-sync-log-tab.mjs` if the tab is missing, then dispatch withings-sync |
| `WithingsSyncLog row … was not written` | The tab is missing, or the API refused the row | Run `scripts/migrate-200-withings-sync-log-tab.mjs`; read the row's error with `node withings-run.mjs` locally |
| `ApiIgnoresLogError` | The deployed Apps Script predates #200 and would file Withings runs in `SyncLog`. Nothing was written | Deploy `apps-script/`, then re-run |
| `BodyMeasurements not written` | The API refused the rows, or `THRIVE_API_URL`/`THRIVE_API_KEY` is missing. The archive stands | Read the quoted error. The next run re-sends the whole window |

## How the token is kept

- **Refresh only near expiry.** Access tokens live 30 days. A run refreshes only within 5 days of
  expiry, so rotation happens about monthly, not on every run.
- **Persist before use.** A rotated token is written to Drive before the run does anything else
  with it.
- **One re-read before giving up.** An `invalid_grant` usually means another process rotated
  first. The run re-reads Drive and retries once, but only if the file holds a different token.
- **Never two at once.** The workflow's `concurrency: coros-sync` group queues runs, and never
  cancels one mid-refresh.

In a summary-mode log, a failure is only counted, and an abort shows only its
class, e.g. `Aborted by CorosGrantDeadError`. Match the class against the table
above; the message is in that run's `SyncLog` row.

## Withings (#196)

Withings (scale, blood pressure) is authorized once, like COROS, and its
rotating token lives in Drive, in its own root: `Thrive Withings/withings-token.json`,
tagged `{ kind: 'withings-token' }` under a folder tagged `{ kind: 'thrive-withings-root' }`.
It holds `userid`, `refresh_token`, `access_token`, `access_expires_at` and
`updated_at`. A separate root and separate tags mean no lookup can match a
COROS file. Fetching measures is below ("The Withings archive", #197), then
the tab (#198) and the schedule, run log and watchdog (#200).

### 1. Register the developer app

In the [Withings developer dashboard](https://developer.withings.com/dashboard/),
signed in as the Withings account whose data Thrive reads:

1. **Create an application** of type **Public API integration** (free plan).
2. **Callback URL:** `https://luketmoss.github.io/thrive/withings-callback.html`,
   exactly. Withings refuses localhost and IP redirects, so the callback is a
   static page on GitHub Pages (`frontend/public/withings-callback.html`). It
   shows the authorization response for you to paste back, and sends it nowhere.
3. **Scopes:** `user.metrics,user.info` (the script asks for these).
4. Store the client ID and secret:
   ```bash
   gh secret set WITHINGS_CLIENT_ID --repo luketmoss/thrive
   gh secret set WITHINGS_CLIENT_SECRET --repo luketmoss/thrive
   ```

### 2. Authorize

Needs the Google credential from step 2 of the one-time setup.

```bash
cd sync
WITHINGS_CLIENT_ID=… WITHINGS_CLIENT_SECRET=… node withings-authorize.mjs
```

It prints and opens the authorize URL. Sign in and allow access; Withings
sends the browser to the callback page, which shows the **Authorization
response** (`code=…&state=…`) with a **Copy** button. Paste it into the
terminal and press Enter **within 30 seconds**: that is how long a Withings
code lasts. The full callback URL or a bare code work too. A response whose
`state` is not this sign-in's is refused. A code Withings refuses as expired or
used is asked for again, up to 3 times. On success the script writes the token
file (a re-run updates the same one), then makes one authenticated
`user.metrics` call and prints only how many measure groups it returned.

### How its token is kept

As COROS's (above), through the same code (`rotateAndPersist` in `src/tokens.mjs`),
with one difference: Withings access tokens last **3 hours**, so a run refreshes
when less than **15 minutes** are left, and nearly every run rotates. The refresh
token lasts a year but dies 8 hours after its replacement is issued, or as soon
as the new access token is used. Persist-before-use and one run at a time are
therefore what keep the grant alive.

**Withings reports failure as HTTP 200 with a non-zero `status`.** The sync
classifies on `status`, through one table, `WITHINGS_STATUS` in
`src/withings-oauth.mjs`, built from Withings'
[response status list](https://developer.withings.com/api-reference/#section/Response-status):

| Row | Withings' label | Becomes |
|---|---|---|
| `auth` | Authentication failed, Unauthorized | `WithingsGrantDeadError` (after one re-read of Drive) |
| `params` | Invalid params | At the token endpoint, a refused code or refresh token (as `auth`). Elsewhere `WithingsRequestError` |
| `unavailable` | An error occurred, Timeout, Too many requests, An unknown error occurred | `WithingsUnavailableError`, retried with backoff first. So are an HTTP 5xx or 429 and a network failure |
| `request` | Bad state, Wrong action or wrong webservice, and any status not in the list | `WithingsRequestError`, not retried |

No Withings token, client secret or authorization code reaches a log, stdout or
an error: each is registered with `redact()` when first seen, and `redact()`
also masks them as JSON fields and as `code=`/`client_secret=`/`refresh_token=`/`access_token=`
parameters.

## The Withings archive (#197)

```bash
cd sync
WITHINGS_CLIENT_ID=… WITHINGS_CLIENT_SECRET=… node withings-run.mjs
```

Needs the Google credential and a Withings token file (both above). Each run gets
an access token (refreshing and persisting it first if needed), then calls
`getmeas` for a rolling window, **local D − 30 days through the end of D + 1**,
where D is today in `America/Denver`, sent as `startdate`/`enddate` epochs.
Re-reading 30 days, rather than asking for changes since the last run with
`lastupdate`, is what picks up edits made in the Withings app. The form is
`action=getmeas`, `category=1` (real measurements, not goals) and
`meastypes=1,5,6,8,9,10,11,76,77,88` (weight, fat-free mass, fat ratio, fat mass,
diastolic, systolic, heart pulse, muscle mass, hydration, bone mass: all free-plan
types; 11 is both the cuff's pulse and the scale's standing heart rate). It
follows `more`/`offset` until `more` is 0. The window is a parameter
(`withingsRun({ window: { startdate, enddate } })`) so the backfill (#199) can
pass `startdate: 0`.

Each group lands under `Thrive Withings` in the bot's Drive:

| File | Tagged (`appProperties`) | Holds |
|---|---|---|
| `measures/<YYYY>/<MM>/<grpid>.json`, foldered by the group's `date` as a local date in `America/Denver` | `source=withings`, `grpid` | `source`, `grpid`, `payload`, `payload_hash`, `fetched_at` |

- **`payload` is the group object as Withings returned it**, key order kept.
  Withings answers in JSON, so the parsed object loses nothing a re-parse needs,
  and one file per group keeps `raw_ref` pointing at one reading. A value is
  `value × 10^unit`; nothing in the archive converts it (the normalizer below does). There is no
  `normalized` field: Withings rows take no hand edits to merge with.
- **`payload_hash` is `sha256(JSON.stringify(group))`.**
- **Idempotent, and a file's ID never changes.** It is COROS's archive code
  (`createArchiveStore` in `src/archive.mjs`) with Withings' own root and tags.
  A file is found by its tags, never by name, so a moved or renamed file is
  updated rather than duplicated. An unchanged hash writes nothing; a changed one
  (the group was edited in Withings) rewrites the same file, so its Drive ID, the
  future `BodyMeasurements!raw_ref`, is stable. A `grpid` matching two files is
  refused, naming both; trash all but one.
- **Errors are never archived.** A page answered with a non-zero `status`, an
  HTTP 5xx or 429, or a network failure is retried with backoff, three attempts
  in all, when it is transient (the `unavailable` row above). A page that still
  fails ends the fetch: the groups of earlier pages are archived, nothing from
  the error is, and the run exits non-zero naming the class
  (`WithingsUnavailableError`, or `WithingsGrantDeadError` for a refused token).
  A group whose Drive write fails is logged with its `grpid`, the others are
  still written, and the run exits non-zero.
- The run prints counts and `grpid`s, never a measurement. In summary mode
  (the workflow's), not even the `grpid`s: see #200 below.

## BodyMeasurements (#198)

After the archive, the same run writes the sheet:

```bash
cd sync
WITHINGS_CLIENT_ID=… WITHINGS_CLIENT_SECRET=… THRIVE_API_URL=… THRIVE_API_KEY=… node withings-run.mjs
```

Every group whose archive write succeeded is normalized
(`src/normalize-withings.mjs`, pure) into one `BodyMeasurements` row, and the
rows are sent to the API's `upsertBodyMeasurements` in batches under the payload
limit, with the run's one `synced_at`. A group whose archive write failed has no
`raw_ref`, so it is not sent. The run prints the groups seen, rows appended and
updated, groups skipped as unattributed, and groups failed. Rows are re-derived
from the archive on every run, and nothing writes back to it.

**The normalizer rules:**

| Type | Column | Type | Column |
|---|---|---|---|
| 1 | `weight_kg` | 88 | `bone_mass_kg` |
| 6 | `fat_ratio_pct` | 10 | `systolic_mmhg` |
| 8 | `fat_mass_kg` | 9 | `diastolic_mmhg` |
| 5 | `fat_free_mass_kg` | 11 | `pulse_bpm` (the cuff's pulse, or the scale's standing heart rate) |
| 76 | `muscle_mass_kg` | 77 | `hydration_kg` |

- **A value is `value × 10^unit`, as an exact decimal string**, made by shifting
  the decimal point, never through floating point: `72345, -3` is `72.345`.
  Trailing zeros are trimmed; nothing is rounded. SI units are stored.
- `kind` is `bp` when the group has type 9 or 10, `scale` when it has any of 1,
  5, 6, 8, 76, 77 or 88. A column the group has no measure for is `''`, never `0`.
- `date`, `time` and `measured_at_utc` come from the group's `date` epoch in
  `America/Denver`, with the offset then in effect, as `Workouts` does.
  `device_model` is the group's `model` text; `raw_ref` its archive file's ID.
- **Only attributed groups are written.** `attrib` follows Withings' published
  meanings: 0 captured by a device and known to be this user's, 2 entered
  manually, 4 entered manually at sign-up, 5 the BPM's computed best value, 7
  confirmed by the user, 8 as 0. **1 is ambiguous** (a guest, or another user):
  it is not written. Neither is any code not on that list. A skipped group is
  counted, printed with its `grpid` and `attrib` as the run's notes, and is
  **not** a failure. Record here any code seen live that is not on the list.
- A measure type not in the table is ignored.
- **A known type with an unexpected shape fails that group only**: a
  non-integer (or negative) `value`, a non-integer `unit`, a type repeated in the
  group, a group with both scale and BP types, or a group with no known type
  besides 11. It is logged with its `grpid` and type (never its value), the
  other groups are written, and the run exits non-zero.
- **A missing `THRIVE_API_URL`/`THRIVE_API_KEY` costs the sheet write, never the
  archive**: the run archives first, then fails naming both. So does an API
  refusal, e.g. before `scripts/migrate-198-body-measurements-tab.mjs` has made
  the tab.

### DailySummary rollup (#203)

After the sheet write, when it appended or updated at least one
`BodyMeasurements` row, the run calls `rebuildDailySummary` once, over
`window.start` to `window.runDate` — D − 30 to D, the same bounds as the
fetch window, leaving out the D + 1 lookahead day nothing has fully happened
in yet. A run that changed nothing does not rebuild. A failed rebuild is
reported and fails the run, without undoing the sheet write.

**The backfill (#199) never rebuilds.** Its range can span years of history,
and a single `rebuildDailySummary` call has the same Apps Script execution
ceiling `scripts/backfill-131-daily-summary.mjs` exists to chunk around.
Filling U:Y for backfilled history is a manual step for the owner, once,
after the backfill lands and the API is deployed:

```powershell
THRIVE_API_URL=... THRIVE_API_KEY=... node scripts/backfill-131-daily-summary.mjs --restart
```

That script already rebuilds in resumable chunks over any range it is given
(`--from`/`--to`, or the whole `Workouts` history by default) — it needs no
change for #203, since `rebuildDailySummary` reads `BodyMeasurements` itself.
Its default range is `getHistoryDateRange`'s span of `Workouts`, not
`BodyMeasurements`: a body-only day *within* that span gets its row (a day
with a workout on either side is already rebuilt), but a scale or BP reading
from **before the first workout or after the last** needs an explicit
`--from`/`--to` covering the Withings account's own history, or that day's
row is never written.

### Readings deleted in the Withings app (#215)

**`getmeas` silently omits a deleted group** once the deletion has propagated
(minutes after the delete; found live in #212). There is no flag and no
tombstone, so absence from a **complete** fetch is the only signal. After the
upsert, the run calls the API's `reconcileBodyMeasurements` once with the
window's local dates (`from`/`to`), every `grpid` the fetch returned
(`present_grpids`, unattributed and unnormalizable groups included, since
they are not deleted), and the cap (`max_deletions`). The API deletes, under
its lock, the rows dated in the window whose `grpid` is not in the list, and
answers `{ deleted, refused }`. `src/withings-reconcile.mjs` holds the sync's
half.

- **Only after a complete fetch.** A page Withings would not serve (#197 AC3),
  or any group whose archive write failed, means the run never calls it; the
  full log says `fetch incomplete: deletions not checked`. Neither does a run
  whose upsert failed.
- **Capped at 5 deletions a run.** Over the cap, the API deletes **nothing**
  and the run is `partial`, `error_detail` reading `refused to delete N
  BodyMeasurements rows (cap 5): check Withings, then re-run with
  WITHINGS_MAX_DELETIONS=N`. So is a fetch that returned **no groups at all**
  while the window holds rows, however few: a Withings fault answering
  `status 0` with an empty list must not empty the tab. To let a real sweep
  through, check the readings really are gone in the app, then dispatch
  `withings-sync.yml` with `max_deletions` set to N (locally,
  `WITHINGS_MAX_DELETIONS=N`). That raises the cap for that run only, and,
  because the owner has now checked, also lets an empty answer delete. The
  schedule always uses the default.
- **The archive remembers.** A deleted row's archive file gains
  `deleted_seen_at` (the run's timestamp); its `payload` and `payload_hash`
  are untouched and the file is never deleted. If a later run returns that
  `grpid` again, the group is upserted as usual and the mark is removed.
- **Recorded.** `WithingsSyncLog.notes` gets `deleted in Withings: <n>
  (<grpid>, …)`. The public Actions log prints the count only.
- **The rollup follows.** A run that deleted rows rebuilds `DailySummary` over
  D − 30 to D, as one that appended or updated does.
- **The backfill applies the same rule over its whole range, under the same
  cap**, but still never rebuilds (above): for a backfill, deletions appear in
  `notes` alone, and history's U:Y wait for the owner's
  `backfill-131-daily-summary.mjs` run. A range whose `present_grpids` would
  not fit one request (only a backfill's, at a few hundred groups) is split
  into consecutive date ranges, each still holding at least one `grpid`. The
  cap is shared across them — each request is offered only what is left of
  it, so a run never deletes more than the cap in total — but a later range's
  refusal cannot undo an earlier range's deletions.
- **Deletions outside the window are not seen** by the rolling run; the next
  backfill cleans them up, under the cap.

**Until `apps-script/` is redeployed** with this action, the deployed API
answers `Unknown action: "reconcileBodyMeasurements"`. That fails the
deletion step alone: the archive, the upsert, the rollup and the log row all
happen as before, and the run is `partial` with `BodyMeasurements deletions not
checked: …` in `error_detail`, until the owner deploys.

## Withings: schedule, log and watchdog (#200)

**Four runs a day**, `.github/workflows/withings-sync.yml` on
`41 1,7,13,19 * * *`: 01:41, 07:41, 13:41 and 19:41 UTC, every 6 hours, at a
minute clear of COROS's :17 and both watchdogs. Withings asks for at most one
poll per 10 minutes, and weight and BP change slowly. `workflow_dispatch` works
too. Each run is `node withings-run.mjs` with a 15-minute timeout, in the
`withings-sync` concurrency group, which queues and never cancels: the 3-hour
access token means nearly every run rotates the refresh token, and a cancelled
run could die between refresh and persist. It is not the `coros-sync` group:
the two share no token. The workflow gets only the three Google secrets, the
two Withings secrets and `THRIVE_API_URL`/`THRIVE_API_KEY`.

**One `WithingsSyncLog` row per run**, written last, whatever happened
(`withingsSyncRun` in `withings-run.mjs`, the run-and-log shape of
`src/sync-run.mjs`, built from `src/run-log.mjs`). The tab has `SyncLog`'s A:N
layout, made by `scripts/migrate-200-withings-sync-log-tab.mjs`:

| Field | Holds |
|---|---|
| `run_id` | as `SyncLog`: `schedule-<run id>-<attempt>`, `workflow_dispatch-…`, or `local-<started_at>` |
| `started_at`, `finished_at` | ISO instants; `started_at` is the run's `synced_at` |
| `window_start`, `window_end` | D − 30 and D + 1 |
| `n_seen` | measure groups fetched |
| `n_new`, `n_updated` | `BodyMeasurements` rows appended; rows changed |
| `n_enriched`, `n_fit_fetched` | always `0` |
| `n_errors`, `status`, `error_detail` | `ok` (exit 0), `partial` (a group not archived or not normalized, or the sheet write failed; exit 1), `failed` (the fetch was cut short or never began, e.g. `WithingsGrantDeadError: …`; exit 1). Redacted, and led by the error class |
| `notes` | groups skipped as unattributed, with `grpid` and `attrib`. Not a failure |

A row that cannot be written fails the run. A re-sent `run_id` is not appended
twice.

**Why a separate tab.** `SyncLog` has no source column. COROS's watchdog, the
Settings "Last synced" line and COROS's FIT budget all read it, so a Withings
row there would make a stopped COROS sync look alive. The API's
`appendSyncLog`/`getSyncLog` take `log: 'withings'` to select
`WithingsSyncLog`; without it they are exactly as before, `SyncLog` only. An API
deployed before #200 ignores `log`, so before appending the run reads the newest
row of both logs: if they are the same row, it writes nothing and fails with
`ApiIgnoresLogError`.

**The Actions log is public.** The workflow sets `SYNC_LOG=summary`: the log
carries the `run_id`, window dates, counts, `status` and error class names. No
`grpid`, measurement, device model or Withings response text; those are in the
run's `WithingsSyncLog` row. Run `node withings-run.mjs` locally, without
`SYNC_LOG`, for the full log.

**The dead-man's switch** is `withings-sync-watchdog.yml`, on `53 */3 * * *`
in its own concurrency group. It runs `node deadman.mjs --log withings`, and
fails when the newest `WithingsSyncLog` row, of any status, is more than
**14 hours** old, or the tab is empty or unreadable:
- The runs are 6 h apart, so one dropped run leaves 12 h, plus an hour of
  scheduler delay makes 13. That never alarms.
- A stopped job is reported within 14 + 3 h.
- It reads only `WithingsSyncLog`, and `node deadman.mjs` with no flag reads
  only `SyncLog`, so neither sync can hide the other stopping.
- `--now` and `--threshold-hours` prove it trips, as for COROS.

As with COROS, it cannot see GitHub's scheduler stopping for the whole repo.

## Backfilling Withings history (#199)

**One dispatch, once, to land the account's whole history** — every measure
group from its first reading to today — into `BodyMeasurements`, through the
same archive → normalize → upsert path the scheduled sync uses:

```
gh workflow run withings-sync.yml --repo luketmoss/thrive -f backfill=true
```

(PowerShell quoting is the same; there is no separate local backfill command —
see Out of Scope in #199.)

**Why `startdate: 0` is "everything."** `getmeas` takes no "give me it all"
flag, but Withings accepts `startdate=0` and pages the whole account with
`more`/`offset` from there, so no CSV export is needed. `backfill: true` on the
`workflow_dispatch` input sets `BACKFILL=true` for `withings-run.mjs`, which
runs `withingsBackfillWindow` (`src/dates.mjs`) in place of the rolling
30-day window: `startdate: 0`, the same `D + 1` end, and `window_start` fixed
at `1970-01-01` in the `WithingsSyncLog` row, so the row is a backfill on
sight rather than a suspiciously wide 30-day window.

**Why it is a workflow input, not a local script.** Withings' refresh token
rotates on nearly every run (#196). A local backfill running at the same time
as the schedule would present a spent token and could kill the grant. The
`backfill` dispatch runs through `withings-sync.yml` itself, in the same
`withings-sync` concurrency group as the schedule, so the two can never
overlap.

**Cheap on a large first pass.** A per-group `drive.findOne` for thousands of
groups — most of them new — would be the dominant cost of a first backfill.
`backfill: true` instead has `withingsRun` read the archive's whole index
once (`archive.preloadIndex()`, `drive.findAll`, paged past Drive's 10-file-
per-query cap) and looks each group up against that in memory, still matching
by its Withings tag (`grpid`), never by filename. A normal run's ~30-day
window (a handful of groups) skips this and keeps its one `findOne` per
group, which is cheaper than scanning the whole archive every 6 hours.
`BodyMeasurements` writes were already batched under the payload limit
(#198); nothing new was needed there.

**Rate limits.** `getmeas` pages are retried with growing backoff
(`src/retry.mjs`) on Withings' "Too many requests" and every other
`unavailable` status, exactly as the scheduled sync retries — a backfill
makes one paged burst of `getmeas` calls and nothing else against Withings.

**Safe to re-run, and resumable (AC2).** Archiving and upserting are both
idempotent on `grpid`: a group already archived with an unchanged hash writes
nothing to Drive (`createArchiveStore`'s hash compare), and
`upsertBodyMeasurements` upserts by `grpid`, never appending a duplicate row.
If a backfill times out or Withings errors past its retry budget, re-dispatch
it — Withings has no cursor to resume a page sequence from, so the re-run
re-fetches the whole history again, but everything already landed archives as
`unchanged` and upserts as an update, not a second row. Each dispatch still
writes its own `WithingsSyncLog` row (`run_id` `workflow_dispatch-…`), so a
stopped run and its successful re-run are both on record.

**Timeout.** The job's timeout is 45 minutes for a `backfill: true` dispatch
(15 otherwise, unchanged): the tests exercise this against a fake Withings and
a fake Drive up to several thousand synthetic groups (`test/withings-run.test.mjs`,
"a realistic multi-thousand-group backfill"), which is comfortably inside 45
minutes with the bulk archive lookup; the owner's real account has a few
hundred to a few thousand groups going back years, well inside what was
measured. There has been no live dispatch against the real Withings account
to confirm the number against production latency — if one ever runs long
enough to hit the timeout, AC2 makes a re-dispatch the fix, not a bigger
number here.

## Tests

```bash
npm test
```

`node --test` with fakes for COROS and Drive: no network, no secrets. The unfiltered `sync` job in
`.github/workflows/ci.yml` runs it on every PR.
