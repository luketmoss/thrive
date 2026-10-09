# Thrive

A personal training and health tracker. A mobile-first Preact app reads and writes a Google Sheet ("Groundwork"), which also receives workouts and health data automatically from a COROS watch and a Withings scale. Live at `https://<username>.github.io/thrive/`.

The sheet is the database: human-readable, portable, and easy to pivot or chart by hand.

## What it does

- **Day view** (the landing screen): one day's plan, activities, health, body measurements and journal note.
- **Activities**: a log of weight, stretch, bike and hike sessions, with filters by type and label. Tap one for a summary per exercise, then expand for set-by-set detail.
- **Weight training**: templates with sections (warmup, primary, supersets, burnout, cooldown), rep ranges, per-set weight and Easy/Medium/Hard effort, and a "last time" reference when you copy a previous workout.
- **Planning**: schedule workouts ahead (with an estimated duration) and start them from the plan.
- **Trends**: charts and tables over `DailySummary`, with a custom metric picker.
- **Journal**: one free-text note per day.
- **Library**: templates and exercises (multi-tag, created inline while logging or building a template).
- **Synced data**: COROS activities, daily health (sleep, HRV, resting HR, steps, recovery, stress) and Withings scale and blood-pressure readings arrive on a schedule. Settings has a "Sync now" button.
- **Demo mode**: the whole app with fake data and no Google account.

## How it fits together

```
 COROS ──┐                                     ┌──▶ Preact SPA (GitHub Pages)
         ├─▶ sync/ (GitHub Actions) ─▶ Apps Script API ─▶ Google Sheet ◀─┤
Withings ┘                                     └──▶ MCP server (in Keel)
```

| Part | Directory | What it is |
|------|-----------|-----------|
| SPA | `frontend/` | Preact + Vite + `@preact/signals`. Talks to the Sheets REST API directly with Google Identity Services OAuth. Deployed to GitHub Pages by `deploy.yml`. |
| API | `apps-script/` | Google Apps Script web app: the server-side API over the sheet. Owns the row mapping for every consumer except the SPA. See its [README](apps-script/README.md). |
| Sync | `sync/` | Node scripts that pull COROS and Withings data, archive raw payloads to Drive, and write through the API. See its [README](sync/README.md). |
| Scripts | `scripts/` | One-time migrations, backfills and admin tools, run with the service account (`scripts/thrive-sa.json`, gitignored). Schema changes (new columns or tabs) live here. |
| Docs | `docs/` | Design plans: [data architecture](docs/data-architecture.md), [COROS sync](docs/coros-sync-plan.md), [health aggregator](docs/health-aggregator-plan.md), [implementation plan](docs/implementation-plan.md). |
| MCP server | not in this repo | Lives in [`luketmoss/keel`](https://github.com/luketmoss/keel) under `mcp/`, a Cloudflare Worker added as a claude.ai connector. It is a thin client of the Apps Script API. |

**Row mapping exists in two places and they change together:** `apps-script/src/types.js` and `frontend/src/api/*.ts`. A change to an Apps Script response shape also needs a matching change in `keel/mcp/src/thrive/`.

### Sync schedule

| Workflow | Schedule (UTC) | Watchdog |
|----------|----------------|----------|
| `coros-sync.yml` | 00:17, 09:17, 13:17, 18:17 | `coros-sync-watchdog.yml` fails if the newest `SyncLog` row is over 16 h old |
| `withings-sync.yml` | 01:41, 07:41, 13:41, 19:41 | `withings-sync-watchdog.yml` fails if the newest `WithingsSyncLog` row is over 14 h old |

Both can also be dispatched on demand from the app (`SyncRequests` tab, polled by an Apps Script trigger).

## The sheet

The "Groundwork" spreadsheet has these tabs. [CLAUDE.md](CLAUDE.md) holds the column-level detail.

| Tab | Holds |
|-----|-------|
| `Exercises`, `Templates`, `Labels` | The library |
| `Workouts`, `Sets` | Sessions (hand-logged or synced) and one row per set |
| `DailyHealth` | One row per day from COROS |
| `BodyMeasurements` | One row per Withings measure group (SI units: kg) |
| `DailySummary` | Derived rollup per day; rebuildable, never authoritative |
| `Journal` | One note per day |
| `SyncLog`, `WithingsSyncLog`, `SyncRequests` | Sync run history and on-demand requests |

Conventions worth knowing: durations are stored in seconds and shown in minutes; blank means "unknown", never `0`; `Sets!Weight` is in lbs; dates are local `America/Denver`.

## Getting started

Prerequisites: Node.js 20+, Git, and (for a real, non-demo setup) a Google account.

### Try it in demo mode

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173/thrive/?demo=true>. This uses a fake user and sample data; nothing is saved. `VITE_DEMO_MODE=true` in `.env.local` does the same.

### Run it against your own sheet

1. Create a Google Sheet named **Groundwork** with the tabs above. Headers are listed in CLAUDE.md; `scripts/migrate-*.mjs` create the newer tabs, and `scripts/seed-data.mjs` (set `SPREADSHEET_ID` first) loads a starter library.
2. In Google Cloud, enable the **Google Sheets API**, configure the OAuth consent screen (External, Testing, your account as test user), and create a Web OAuth client with origins `http://localhost:5173` and `https://<username>.github.io`.
3. Configure and start the app:

   ```bash
   cd frontend
   cp .env.example .env.local   # set VITE_GOOGLE_CLIENT_ID and VITE_SPREADSHEET_ID
   npm run dev
   ```

4. To deploy: set Pages source to **GitHub Actions**, add repository secrets `VITE_GOOGLE_CLIENT_ID` and `VITE_SPREADSHEET_ID`, and push to `main`.

The Apps Script API and the COROS/Withings sync are optional layers with their own setup; follow `apps-script/README.md` and `sync/README.md`.

## Development

| Command | Does |
|---------|------|
| `cd frontend && npm run dev` | Vite dev server |
| `cd frontend && npm test` | Frontend tests (vitest) |
| `cd frontend && npx tsc --noEmit` | Type-check |
| `cd frontend && npm run build` | Production build to `frontend/dist/` |
| `cd sync && npm test` | Sync tests (`node --test`, no network) |
| `cd apps-script && npm test` | Apps Script tests (vitest, sandboxed `node:vm`) |
| `cd apps-script && npm run typecheck` | Type-check the test harness |

CI (`ci.yml`) runs these on every PR. On Windows, `.gitattributes` pins `*.js`/`*.mjs` to LF; a checkout from before that needs those files re-checked out once.

### Workflow

Issues live on a GitHub Project board and move through To Do → PM Refining → UX → Refined → In Development → Testing → Code Review → Ready to Ship → Done. The Claude Code skills in `.claude/skills/` drive it: `/refine` takes an issue to Refined, `/finish` takes it from Refined to Done. The details are in CLAUDE.md.

## License

Private, personal use.
