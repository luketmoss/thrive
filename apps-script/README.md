# Thrive Apps Script API

The server-side API over the Groundwork sheet. Consumers call this instead of
mapping rows themselves.

## Why this exists

The row layout was duplicated between `frontend/src/api/*.ts` and
`mcp-server/domain.js`, and CLAUDE.md requires they change together. Three more
consumers are arriving — `DailySummary` (#131), the COROS sync, and the
Journal. Without an API each would add another copy.

This **caps the mirror count at two**, permanently, however many consumers
appear. It does not reduce it to one: the SPA still reads Sheets directly and
still mirrors the rules, exactly as Hive's does. The cap is the win.

Since #132 moved the MCP server onto this API, `src/types.js` and
`frontend/src/api/types.ts` are the only two copies. Per CLAUDE.md, a column
added to a tab is added in both.

## Layout

| File | Contents |
|---|---|
| `src/types.js` | Column constants, valid enum values, timezone, payload limit |
| `src/utils.js` | Sheet access, row ↔ object mapping, validation helpers |
| `src/workouts.js` | `Workouts` reads, writes, and planned-by-date |
| `src/exercises.js` | `Exercises`, plus the rename cascade |
| `src/templates.js` | `Templates`, grouped reads and wholesale replace |
| `src/sets.js` | `Sets`, slot resolution, atomic bulk update, history |
| `src/daily-summary.js` | `DailySummary` rollup, rebuild over any range |
| `src/daily-health.js` | `DailyHealth` upsert by date, for the COROS sync (#165) |
| `src/sync-log.js` | `SyncLog` append and newest-first read, one row per sync run (#156) |
| `src/auth.js` | Who is calling: the key, the Google-token check, its cache, the token read allow-list (#144) |
| `src/main.js` | `doGet`/`doPost` dispatch, response envelope |

`Labels` is deliberately absent: `domain.js` contains no Labels code and no
`thrive_*` tool touches it. Tab actions travel with their tabs, so
`DailySummary`'s are in #131's scope, `DailyHealth`'s write in #165's, and
`SyncLog`'s in #156's.

## The transport, and its limit

**Key callers send everything through `doGet`, including writes.** Apps Script
answers every call with a 302 to `script.googleusercontent.com`, and a client
that does not follow a `POST`'s redirect never sees the answer, so writes pass
their data as a URL-encoded `payload` query parameter.

**`doPost` exists too (#144), and behaves identically.** Both entry points run
one handler over `e.parameter`, which Apps Script fills from a form-encoded
body exactly as from a query string. almanac, a browser app, POSTs so a live
Google token never sits in a URL. A browser `fetch` follows the 302 as a `GET`,
and both hops carry `Access-Control-Allow-Origin: *`, so it works provided the
request stays CORS-simple: a `URLSearchParams` body, no headers set by hand.
There is no `doOptions`, so a request that needs a preflight fails before it
starts.

That caps a request at the URL length Apps Script accepts — roughly 8KB for the
whole URL, shared with the action, the key, and percent-encoding overhead that
can triple the size of a JSON payload full of quotes and braces.
`MAX_PAYLOAD_CHARS` is **6000**, leaving headroom for that overhead.

A payload over the limit is **refused by length, before parsing**. That
ordering is the point: the dangerous case is not a parse error but a payload
truncated in transit that still parses, into an object quietly missing its last
fields. #134's bulk actions are the first that will hit this, and they must
batch rather than hope.

## Writes store text; reads see what the SPA sees

`appendRow` and `setValues` behave like **typing into a cell**, not like the REST
API's `RAW` writes the SPA makes. Typed, `"2026-03-04"` becomes a date, `"07:00"` a
time, `"3720"` a number, and `"=anything"` a live formula. So:

- **Every write goes through `asText()`** (`src/utils.js`), which prefixes each value
  with an apostrophe — Sheets' own escape. The value is stored exactly as given, the
  apostrophe is not part of it, and a formula can never be injected.
- **Every read uses `getDisplayValues()`**, never `getValues()`. Display values are
  what the SPA reads (the REST API's default `FORMATTED_VALUE`), so both sides agree —
  and a cell that was stored as a real date still reads as `"2026-03-04"`, not as
  `"Wed Mar 04 2026 00:00:00 GMT-0700"`.

Both were learned the hard way in #132: an update read a date cell with `getValues()`,
stringified it, and wrote the long form back. The test sandbox's fake sheet now
interprets writes the way Sheets does, so a write that skips `asText()` fails the suite.

## Actions

Every response — success, rejection or thrown error — is
`{ success, data?, error?, code? }`. `code` appears only on the failures in
the next section, so a key caller's envelope is exactly what it was before it
existed.

### Token callers (#144)

almanac cannot hold the key: a key in a public bundle is not a secret. It
sends `access_token`, a Google access token from its own sign-in, instead.

| Sent | Caller | May run |
|---|---|---|
| `key` only | key caller | everything, as before |
| `access_token`, with or without `key` | token caller | the reads below, only |
| neither | refused | nothing |

`access_token` present makes a token caller whatever else is sent: privilege
never rises by adding a parameter.

The token is checked against `https://oauth2.googleapis.com/tokeninfo`: `aud`
(and `azp`, when present) must equal the `TOKEN_CLIENT_ID` property, `email`
must equal `TOKEN_ALLOWED_EMAIL` (trimmed, case-insensitive) with
`email_verified` true, and `expires_in` must be positive. **Either property
unset refuses every token call.** The verdict is cached under the SHA-256 of
`token|TOKEN_CLIENT_ID|TOKEN_ALLOWED_EMAIL` — accepted until a minute before
the token expires (at most an hour), refused for five minutes, never when
Google could not be reached. The raw token is in no cache key, log line, error
or response.

A token caller may run `getWorkouts`, `getWorkout`, `getPlannedWorkouts`,
`getExercises`, `getExercise`, `getExerciseHistory`, `getTemplates`,
`getTemplate`, `getSets`, `getWorkoutSets`, `getDailySummary`,
`getHistoryDateRange`, `getDailyHealth` and `getSyncLog` — `TOKEN_READ_ACTIONS`
in `src/auth.js`. It is an allow-list: **an action added later is refused to
token callers until someone names it there**, and a test fails until every
`case` in `main.js` is classified. `previewSetUpdates` is deliberately off it:
it writes nothing, but it is the dry run of a write and takes a write payload.

| `code` | Meaning | almanac does |
|---|---|---|
| `token_invalid` | Google rejected the token: expired, revoked or bogus alike | asks for a reconnect |
| `token_forbidden` | wrong OAuth client or account, the two properties unset, or the script not yet re-authorized for `UrlFetchApp` | shows an error; reconnecting cannot fix it |
| `token_unavailable` | tokeninfo unreachable or erroring; not a verdict, never cached | shows an error |
| `read_only` | a token caller asked for anything off the list; it did not run | shows an error |

```
POST <exec url>        body: action=getWorkouts&access_token=...&from=2026-09-21&to=2026-09-27
GET  <exec url>?action=getWorkouts&access_token=...       (from a terminal)
```

### Reads

| Action | Parameters |
|---|---|
| `getWorkouts` | `date`, `from`, `to`, `type`, `status` (all optional) |
| `getWorkout` | `id` (required) |
| `getPlannedWorkouts` | `date` (optional, defaults to today in `America/Denver`) |

```
?action=getWorkouts&key=...&from=2026-09-01&to=2026-09-30&type=bike
?action=getPlannedWorkouts&key=...&date=2026-09-21
```

### Writes

| Action | Payload |
|---|---|
| `createWorkout` | `{"data":{...}}` — `type` and `name` required |
| `updateWorkout` | `{"id":"...","changes":{...}}` |

```
?action=createWorkout&key=...&payload={"data":{"type":"bike","name":"Evening Ride"}}
?action=updateWorkout&key=...&payload={"id":"w_1a2b3c4d","changes":{"effort":"Hard"}}
```

**An update merges.** Only the keys present in `changes` are touched; every
other column keeps its value. A field is cleared by naming it with `''`, never
by omitting it — omission means "don't touch". This is the distinction #122 got
wrong in the MCP server.

**An omitted field on create is written empty, never defaulted.** Blank
`source` is not missing information: it positively means the workout was logged
by hand.

### Exercises, Templates, Sets (#134)

| Action | Parameters / payload |
|---|---|
| `getExercises` | `tag` (optional) |
| `getExercise` | `ref` — id, exact name, or unique partial |
| `createExercise` | `{"data":{"name":"...","tags":"...","notes":"..."}}` |
| `updateExercise` | `{"id":"...","changes":{...}}` |
| `getExerciseHistory` | `ref`, `limit` (optional) |
| `getTemplates` / `getTemplate` | `ref` for the single |
| `createTemplate` | `{"data":{"name":"...","exercises":[...]}}` |
| `replaceTemplate` | `{"template_id":"...","data":{...}}` |
| `getSets` | `workout_id`, `exercise_id` (optional) |
| `getWorkoutSets` | `workout_id` — grouped into slots |
| `appendSets` | `{"sets":[...]}` |
| `previewSetUpdates` | `{"workout_id":"...","updates":[...]}` — **writes nothing** |
| `updateSets` | same payload — **all-or-nothing** |

### DailySummary (#131)

| Action | Parameters / payload |
|---|---|
| `getDailySummary` | `from`, `to` (optional) |
| `rebuildDailySummary` | `{"from":"...","to":"...","computed_at":"..."}` |
| `getHistoryDateRange` | — the span `Workouts` actually covers |

`rebuildDailySummary` reads `DailyHealth` by `DAILY_HEALTH_FIELDS` (#165), never
by column position.

**The range is a parameter, not a window.** The nightly recompute and the
historical backfill are the same call with different bounds, so there is no
second implementation of "catch up" to drift out of step with the one for
"last night".

**Derived, never authoritative.** Every row is rebuildable from `Workouts` +
`DailyHealth`. A day with no activities and no health data produces **no row**
— zero activities and "we have no information" are different claims.

`total_distance_m` and `total_ascent_m` are **outdoor only**: a treadmill's
distance is a machine estimate of ground never covered. They will not equal
the sum of a day's activity distances on any day with an indoor session.
Each is **blank when no outdoor session that day measured it**, never `0`
(#190); `distance_withdata` (I) and `ascent_withdata` (J) count those that did,
out of `cardio_activity_count` (H). A measured `0` is still `0`.

`total_moving_s` and `total_elapsed_s` are **blank when no activity that day
recorded them**, never `0` (#181). `moving_withdata` (S) and `elapsed_withdata`
(T) count the activities that did, out of `activity_count` (B), every activity
of every type. They are appended after `computed_at` so no earlier column moved.

### DailyHealth (#165, #158)

| Action | Parameters / payload |
|---|---|
| `getDailyHealth` | `from`, `to` (optional, inclusive) — oldest first |
| `upsertDailyHealth` | `{"rows":[{"date":"2026-09-23","steps":"2617",...}],"synced_at":"..."}` |

`getDailyHealth` returns every one of the 18 fields on every row, a blank cell as
`''` and never `0`, and no `sheetRow`. It reads the tab once. With no `DailyHealth`
tab it answers `[]`: no tab means no health data, not a tab of zeros. It is a read,
so it joins #144's token allow-list when that lands.

`upsertDailyHealth` is called by the COROS sync alone, **key only**: it is a write,
so it never joins #144's token read allow-list. Rows are domain objects keyed by field name
(`DAILY_HEALTH_FIELDS` in `src/types.js`), addressed by `date`:

- A date with no row is appended; a date with a row is updated in place, after
  the row is re-read and its column A confirmed to still hold that date.
- **Only the fields a row names are written.** An omitted field is left alone
  (the sync omits `vo2max`/`recovery` on every day but the run date); a field
  sent as `''` is written blank.
- Every row is validated before anything is written: an unknown field, a
  non-numeric metric or a clock time not `HH:mm` rejects the whole call.
- `synced_at` is one value per call, stamped on every row it touches.

### Synced workouts (#166)

| Action | Payload |
|---|---|
| `upsertSyncedWorkout` | `{"source":"coros","source_activity_id":"...","incoming":{...},"last_written":null,"raw_ref":"<drive id>","synced_at":"..."}` |

One synced activity, found by `(source, source_activity_id)` and merged with
sync plan §8's three-way merge **inside the action**, so an edit made in the
SPA between a read and a write cannot be lost. Key only, like every write.
`incoming` holds only `SYNC_MERGED_FIELDS` (`src/types.js`); anything else,
`effort` or `notes` included, is refused.

- **No row:** appended through `createWorkout` (new `w_` id, `created`
  stamped, every unsent field blank), unless `last_written` is set: then the
  user deleted it, and the answer is `{"status":"deleted"}` with nothing written.
- **One row:** re-read and its S/T confirmed, then per merged field the
  incoming value is written only if the sheet still holds `last_written`'s.
  `last_written: null` fills blanks only. `source`, `source_activity_id`,
  `raw_ref` and `synced_at` are always overwritten; `effort`, `notes`,
  `status` and `template_id` never are.
- **`fit_ref` / `fit_fetched_at`** (#154) are sync-owned and optional: sent (both,
  at top level), they are always overwritten; sent as neither, V and W are left
  alone. `fit_ref` must be a Drive file ID (letters, digits, `-`, `_`), so a FIT
  download URL can never land in the sheet, and `fit_fetched_at` an ISO instant.
  `fit_fetched_at` set with `fit_ref` blank means "no FIT will be fetched".
- **Two rows:** refused, naming both ids.
- Returns `written`, the merged fields as the sheet now holds them plus
  `edited` (the fields the user changed, which stay kept on every later run),
  for the sync to store as the next `last_written`; and `kept`, the fields
  this call declined to overwrite.

### Strength enrichment (#155)

| Action | Payload |
|---|---|
| `enrichWorkout` | `{"source_activity_id":"...","activity":{"date":"2026-09-23","time":"07:30","elapsed_seconds":"...","moving_seconds":"...","avg_hr":"...","calories":"..."},"last_written":null,"raw_ref":"<drive id>","synced_at":"..."}` |

A COROS strength session fills blanks on its hand-logged `weight` row (sync
plan §7). It never creates a row, and never overwrites a typed value. The
match, the fill and the write happen inside the action. Key only.

- **Already linked:** the row with `source` blank and this `source_activity_id`.
  Each of `ENRICH_FIELDS` (`elapsed_seconds`, `moving_seconds`, `avg_hr`,
  `calories`) is filled when the row holds a blank, COROS has a value, and
  `last_written.filled` (for the same `workout_id`) does not name it. A filled
  field is never written again, so an edit or a clearing in Thrive sticks.
  Nothing to fill means nothing is written, `synced_at` included:
  `{"status":"unchanged"}`.
- **Not linked:** a candidate is `type = 'weight'` on `activity.date`, `source`
  and `source_activity_id` blank, and `status` neither `planned` nor `active`.
  It is within the tolerance when its `Time` is within
  `STRENGTH_MATCH_TOLERANCE_MINUTES` (30, inclusive) of `activity.time`. A
  blank `Time` always counts as within. Exactly one within: linked, and its
  blanks filled. None, or several (even if one is nearer):
  `{"status":"unmatched","reason":"no match"|"ambiguous","candidates":[...]}`,
  and nothing is written.
- A linked row gains `source_activity_id`, `raw_ref` and `synced_at`, and
  keeps `source = ''`. That is what the UI reads as "enriched". No other
  column is written.
- **Two rows carrying the activity ID:** refused, naming both.
- Returns `filled` (this call's fields), `linked` (whether this call made the
  link) and `written`, which is `{ workout_id, filled }` for the sync to store
  as the next `last_written`.

### SyncLog (#156)

| Action | Parameters / payload |
|---|---|
| `appendSyncLog` | `{"row":{"run_id":"schedule-123-1","started_at":"...","finished_at":"...","window_start":"...","window_end":"...","n_seen":2,...,"status":"ok","error_detail":""}}` |
| `getSyncLog` | `limit` (optional, 1–100, default 10) |

- `appendSyncLog` validates the whole row first: `run_id` required, ISO instants,
  `YYYY-MM-DD` window, non-negative integer counts, `status` one of `ok`,
  `partial`, `failed`, no unknown fields. A `run_id` already present answers
  `{"status":"exists"}` and writes nothing. Key only, like every write.
- `notes` (column N, #155) holds what a run noted that is not a failure, such as
  a strength session with no workout to enrich. It does not affect `status`.
  `scripts/migrate-155-sync-log-notes.mjs` adds the column. A tab without it
  still reads, with `notes` blank.
- `getSyncLog` returns rows **newest first by `started_at`**, never by position.
  The dead-man's switch (`sync/deadman.mjs`) reads `limit=1`.

### Archived payloads (#179)

| Action | Parameters |
|---|---|
| `getWorkoutPayload` | `id` (required, a workout id), `offset` (optional, default 0) |

```
?action=getWorkoutPayload&key=...&id=w_1325851e
?action=getWorkoutPayload&key=...&id=w_1325851e&offset=20000
```

A synced or enriched workout's COROS detail payload, read from the sync's
archive in the bot's Drive (`sync/README.md`, "The raw archive").

- **Addressed by workout id, never by Drive ID.** The file is the one the row's
  `raw_ref` names. Because `raw_ref` is an ordinary column (`updateWorkout` can
  set it) and the same Drive holds `coros-token.json`, the file must also be
  that activity's archive file before anything is read back: named
  `<source_activity_id>.json`, the only file at
  `Thrive COROS/activities/<YYYY>/<MM>/`, JSON, at most 5 MB, with
  `source: "coros"`, the row's `activity_id` and a string `payload`. Anything
  else is refused with one fixed message that quotes nothing from the file.
- **Returns** `workout_id`, `source_activity_id`, `raw_ref`, `tool`,
  `fetched_at` and `text`: the payload decoded from the JSON string literal the
  archive stores it as. Nothing else in the file (`normalized`, `fit`, `args`,
  `list_entry` with its start coordinates) is returned.
- **Paged**, 20,000 characters at a time, with `offset`, `total_chars` and
  `next_offset` (`null` when complete). A page never ends inside a surrogate
  pair. An offset that is not a whole number, or is past the end, is refused.
- **Key only.** A read, but not on `TOKEN_READ_ACTIONS`: no token caller needs
  raw vendor text.
- **FIT contents are not readable** here. The `.fit` files are binary and hold
  the GPS track.
- Needs the `drive.readonly` scope (see Setup). Until the owner grants it, the
  action answers "The script is not yet allowed to read Drive…", and every
  other action is unaffected.

### The script lock

`upsertSyncedWorkout`, `enrichWorkout`, `upsertDailyHealth` and `appendSyncLog` run under
`LockService`'s script lock (`withScriptLock` in `src/utils.js`), so a local
sync overlapping a scheduled one cannot interleave a read-then-write. A caller
that waits over 30 s gets `Lock timeout`, and nothing is written. The SPA
writes Sheets directly and is not covered.

## The shaping principle

**The API accepts domain objects. It never accepts sheet rows or row
indices.** A set is named by `workout_id`, exercise reference, `section`,
`exercise_order` and `set_number`; the *server* works out which row that is.

This is what decides whether the mirror actually goes away. An API of
row-index CRUD would leave every caller still needing to know the sheet shape,
and `mcp-server/` would keep its copy through the refactor.

Two consequences worth knowing:

- **Ambiguity is refused, never guessed.** The same lift as a warmup and as a
  primary is two slots. Asking to change "Bench Press set 1" when both exist
  returns an error naming both, with instructions to pass `section` or
  `exercise_order`. A target matching nothing is refused rather than appended.
- **`previewSetUpdates` is `updateSets` without the write** — literally the
  same resolution function, not a parallel implementation, so a dry run and a
  real write can never disagree about what a reference means.

**A rename cascades.** `Templates!E` and `Sets!C` hold a denormalized copy of
`exercise_name`. Renaming through `updateExercise` rewrites them in the same
call, and reports how many of each it touched. #120 is the bug this prevents:
a rename left the copies behind and a template expanded later wrote the *old*
name into a fresh workout.

**Narration stays client-side.** `describeSlots` is here because resolution
errors need it, but `describeSetState` and `describeLoad` — which format MCP
tool output for an agent to read — remain in `mcp-server/`. They are a
presentation concern, not a data one.

## Setup

1. Create the Apps Script project and push `src/` to it (`clasp push`).
   `.clasp.json` holds the script id and is gitignored.
2. Set **script properties** — never put either in source, this repo is public:
   - `API_KEY` — a long random string
   - `SPREADSHEET_ID` — the Groundwork sheet id
   - `TOKEN_CLIENT_ID` — almanac's OAuth client ID (#144)
   - `TOKEN_ALLOWED_EMAIL` — the one Google account allowed to call with a
     token (#144)

   Leaving either `TOKEN_*` property unset refuses every token call and
   leaves key callers untouched.
3. Deploy as a web app: execute as **me**, access **anyone**. Anonymous access
   is what makes the API key and the token check load-bearing — "anyone with a
   Google account" would answer a browser `fetch` with a login page.
   `appsscript.json` **pins its scopes** (#179): `spreadsheets`,
   `script.external_request` (the token check's `UrlFetchApp`) and
   `drive.readonly` (`getWorkoutPayload`). Pinned, so `DriveApp` cannot widen
   Drive access to full `drive` by inference. `drive.file` would not do: it
   covers only files the script's own OAuth client created, and the archive
   was created by the sync's client.

   **Whenever a scope is added, the owner re-authorizes once.** The editor
   prompts only for the scopes **the function being run actually uses**, not
   for everything in the manifest. So running `doGet` (which never touches
   Drive) grants nothing new — found the hard way in #179. Instead, signed in
   as luketmossbot, open the script (`clasp open-script`) and paste a
   throwaway function that calls the new service, e.g. for Drive:

   ```javascript
   function testDriveAccess() { Logger.log(DriveApp.getRootFolder().getName()); }
   ```

   Save, pick it in the function menu, **Run**, and allow the dialog. The
   grant belongs to the account and script, not a deployment, so `@2` uses it
   at once — **no redeploy**, and don't use the editor's Deploy button, which
   would publish the throwaway. The next `clasp push` removes it. Until the
   grant, only calls that need the new scope fail, each with a message saying
   so. #179 confirmed this on a temporary deployment before updating `@2`.
4. The deployment URL and key become `THRIVE_API_URL` / `THRIVE_API_KEY` for
   consumers, and GitHub Actions secrets for the sync.

Re-deploy after every `clasp push` — Apps Script serves the last *deployed*
version, not the last pushed one.

## Tests

```bash
cd apps-script && npm test
```

The sources are plain `.js` evaluated into one shared global scope, with no
modules and no exports. `tests/apps-script-sandbox.ts` reads the **real**
`src/*.js` files and evaluates them into a `node:vm` context with the Google
globals stubbed, so a test cannot pass against a transcribed copy while the
real source is broken. Only the sheet accessor is replaced; row mapping is
exercised by every test.

CI runs these on every pull request, deliberately **not** path-filtered — a
workflow that reports nothing at all on an unrelated PR reads as "no checks"
and stalls the merge gate.
