# Thrive MCP Server

Local MCP server that lets AI agents read, analyze, schedule and repair the workout
data in the Groundwork sheet — review training history, design and schedule future
workouts, extend the exercise library, and fix data that has gone bad.

## How it works

The server is a **thin client of the Thrive Apps Script API** (`apps-script/`), exactly
as Hive's MCP server is a thin client of Hive's. It holds no row mapping and never
touches the sheet: `api.js` is the only file that talks to the outside world, and it
speaks in domain objects — a set is named by workout, exercise, section, order and set
number, never by row.

That caps the copies of Thrive's row layout at two however many consumers arrive: the
SPA (`frontend/src/api/*.ts`), which still reads Sheets directly, and the API
(`apps-script/src/types.js`). Before #132 this server was a third.

What stays here is everything that needs no sheet: tool definitions, narration of
results for the agent, schedule planning, and the per-entry checks whose wording agents
already rely on.

## Setup

### 1. Deploy the API

The API has to be deployed before this server can do anything. Follow
[`apps-script/README.md`](../apps-script/README.md): `clasp push`, set the `API_KEY` and
`SPREADSHEET_ID` script properties, deploy as a web app with anonymous access, and open
the `/exec` URL once in a browser as the owner to authorize it.

You need two values from that:

- **`THRIVE_API_URL`** — the web app's `/exec` URL
- **`THRIVE_API_KEY`** — the `API_KEY` script property

### 2. Install

```powershell
cd mcp-server
npm install
```

### 3. Register the server

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` on Windows,
`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac:

```json
{
  "mcpServers": {
    "thrive": {
      "command": "node",
      "args": ["D:/Projects/code/thrive/mcp-server/index.js"],
      "env": {
        "THRIVE_API_URL": "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec",
        "THRIVE_API_KEY": "<the API_KEY script property>"
      }
    }
  }
}
```

Restart Claude Desktop afterwards.

**Claude Code** — the same block in a `.mcp.json` at the repo root, or via
`claude mcp add`. Don't commit the key.

### Upgrading from the service-account version

Before #132 the server read the sheet as a Google service account. In the `thrive`
entry's `env` block:

1. **Add** `THRIVE_API_URL` and `THRIVE_API_KEY`.
2. **Remove** `THRIVE_SPREADSHEET_ID` and `THRIVE_SERVICE_ACCOUNT_KEY_FILE` (or
   `THRIVE_SERVICE_ACCOUNT_KEY`). The server no longer reads them.
3. Restart Claude Desktop.

The service account itself stays: `scripts/` still uses it for schema migrations and
admin tools, because adding a column or a tab needs direct Sheets access that the API
deliberately does not offer.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THRIVE_API_URL` | Yes | The API's web app `/exec` URL |
| `THRIVE_API_KEY` | Yes | The `API_KEY` script property |

The server exits at startup with a message naming whichever is missing.

## Tools

### Reading and analysis

| Tool | Description |
|------|-------------|
| `thrive_list_workouts` | Workouts newest first; filter by date range, type, planned/completed, name, and source (`synced` / `enriched` / `manual`). Shows the venue (`[bike:gravel]`) and marks COROS-synced and COROS-enriched rows |
| `thrive_get_workout` | One workout in full — every exercise, every set, its activity measurements, and its provenance: synced, enriched or hand-logged, with the COROS activity id, last sync, and whether the raw payload and FIT file are archived |
| `thrive_get_workout_payload` | A synced or enriched workout's archived COROS detail payload: COROS's own text, with what the sheet does not carry (max speed, training effect, and max HR or laps where COROS includes them). 20,000 characters per call; a longer one ends with the `offset` for the next page. Hand-logged workouts have none |
| `thrive_daily_health` | `DailyHealth` for a date range (default: the 7 days ending today): resting HR, HRV, steps, calories, sleep and its stages, sleep score, bed and wake time, VO2max, recovery, training load |
| `thrive_daily_summary` | `DailySummary` for a date range: the per-day rollup of activities and health. Derived, and its distance and ascent are **outdoor only** |
| `thrive_list_exercises` | The exercise library, filterable by search text or tag |
| `thrive_list_templates` | Templates with their exercises, sections, sets and reps |
| `thrive_exercise_history` | Progression for one exercise over time — the tool for deciding whether to add weight or volume |

### Scheduling and authoring

| Tool | Description |
|------|-------------|
| `thrive_schedule_workout` | Create a workout with status `planned` for a future date, expanded from a template or an explicit exercise list. Exercise entries can prescribe a `weight` (every set) or `set_weights` (per set); the whole list is validated before anything is written |
| `thrive_schedule_week` | Schedule several workouts in one call, each shaped like a `thrive_schedule_workout` call. All of them are validated first (any problem schedules none), then the sets are written, chunked if large, followed by the workouts |
| `thrive_create_exercise` | Add to the exercise library (refuses duplicate names unless overridden) |
| `thrive_create_template` | Create a reusable template from an ordered exercise list |

### Repair

| Tool | Description |
|------|-------------|
| `thrive_update_workout` | Fix date, name, type, notes, duration (`duration_min`, whole minutes), session effort, cardio attributes, or planned/completed status |
| `thrive_update_set` | Correct one logged set's weight, reps, planned reps or effort (pass `section` when a lift appears twice) |
| `thrive_update_sets` | Correct many sets of one workout in one call. All entries are validated first (any problem writes nothing), each request is atomic, and each updated set's resulting state is echoed |
| `thrive_update_exercise` | Rename or retag an exercise |
| `thrive_update_template` | Replace a template's exercise list wholesale |
| `thrive_delete_workout` | Delete a workout and cascade to its sets |
| `thrive_delete_exercise` | Delete a library entry |

## Safety model

Destructive tools — `thrive_delete_workout`, `thrive_delete_exercise` and
`thrive_update_template` — are **dry-run by default**. Called without `confirm: true`
they report exactly what they would change and write nothing. The preview is built from
API reads, so the API's delete and replace actions only ever run once confirmed:

```
DRY RUN — nothing deleted. This would remove:
**Push A** — 2026-03-12 [weight] (w_1a2b3c4d)
- 14 set rows
  - Bench Press: 4 sets
  - Incline DB Press: 4 sets
  ...

