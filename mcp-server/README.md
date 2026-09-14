# Thrive MCP Server

Local MCP server that lets AI agents read, analyze, schedule and repair the workout
data in the Groundwork sheet — review training history, design and schedule future
workouts, extend the exercise library, and fix data that has gone bad.

## How this differs from the Hive MCP server

Hive's MCP server is a thin client over an Apps Script web app guarded by an API key.
Thrive has no backend at all — the SPA holds the signed-in user's OAuth token and
calls the Sheets REST API directly (`frontend/src/api/sheets.ts`), so there is no URL
for an MCP server to call.

Rather than stand up a second backend, this server talks to the same Sheets REST API
directly, authenticating as a **Google service account**. The row-mapping logic in
`domain.js` mirrors `frontend/src/api/*.ts` — if a tab gains a column there, widen the
range and the mapper here too.

## Setup

### 1. Create a service account

1. In the [Google Cloud console](https://console.cloud.google.com/), pick (or create)
   a project and enable the **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account.** No roles needed —
   access is granted by sharing the sheet, not by project IAM.
3. On the new account, **Keys → Add key → Create new key → JSON**. Save the file
   somewhere outside this repo, e.g. `C:\Users\<you>\.thrive\service-account.json`.
4. Copy the account's `client_email` (it looks like
   `thrive-mcp@<project>.iam.gserviceaccount.com`).

### 2. Share the sheet

Open the **Groundwork** spreadsheet, hit Share, and add that `client_email` as an
**Editor**. Nothing works until you do this — the server will report a 403 with a
reminder if you forget.

### 3. Install

```powershell
cd mcp-server
npm install
```

Already done if the server was set up for you — `node_modules/` will exist.

(PowerShell 5.1 has no `&&` separator, hence the two lines.)

### 4. Register the server

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` on Windows,
`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac:

```json
{
  "mcpServers": {
    "thrive": {
      "command": "node",
      "args": ["D:/Projects/code/thrive/mcp-server/index.js"],
      "env": {
        "THRIVE_SPREADSHEET_ID": "<the id from the sheet URL>",
        "THRIVE_SERVICE_ACCOUNT_KEY_FILE": "C:/Users/<you>/.thrive/service-account.json"
      }
    }
  }
}
```

Restart Claude Desktop afterwards.

**Claude Code** — same block in a `.mcp.json` at the repo root, or via
`claude mcp add`. Don't commit real credentials.

The spreadsheet id is the long segment in the sheet URL:
`https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THRIVE_SPREADSHEET_ID` | Yes | Groundwork spreadsheet id |
| `THRIVE_SERVICE_ACCOUNT_KEY_FILE` | One of these | Path to the service account JSON key |
| `THRIVE_SERVICE_ACCOUNT_KEY` | One of these | The service account JSON inline, for hosts that only pass strings |

## Tools

### Reading and analysis

| Tool | Description |
|------|-------------|
| `thrive_list_workouts` | Workouts newest first; filter by date range, type, planned/completed, name |
| `thrive_get_workout` | One workout in full — every exercise, every set |
| `thrive_list_exercises` | The exercise library, filterable by search text or tag |
| `thrive_list_templates` | Templates with their exercises, sections, sets and reps |
| `thrive_exercise_history` | Progression for one exercise over time — the tool for deciding whether to add weight or volume |

### Scheduling and authoring

| Tool | Description |
|------|-------------|
| `thrive_schedule_workout` | Create a workout with status `planned` for a future date, expanded from a template or an explicit exercise list |
| `thrive_create_exercise` | Add to the exercise library (refuses duplicate names unless overridden) |
| `thrive_create_template` | Create a reusable template from an ordered exercise list |

### Repair

| Tool | Description |
|------|-------------|
| `thrive_update_workout` | Fix date, name, type, notes, duration (`duration_min`, whole minutes), session effort, cardio attributes, or planned/completed status |
| `thrive_update_set` | Correct one logged set's weight, reps, planned reps or effort (pass `section` when a lift appears twice) |
| `thrive_update_exercise` | Rename or retag an exercise |
| `thrive_update_template` | Replace a template's exercise list wholesale |
| `thrive_delete_workout` | Delete a workout and cascade to its sets |
| `thrive_delete_exercise` | Delete a library entry |

## Safety model

Destructive tools — `thrive_delete_workout`, `thrive_delete_exercise` and
`thrive_update_template` — are **dry-run by default**. Called without `confirm: true`
they report exactly what they would change and write nothing:

```
DRY RUN — nothing deleted. This would remove:
**Push A** — 2026-03-12 [weight] (w_1a2b3c4d)
- 14 set rows
  - Bench Press: 4 sets
  - Incline DB Press: 4 sets
  ...

Call again with confirm: true to delete.
```

A second call with `confirm: true` performs the write. `thrive_delete_exercise` adds a
further gate: an exercise still referenced by sets or templates needs
`force_when_in_use: true`, since deleting it orphans that history.

More guardrails worth knowing:

- **Unknown fields are refused.** Every tool rejects a field its schema doesn't declare,
  naming it and listing the accepted ones, and writes nothing. Without this the SDK
  strips the field and a misnamed parameter becomes a silent no-op (#117).

- **Rename cascade.** Renaming an exercise rewrites the cached exercise name in every
  Sets and Templates row, so history doesn't fragment across old and new names.
- **Stale row protection.** Workout updates re-check that the target row still holds
  that workout's id before overwriting it. A cached row index goes stale the moment an
  earlier row is deleted, and writing blind would clobber a different workout — the bug
  behind issue #95. Row deletions go out as a single atomic `batchUpdate` rather than
  one call per row, so a failure can't leave a half-deleted workout behind.

## Development

```powershell
cd mcp-server
npm test
```

Runs the pure-function tests in `domain.test.js` (date normalization, rep-range
collapsing, template grouping) via the built-in Node test runner. No sheet access and
no credentials required.

## Files

| File | Role |
|------|------|
| `index.js` | MCP tool definitions, argument validation, output formatting |
| `domain.js` | Row ↔ object mapping for the Groundwork tabs, id generation, date helpers |
| `sheets.js` | Service account auth and the Sheets REST calls |
| `domain.test.js` | Tests for the pure helpers |
