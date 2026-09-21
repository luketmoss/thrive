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
| `src/main.js` | `doGet` dispatch, auth, response envelope |

`Labels` is deliberately absent: `domain.js` contains no Labels code and no
`thrive_*` tool touches it. Tab actions travel with their tabs, so
`DailySummary`'s are in #131's scope, and `DailyHealth` and `SyncLog` arrive
with the sync.

## The transport, and its limit

**Everything goes through `doGet`, including writes.** Apps Script answers
`POST` with a redirect, which breaks anonymous callers, so writes pass their
data as a URL-encoded `payload` query parameter.

That caps a request at the URL length Apps Script accepts — roughly 8KB for the
whole URL, shared with the action, the key, and percent-encoding overhead that
can triple the size of a JSON payload full of quotes and braces.
`MAX_PAYLOAD_CHARS` is **6000**, leaving headroom for that overhead.

A payload over the limit is **refused by length, before parsing**. That
ordering is the point: the dangerous case is not a parse error but a payload
truncated in transit that still parses, into an object quietly missing its last
fields. #134's bulk actions are the first that will hit this, and they must
batch rather than hope.

## Actions

Every response — success, rejection or thrown error — is
`{ success, data?, error? }`.

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
3. Deploy as a web app: execute as **me**, access **anyone**. Anonymous access
   is what makes the API key load-bearing.
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