Call again with confirm: true to delete.
```

`thrive_delete_exercise` adds a further gate: an exercise still referenced by sets or
templates needs `force_when_in_use: true`, since deleting it orphans that history.

More guardrails worth knowing:

- **Unknown fields are refused.** Every tool rejects a field its schema doesn't declare,
  naming it and listing the accepted ones, and writes nothing. Without this the SDK
  strips the field and a misnamed parameter becomes a silent no-op (#117).
- **Updates merge.** `thrive_update_workout` and `thrive_update_exercise` send only the
  fields passed; the API leaves every other column alone. A field is cleared by passing
  `""`, never by omitting it (#122).
- **Rename cascade.** Renaming an exercise rewrites the cached name in every Sets and
  Templates row, server-side and in the same call, so history doesn't fragment across
  old and new names. Template expansion writes the library's current name and refuses a
  template whose rows point at an exercise that no longer exists (#120).
- **Set targets are resolved, never guessed.** The API works out which row a set
  correction means. An exercise that appears twice in a workout (a warmup and a primary
  of the same lift) must be narrowed with `section` or `exercise_order`, and the error
  lists both candidates. A target matching nothing is refused rather than appended.
- **Stale-row protection** lives in the API: a bulk set update re-reads each target
  before writing and writes nothing if any moved (#95).

### Large batches

The API receives writes as a URL parameter, which caps a request's size. `api.js`
measures each write and splits one that would not fit:

- **`thrive_update_sets`** — a batch that fits is one atomic request. One that does not
  is previewed in full first, so an invalid entry anywhere still means nothing is
  written, then applied chunk by chunk, each chunk atomic. If a later chunk fails, the
  error names the entries earlier chunks already wrote.
- **`thrive_schedule_week`** — set rows are chunked the same way, then the workouts are
  created. A failure partway says what already landed.

### Synced data, and what an agent cannot see (#158)

The COROS sync (`sync/`) writes activities into `Workouts` and a row per day into
`DailyHealth`, and rebuilds `DailySummary` from both. Every one of those values is
nullable: a blank means COROS did not say, never zero, and the tools print it as `—` or
leave the line out rather than as `0`. Two caveats are repeated in the tool descriptions
because they are easy to get wrong in analysis:

- `DailySummary`'s distance and ascent are **outdoor only**, so they will not equal the sum
  of a day's activity distances on any day with an indoor session.
- `DailyHealth.steps` includes steps taken during indoor walks and runs. It is context,
  never an addend to activity distance or calories (`docs/data-architecture.md` §5).

The raw COROS payload (`raw_ref`) and FIT file (`fit_ref`) live in the sync bot's Drive.
This server has no Drive credential. `thrive_get_workout_payload` reads the payload through
the API's `getWorkoutPayload`, which runs as the bot and finds the file from the workout row
(#179). The FIT file's contents are not readable: it is binary and holds the GPS track.

## Dates

Relative dates (`today`, `tomorrow`, `+3d`) resolve against the **machine's** local
date. That is right for a server running on your own computer; run it somewhere set to
UTC — CI, a container — and an evening "today" lands on tomorrow.

## Development

```powershell
cd mcp-server
npm test
```

No network and no credentials: `domain.test.js` and `daily.test.js` cover the pure
planning and narration helpers, `tools.test.js` drives the real tools over MCP stdio
against a fake API on localhost, `set-updates.test.js` drives the set-update logic against a fake API
that resolves the way the real one does, and `api.test.js` stubs `fetch`. Row mapping
and resolution are tested where they live, in `apps-script/tests/`.

## Files

| File | Role |
|------|------|
| `index.js` | MCP tool definitions, argument validation, output formatting |
| `api.js` | The Apps Script API client — the only file that talks to the outside world |
| `set-updates.js` | Set corrections: local checks, error remapping, chunking |
| `domain.js` | Pure logic — schedule planning, narration, unit and date helpers |
| `daily.js` | Pure narration for the per-day tools — daily health and daily summary |
| `*.test.js` | Tests for each of the above |
