# Thrive — Personal Workout Tracker

## Project Overview
Personal workout tracker: Preact SPA → Google Sheets REST API.
- **frontend/**: Preact SPA (built with Vite) — deployed to GitHub Pages
- **mcp-server/**: local MCP server letting AI agents read, analyze, schedule and repair workout data. A thin client of the Apps Script API (#132), configured with `THRIVE_API_URL` + `THRIVE_API_KEY`, exactly as Hive's is. It holds **no row mapping**: `api.js` is its only boundary, and it speaks in domain objects.
- **apps-script/**: the server-side API over the sheet (#130, #134). Row mapping in `apps-script/src/types.js` mirrors `frontend/src/api/*.ts` — **change both together**. Those are the only two copies, and every consumer arriving later (the COROS sync, the Journal) calls the API rather than adding a third. The SPA still reads Sheets directly, as Hive's does.
- **sync/**: the COROS → Thrive sync (epic #163), run by `.github/workflows/coros-sync.yml`. Reaches Drive as the bot account (luketmossbot@gmail.com, `drive.file`), **not** the service account — a service account has no Drive storage quota. Keeps COROS's rotating refresh token in a Drive file it owns. Setup and failure modes: `sync/README.md`.
- **scripts/**: one-time migrations and admin tools. They use the Google service account (`mcp-server/thrive-sa.json`) directly, with their own `google-auth-library`, because schema changes — new columns, new tabs — need Sheets access the API deliberately does not offer.

## Key Commands
- `cd frontend && npm run dev` — start Vite dev server (localhost:5173)
- `cd frontend && npm run build` — production build to frontend/dist/
- `cd frontend && npm test` — run frontend tests (vitest)
- `cd frontend && npx tsc --noEmit` — TypeScript type checking
- `cd mcp-server && npm test` — run MCP server tests (node --test, no network)
- `cd sync && npm test` — run COROS sync tests (node --test, no network)
- `cd apps-script && npm test` — run Apps Script tests (vitest, sandboxed `node:vm`)
- `cd apps-script && npm run typecheck` — TypeScript check for the test harness

## Environment
- **Windows machine** — `jq` is NOT available. For JSON parsing in shell commands, use `gh` built-in `--jq` flags. Never pipe to a standalone `jq` command.
- Node 20+, npm

## Architecture Notes
- Frontend uses direct `fetch()` to Google Sheets REST API (not gapi.client)
- Auth: Google Identity Services (GIS) token model
- State: @preact/signals (module-level signals, NOT useState for shared state)
- Styling: CSS custom properties in `global.css` (no CSS framework, no Tailwind)
- Router: Signal-based hash router using signals (no library dependency)
- Mobile-first design (375px primary breakpoint)
- No backend server — SPA reads/writes Sheets API directly via OAuth

## Preview & Demo Mode
- The app requires Google OAuth to function. For preview testing (QA, UX agents), use **demo mode** by navigating to `http://localhost:5173/thrive/?demo=true` after starting the dev server.
- Demo mode provides a fake user and skips Google auth. Changes are not persisted.

## Data Model
Google Sheet "Groundwork" with these tabs:
- **Exercises** (A:E): id, Name, Tags, Notes, Created
- **Templates** (A:H): template_id, Template Name, Order, exercise_id, Exercise Name, Section, Sets, Reps
- **Workouts** (A:Z): id, Date, Time, Type, Name, template_id, Notes, Elapsed (s), Created, copied_from, status,
  Moving (s), Effort, Distance (m), Ascent (m), Descent (m), Avg HR (bpm),
  sub_type, source, source_activity_id, raw_ref, fit_ref, fit_fetched_at, synced_at, started_at_utc, calories
- **Sets** (A:J): workout_id, exercise_id, Exercise Name, Section, Exercise Order, Set #, Planned Reps, Weight (lbs), Reps, Effort
- **Labels** (A:D): id, name, color_key, created
- **DailyHealth** (A:R): date, resting_hr, hrv, steps, calories, sleep_total_s,
  sleep_deep_s, sleep_rem_s, sleep_light_s, sleep_awake_s, sleep_score, vo2max,
  recovery, training_load, bed_time, wake_time, raw_ref, synced_at (#165). One
  row per local date, written only by the COROS sync through `upsertDailyHealth`.
  Every value is nullable: blank means COROS did not say, never `0`. Sleep is
  filed under its wake-up day; `sleep_total_s` includes awake time; `vo2max` and
  `recovery` are current-state snapshots. There is no step goal: COROS sends none.
- **DailySummary** (A:R) — **derived, never authoritative** (#131). One row per
  local calendar day, rebuildable at any time from `Workouts` + `DailyHealth`.
  Nothing writes here by hand. If it disagrees with `Workouts`, `Workouts` is
  right and this is stale.
  `total_distance_m`/`total_ascent_m` are **outdoor only**, so they will not
  equal the sum of a day's activity distances on any day with an indoor
  session — correct, and surprising, so say so wherever it is displayed.
- **SyncLog** (A:M) — one row per COROS sync run (#156): run_id, started_at,
  finished_at, window_start, window_end, n_seen, n_new, n_updated, n_enriched,
  n_fit_fetched, n_errors, status (`ok`/`partial`/`failed`), error_detail.
  Appended only by the sync; the dead-man's switch
  (`coros-sync-watchdog.yml`) fails when the newest row is over 16 h old.

`Created` on `Exercises`/`Workouts`/`Labels` is written but never read — a
deliberate forensic trail, not dead weight to be removed.

**Durations are stored in seconds** (`Workouts!H`), displayed and entered in
whole minutes. `frontend/src/api/duration.ts` is the only conversion boundary.
`Workouts!L-Q` are nullable activity attributes — empty means nobody said, and
no code path may default them to `0`. `Workouts!R-Z` are the sync provenance
columns, nullable for the same reason; a blank `source` positively means
"logged by hand", so nothing may default it to a vendor name.

### Workout Types
- `weight` — structured weight training with exercises, sets, reps, effort
- `stretch` — notes + date only
- `bike` — notes + date only
- `hike` — notes + date only

### Template Sections
Exercises in templates are tagged with sections: `warmup`, `primary`, `SS1`, `SS2`, `SS3`, `burnout`, `cooldown`. Superset exercises share the same `SS*` tag.

### Effort Scale
Three levels: `Easy`, `Medium`, `Hard`

### Exercise Tags
Comma-separated, multiple per exercise. Common tags: Push, Pull, Legs, Chest, Back, Shoulders, Arms, Core, Compound, Isolation.

## UX Design Decisions
These decisions were made with the user and must be respected by all agents:

- **Landing screen**: Activities (chronological workout list with floating "Start Workout" button)
- **Set logging**: Logbook-style — record sets when convenient, not real-time per-set
- **Rest timers**: None in-app — rest times are planning data only (user uses watch)
- **Supersets**: Flat list with section labels/colors (not grouped flow)
- **Start workout**: Choose [From Template] or [Build Custom]
- **Exercise library**: Inline creation (on-the-fly during workout/template building)
- **Set entry**: Quick-fill weight for all sets, override individual sets if different
- **Templates**: Create via dedicated editor AND save-from-workout
- **Navigation**: Bottom tab bar (Activities | Templates | Exercises | Settings)
- **Activity cards**: Compact (Date, Name, Type badge) — tap to view details
- **Activity detail**: Summary per exercise, tap to expand set-by-set
- **Copy workout**: Pre-fill from previous + show "last time" reference while logging
- **Device**: Mobile-first (375px primary breakpoint)

## The Board

**Issue tracker: GitHub only.** All issue references mean GitHub issues; use the
`gh` CLI exclusively. Project #4, `https://github.com/users/luketmoss/projects/4`.

**All board writes go through `node .thrive/board.mjs`** — never hand-write
GraphQL against the project and never call `gh project field-list`. IDs live in
`.thrive/board.json`; `board.mjs sync` refreshes them if a column is added or
renamed.

| Stage | Skill | Gate |
|---|---|---|
| To Do | `/idea` | |
| PM Refining | `/pm` | |
| UX | `/ux` | |
| Refined | — | **agree with the spec?** |
| In Development | `/dev` | |
| Testing | `/qa` | |
| Code Review | `/review` | |
| Ready to Ship | `/ship` | **agree with the implementation?** |
| Done | — | |

Each skill owns its own column moves. A stage skill is a step, not a stopping
point — each one names the skill that moves the work on.

## The Two Runs

Work moves through the board in **runs**, not stage by stage. A run chains its
stages back to back in one pass and does not check in between them.

- **`/refine`** — To Do → Refined. "Get #42 ready for dev", "refine this",
  "spec it out". Chains `/idea` (if the issue doesn't exist) → `/pm` → `/ux` →
  `/pm`, and stops at the design gate.
- **`/finish`** — Refined → Done. "Finish #42", "ship it", "build it out".
  Chains `/dev` → `/qa` → `/review` → `/ship`, resuming from whatever column the
  issue is actually in.

The two runs are deliberately separate. Running them back to back skips the
design gate, which is the only review of the spec.

**Do not chain the stages by hand.** If the request is a run, invoke the run
skill; it owns the sequence, the halt conditions, and the report.

Outside the runs: `/devops` for CI/CD and deployment problems, `/ux` on its own
for a standalone audit.

## Halting

A run stops early only for the conditions its skill lists — an open product
question, a failed criterion with no clear fix, a blocking review, a red check.
Two attempts at a failing stage, then stop.

**A halted run is a success.** Report where it stopped and why; do not work
around a gate, and do not guess at an answer to a question you raised.
