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

`src/types.js` is the third mirror. Per CLAUDE.md, a column added to a tab is
added there too.

## Layout

| File | Contents |
|---|---|
| `src/types.js` | Column constants, valid enum values, timezone, payload limit |
| `src/utils.js` | Sheet access, row ↔ object mapping, validation helpers |
| `src/workouts.js` | `Workouts` reads, writes, and planned-by-date |
| `src/main.js` | `doGet` dispatch, auth, response envelope |

`Exercises`, `Templates`, `Sets` and `Labels` actions are #134. Tab actions
travel with their tabs: `DailySummary`'s are in #131's scope, and `DailyHealth`
and `SyncLog` arrive with the sync.

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
