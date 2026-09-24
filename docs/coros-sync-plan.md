# COROS → Thrive Activity Sync — Implementation Plan

**Revision 3** — 19 September 2026; §2 verification results added 23 September 2026 (#133)
**Status:** Draft for review. Supersedes Rev 2 in full; do not work from Rev 2.
**Purpose:** Replace Garmin as the system of record for *recorded activities*
and *daily health summaries*, pulling both from COROS into Thrive
automatically so all training data lives in one analyzable place.

**Sequencing:** `docs/implementation-plan.md` orders this work against the
Thrive and Hive changes it depends on.

**Companion:** `docs/data-architecture.md` covers how Thrive's data is
consumed by other apps (the planned Journal, Hive). It is newer than this
document and amends it in several places — see §5, §6 and §13 below, and its
own §9 for the full list.

### What changed since Rev 2

Rev 2 was written without access to the Thrive repository. Three of its
load-bearing architectural assumptions do not hold, and correcting them
simplifies the design rather than complicating it.

- **There is no database and no host.** Rev 2 §5 specified three SQL tables;
  §4 offered "Thrive's own host" as the simplest option. Thrive is a static
  Preact SPA on GitHub Pages writing directly to a Google Sheet. §4's
  conclusion — "this needs a small host somewhere" — is avoidable. See §4.
- **Raw JSON payloads do not fit in Sheets.** A cell caps at 50,000
  characters. The landing-zone concept survives; the storage medium changes
  to Google Drive. See §5.
- **Thrive's `Workouts` tab is already Rev 2's `activity` table.** Rev 2 §5
  said "resist flattening into Thrive's existing workout tables." That advice
  is withdrawn — the existing schema independently converged on the same
  design, down to SI units. See §5.
- **Strength reconciliation decided.** COROS strength activities enrich the
  hand-logged row rather than landing separately. New §7.
- **Provenance and edit preservation decided.** Synced rows stay editable;
  edits survive re-sync. New §8.
- **Garmin export already requested.** Rev 2 §12 phase 0b is closed.

---

## 0. How to review this document

Sections marked **[VERIFY]** contain claims not confirmed from primary
documentation — assumptions to check, not facts. Sections marked **[DECIDE]**
are open design choices. Both are deliberately left visible so this document
can be argued with rather than merely approved.

§§1–3 are carried forward from Rev 2 and describe COROS, which has not been
re-verified here. §§4 onward are rewritten against the actual Thrive
codebase.

---

## 1. Context

- Thrive is self-owned software. No external stakeholders, no migration
  constraints, schema can change freely.
- Moving off Garmin specifically because COROS offers self-service
  programmatic access to one's own data. Garmin's equivalent is not merely
  business-gated — the Connect Developer Program has removed its application
  form and paused new API access with no reopening date, and the community
  libraries were broken by Cloudflare bot protection in March 2026. There is
  no individual path.
- Activities to capture: cycling, hiking, running, strength training.
  Long sessions (5+ hours) are normal; multi-day backpacking trips happen.
- Downstream goal: agents inside Thrive analyze trends and recommend
  workouts. A dashboard over the data (e.g. miles ridden this week) is a
  likely follow-on.

### What is being replaced

Two halves of Garmin, and only two:

1. **Recorded activities** — a tracked ride, hike or run, with full detail,
   including the GPS track (the FIT file) for mountain bike rides.
2. **Daily summaries** — steps, sleep, resting HR, HRV, and whatever else the
   daily payload exposes.

### Non-goals for v1

- Real-time sync. Nightly is sufficient.
- Multi-user support. Single user — no tenant isolation, no credential
  vault, no admin UI.
- Writing workouts back to the watch. Designed for, not built. See §12.
- Replacing manual strength logging. Wrist-based rep detection is
  unreliable across every vendor; lifts stay hand-logged in Thrive. COROS
  strength data enriches those rows rather than replacing them — §7.
- Rendering GPS tracks on a map. FIT files are *stored* in v1 so the data
  exists; drawing them is a separate piece of work.

---

## 2. Access tier and verification status

COROS publishes three integration paths. The relevant one is the middle tier.

| Tier | Access | Applies here? |
|---|---|---|
| Connect to AI assistant | Prebuilt MCP connector, no code, read-only | No — need data *in* Thrive |
| **Build on COROS MCP** | **OAuth 2.0, self-service, no application** | **Yes** |
| Partner API | Multi-user creds, webhooks, two-way sync, GPX | No — requires established platform + review |

**Confirmed:**

- OAuth 2.0, standard protocol, any client library works
- No application or approval required
- Read access to activities, health metrics, fitness assessments
- Write access for training plans and workouts, **including strength**
- Single-user authorization
- **No webhook push. The app polls.** This is why the design is a cron job
  and not an event handler — a constraint of the tier, not a shortcut.
- **Endpoint:** `https://mcp.coros.com/mcp` — regional URLs have been
  consolidated into this single one. Official server repo: `coroslab/COROS-MCP`.
  An npm package (`coros-mcp`) also exists.
- **FIT files available.** Per-workout retrieval of full GPS tracks and
  second-by-second data. **Capped at 50 files per fixed 24-hour window** —
  file downloads and download-URL requests share one allowance, and the
  window starts at the first request, not at midnight.
- **No COROS subscription exists.** No fee is documented for the
  self-service tier, and the company's positioning is explicitly
  no-subscription. Soft caveat below.

### Verification results — #133, 23 September 2026

These were [VERIFY] items. They were answered from an authorized session
against a real account (APEX 4, one day of data), COROS's own README and
client code in `coroslab/COROS-MCP`, and the Garmin export. The harness was
a throwaway script; nothing from it ships.

**Registration** is dynamic client registration — one
`POST /connect/register`, no portal, no approval. COROS's own client
registers as a **public client** (`token_endpoint_auth_method: none`, PKCE
S256), and so did the spike. **There is no client secret.** The server also
offers the device-code grant, a cleaner way to authorize a headless job the
first time. US accounts are served from `https://mcpus.coros.com/mcp`, which
the consolidated URL routes to.

1. **Historical backfill — pre-authorization activities are exposed.**
   `querySportRecords` returned two activities recorded ~16 hours before
   authorization, and accepted a 2020–2026 date range without complaint.
   History is a date-range query over the whole account, not a feed that
   starts at authorization. How far back it reaches is untested beyond the
   account's first day — and moot, because the account's history starts
   22 Sept 2026. See §11.
2. **Token rotation — refresh tokens rotate on every use.** Each refresh
   returned a new refresh token, and presenting a superseded one failed with
   `invalid_grant` / `Duplicate grant rejected`. Replaying the old token did
   **not** revoke the chain — the newest token still refreshed afterwards —
   so a lost race costs one failed call, not a re-authorization. Access
   tokens live **30 days**. Refresh tokens are opaque (128 characters, not
   JWTs), the token response carries no refresh-token expiry, and
   introspection needs client authentication a public client does not have,
   so **whether the grant has an absolute lifetime is still unknown**. Only
   waiting will show it; §10's "last synced" display is what catches it.
   §4's Drive-stored token is justified.
3. **General rate limits — none published, none observed.** No response
   carried a rate-limit header, ~25 calls in a few minutes drew no
   throttling, and latency ran 50 ms–3.7 s (the slow one was the six-year
   range). The only documented limit is FIT's, above. Some tools cap their
   own window instead: sleep HRV and the stress time series take at most
   7 days per call.
4. **Daily health payload shape — seen.** §5's `DailyHealth` table now
   reflects it. `queryDailyHealthData` returns steps, calories, average
   stress and sleep total / deep / light / REM / awake as durations at
   **minute** precision. `querySleepData` separately returns a **sleep
   score** (0–100), stage ratios and the sleep window. Resting HR and HRV
   each need their own call. Every sleep tool files a night under its
   **wake-up day**. Note the two tools disagree on "total": the daily
   overview's includes awake time (7h 17m on the test night), the sleep
   tool's "Main Sleep" excludes it (7h 6m). For #148: `querySleepData`'s
   main sleep window supplies **bed and wake times**; **no tool returns a
   step goal**, in any payload or tool description.
5. **Sport type vocabulary — published.** The full code list is in the
   `querySportRecords` tool description; `docs/data-architecture.md` §4 has
   the venue-bearing subset. Venue is encoded in the code for most families
   but not all.
6. **Cost — free.** COROS's README: "COROS MCP itself is free of charge."
   The only fees it mentions are the AI platform's, not COROS's.

### Found along the way

Things nobody asked about that bear on the design.

- **Every tool returns prose, not data.** None of the 34 tools declares an
  `outputSchema` or returns `structuredContent`. A result is a
  JSON-encoded string of human-formatted text — `Duration: 37:38 | Avg HR:
  99 bpm` — written for a chat window. The sync must either parse that
  text, which is brittle against a server that ships tool changes often, or
  take activity numbers from the FIT file, a stable specified format. **New
  open question, §17 item 5.** It also strengthens §5's raw landing zone:
  the stored text is the only way to re-parse after a format change.
- **FIT download URLs are unauthenticated.** `queryActivityFitFileDownloadUrls`
  returns a plain, unsigned `https://s3.coros.com/fit/<user>/<activity>.fit`
  that downloads with no credentials. The URL is a secret: never write it to
  the sheet, `raw_ref` or `SyncLog`. `fit_ref` stays a Drive file ID.
- **Strength FIT files carry set structure but not load.** The test
  session's FIT has a `set` message per active set and rest — duration and a
  FIT exercise category — and no GPS. No reps or weight. That is §7's
  premise: COROS enriches the hand-logged row, never replaces it.
- **Recovery and fitness are current-state only.** `queryRecoveryStatus`
  and `queryFitnessAssessmentOverview` take no date, so there is no history
  to backfill and the recorded value depends on when the job runs. VO2max
  is absent until the watch has outdoor runs to estimate from. Training
  load *is* per day.
- **The server is stateless MCP** — no session to keep between calls.

### Reliability note

A reviewer testing the MCP in May 2026 got "COROS API is temporarily
unavailable" from **every** endpoint across activities, daily health and
heart rate — authorization succeeded, tools loaded, queries all failed.
Treat server availability as genuinely unreliable rather than assumed. This
raises §10's retry logic and dead-man's switch from good-practice to
load-bearing.

Every call in #133's session succeeded. One clean afternoon does not retract
May's report; the retry logic stays.

---

## 3. Endpoint inventory

Rev 2 listed fifteen endpoints across five groups. The live server exposed
34 tools in Sept 2026 (#133), mostly additions: time series for stress, HRV
and health checks, lap data, direct FIT download, and more planning writes.
Not all are needed for v1.

**Activities** — the core of v1
- Query workout records and summaries. Filters: date, sport type code,
  distance, duration, pace, location. Returns activity IDs and time info
  needed for subsequent detail calls. **← v1 primary**
- Query detailed activity data: heart rate, pace/speed, elevation, cadence.
  **← v1 primary**
- Query default lap/segment data, per the display fields for that sport type
- Query custom segment data within a precise time window
- Query athlete-logged workout feedback and notes
- **Retrieve .fit file URL** — full GPS track, second-by-second. 50/day cap.
  **← v1, rate-limited, see §4**
- Coach-style analysis generated from activity details. *Skip — this is
  COROS's interpretation layer; Thrive's agents do that job.*

**Daily health**
- Daily metrics: resting HR, HRV, sleep, steps, calories **← v1**
- Time-series stress data
- Time-series HRV recorded during sleep
- Time-series data from quick health checks
- Menstrual cycle data *— n/a*

**EvoLab assessments**
- VO2max, running power, threshold pace, race prediction, training load,
  recovery **← v1, cheap to pull, high analytical value**

**Profile and devices**
- User profile: height, weight, birthday, all-time totals. *One-time pull.*
- Bound devices: device ID, firmware type, custom name. *Useful for
  provenance if a second COROS device is ever added.*

**Planning (write)** — v2, see §12
- Query training plan details (required before any update)
- Create a plan: running, cycling, **strength**, rest, phase descriptions
- Update a plan, submitting only the dayNo workouts that change

---

## 4. Architecture

Rev 2 asked where the job should run and concluded Thrive probably needed a
new host. It does not. `mcp-server/sheets.js` already authenticates to the
Groundwork sheet with a **Google service account JWT** — precisely because
the SPA's browser OAuth token isn't available outside the browser. That
credential works headless, from anywhere, today. The sync job is a second
consumer of a pattern that is already built and tested.

```
  COROS APEX 4
      |  (BLE sync to phone — user-initiated or automatic)
      v
  COROS cloud
      |
      |  OAuth 2.0 + MCP (JSON-RPC over HTTP) @ mcp.coros.com/mcp
      v
  [ sync job — GitHub Actions, nightly cron ]
      |
      +--- raw JSON payload + .fit blob ------> Google Drive
      |                                            (service account owns)
      +--- normalized rows -------------------> Groundwork sheet
                                                   (service account writes)
                                                        |
                                    +-------------------+-------------------+
                                    |                                       |
                              Thrive SPA                            Thrive MCP server
                           (browser OAuth)                        (agents / analysis)
```

MCP is a protocol, not an LLM requirement. The sync job is a plain Node
script using an MCP client library. **No model in the loop for the sync
itself** — that would add nondeterminism and cost to what is fundamentally
ETL. Agents read from the sheet afterward, through the MCP server that
already exists.

### Where the job runs — decided

**GitHub Actions on a schedule.** Rev 2's objection ("needs network reach to
Thrive's DB") dissolves: the datastore is the Sheets REST API, reachable from
anywhere with the service account key. The remaining objection — scheduled
triggers are best-effort and can be delayed or skipped — is real, and is
exactly what §6's rolling window already neutralizes. A run that fires two
hours late, or not at all, costs nothing.

This means no VPS, no new bill, no new trust boundary, and secrets
management that already exists.

### Where the code lives

**Superseded by `docs/data-architecture.md` §6.** This section originally
had `sync/` import `sheets.js` and `domain.js` from `mcp-server/`, to avoid
a third copy of the row mapping. That reasoning is obsolete: Thrive is
getting an Apps Script API on Hive's pattern, `mcp-server/` becomes a thin
client of it, and there is no longer a row mapping there to import.

**Decided: `sync/` is a sibling workspace that writes through Thrive's Apps
Script API**, exactly as the MCP server and the Journal do. It holds no row
mapping of its own.

Practical consequences:

- **The API must exist before the sync writes anything.** See §15 — it lands
  ahead of Phase 3, which is the first phase to touch the sheet.
- **The backfill paces against Apps Script quota.** Nightly volume (1–2
  activities plus the rollup recompute) is far inside any limit; the §11
  historical import is the only real pressure, and it is already specified
  as a resumable queue rather than one long run.
- **The sync holds three credentials**: COROS OAuth tokens (stored in
  Drive), the Google service account (Drive blobs only — no Sheets scope
  needed any more), and the Thrive API key as a static Actions secret.
- **CI needs a third job.** `.github/workflows/ci.yml` runs `frontend` and
  `mcp-server` and is deliberately not path-filtered, because `/ship`
  refuses to merge a PR whose checks are absent. A `sync` job follows the
  same pattern for the same reason. The Apps Script project likewise needs
  its tests wired in, as Hive does with vitest.
- **`mcp-server/` gets refactored into an API client.** Real work on code
  that currently functions; sequence it deliberately rather than folding it
  into the COROS effort.

### Token storage — settled by §2

COROS refresh tokens **rotate on use** (§2 item 2, verified in #133), so
GitHub Actions secrets are the wrong home for the refresh token: a workflow
cannot write back to its own repo secrets without a PAT carrying
`secrets:write` plus libsodium encryption of the new value.

**Recommended:** keep the rotating refresh token in a **single-purpose Drive
file** the service account already owns and can rewrite freely. The client
ID is the only static credential — the client is public, so there is no
secret — and it can sit in an ordinary Actions secret.

Rotation puts three rules on the job:

- **Persist before use.** Write the new refresh token to Drive before doing
  anything else with the access token; §6 already orders it this way. A
  crash between refresh and persist loses the grant, and recovering needs a
  manual re-authorization.
- **Never refresh twice at once.** A second run presenting the same token
  gets `Duplicate grant rejected`. A workflow-level `concurrency:` group is
  enough.
- **A rejected refresh is not proof the grant is dead.** Replay does not
  revoke the chain, so re-read the Drive file once and retry before logging
  the account as needing re-linking.

Access tokens live 30 days. Storing the access token beside the refresh
token and refreshing only when it is within a few days of expiry would cut
rotations — and the crash window above — from nightly to monthly. Worth
considering at Phase 1.

### FIT file strategy

FIT retrieval is capped at 50 files per fixed 24-hour window (§2).

**Decided: fetch-on-ingest.** Normal volume is 1–2 activities/day, so the cap
is irrelevant in steady state; only the §11 backfill needs pacing.
Fetch-on-demand was the alternative and is rejected — it introduces a latency
and a failure path into analysis, in exchange for storage that is free here.

Either way, **track a daily FIT request counter** and have the job stop
cleanly at the cap rather than erroring through it.

**The counter is per calendar day, shared across runs — thrive#149.** §6's
pseudocode originally set `fit_budget = 50` *inside* the run, which agreed
with this section only while the job ran once a night. With several runs a day
(§9) a per-run budget of 50 permits up to 200–250 requests against a confirmed
50/day cap.

Steady state is safe mostly by accident — `if row.fit_ref is null` means an
already-fetched activity is not re-fetched, so later runs usually fetch
nothing. The exposure is the backlog case: a stretch of days with many
activities, a recovery after the job has been down, or a FIT fetch that keeps
failing and leaves `fit_ref` null. Each of those has the next run retry with a
fresh 50 and spend the daily cap without noticing.

Derive the budget rather than storing it: sum `n_fit_fetched` across the
`SyncLog` rows of the **last 24 hours** at the start of a run and begin at
`50 - that`. No new tab, no new column, and it survives a crashed run.

*Amended by #133: a rolling 24 hours, not the calendar day.* COROS's
allowance is a **fixed 24-hour window that opens at the first request**, not a
Denver calendar day (§2). Counting by calendar day overshoots across midnight
— 30 fetches at 22:00, and a 06:00 run believes it has 50 left when COROS has
20. A rolling 24-hour sum always covers the fixed window's own requests, so it
can only under-spend, never over-spend.

**Storage:** Google Drive, foldered by year and month, with the Drive file ID
referenced from the sheet. Not sheet cells — Rev 2 was right about that, and
a cell could not hold one regardless. Not the git repo either: ~500
activities/year at 200KB–1MB each would add 100–500MB/year to a repo that
GitHub Pages serves.

**Parsing note:** `pip install fitparse` is known to fail in some sandboxed
environments. Thrive is a Node project and the sync runs in Actions, so
prefer a JS FIT parser and avoid the Python dependency entirely. Verify the
parser works at Phase 4, not later. *(This repo's `fit-files` skill bundles a
working parser and is worth reading before choosing one.)*

---

## 5. Data model

Rev 2 proposed three new SQL tables. Two of the three already exist in
another form, and the third moves to Drive.

### Principle: the sheet carries what a consumer reads

Everything else lives in the raw Drive payload, reachable by agents on
demand. Without this rule `Workouts` becomes a forty-column junk drawer
holding cadence, normalized power and training-load fields that nothing ever
reads. Max HR, cadence, training load and per-lap data stay in the payload
until something actually reads them.

*Revised.* This was originally "what the **UI** renders", written when
Thrive's own screens were the only consumer. They are not: the MCP server
serves agents today, and `docs/data-architecture.md` adds the Journal. The
test is whether *some* consumer reads a field, not whether a Thrive screen
paints it.

### `Workouts` (existing tab, extended)

Issues #101 and #103 added `Moving (s)`, `Effort`, `Distance (m)`,
`Ascent (m)`, `Descent (m)` and `Avg HR (bpm)` at `L–Q`, stored as **integer
meters and seconds**, with a strict discipline that empty means *nobody said*
and must never default to `0`. That is Rev 2's `activity` table, already
built, already unit-correct, already rendered by the Activities list and
detail screens.

Reusing it means a synced ride appears in the existing UI with **zero new
screens**. A parallel activity table would give one app two activity lists —
that is the actual mistake Rev 2 was trying to avoid, arrived at from the
other direction.

New columns, appended so existing rows need no migration (a blank `source`
reads as manual, which is exactly what those rows are):

| Col | Name | Notes |
|---|---|---|
| R | `sub_type` | Venue/terrain modifier — `mountain`, `gravel`, `indoor`, `outdoor`, or `''`. See below |
| S | `source` | `''` = manual, `coros`, `garmin_import` |
| T | `source_activity_id` | Vendor ID. Unique with `source`. Also set on *enriched* manual rows — §7 |
| U | `raw_ref` | Drive file ID of the raw JSON payload, nullable |
| V | `fit_ref` | Drive file ID of the FIT blob. Nullable — see below |
| W | `fit_fetched_at` | Nullable. Distinguishes "not yet fetched" from "no FIT exists" |
| X | `synced_at` | Last successful write by the sync job |
| Y | `started_at_utc` | ISO 8601 with offset, e.g. `2026-09-19T14:03:00-06:00` |
| Z | `calories` | Nullable, integer kcal. Required by §7 enrichment |

**[DECIDE] `calories` (Z)** is the one metric admitted to the sheet without a
screen rendering it yet, because §7's enrichment is pointless without it. The
alternative is to defer both. Flagging rather than deciding unilaterally.

**`sub_type` (R)** is added by `docs/data-architecture.md` §4. The target
activity list (Biking-Mountain/Gravel/Indoor, Running-Indoor/Outdoor,
Walking-Indoor, Hiking, Weight Training) is a *sport* crossed with a
*venue/terrain* modifier, not eight peer enum values. Keeping `type` coarse
and adding `sub_type` means "total miles biked" stays one predicate, existing
`bike`/`hike` rows need no migration, and a new terrain adds no enum member.
A blank `sub_type` means unspecified — which is exactly what last month's
`bike` rows are. Do not backfill them by guessing.

**Timezone.** Rev 2 insisted on a UTC instant plus offset and "never store
naive local times." Thrive stores naive local `Date` (B) and `Time` (C), and
the entire Activities UI depends on that. Both are right for their purpose:
"miles ridden this week" is a local-calendar question, but a ride recorded in
another timezone during a trip must still sort correctly. Keep `Date` and
`Time` local for the UI, and add `started_at_utc` (X) carrying the instant
and offset for anything analytical. The sync writes both; they are derived
from one source and cannot drift.

**Sport types.** `WorkoutType` is currently `weight | stretch | bike | hike`
— no `run`, which §1 lists as an activity to capture. It is wired in only six
non-test places (`types.ts`, `type-selector.tsx`, `activities-filters.tsx`,
`activities-helpers.ts`, `cardio-fields.tsx` ×2), so extending the vocabulary
is cheap. Normalize COROS sport codes into **Thrive's** vocabulary, never
COROS's; an unmapped code is a normalization failure and takes the §10 path.

### `ActivityRaw` → Google Drive, not a tab

Rev 2's `coros_activity_raw` exists to make a normalization bug fixable by
replaying locally instead of re-hitting a rate-limited API, and to preserve
fields that turn out to matter later. Both hold. But a Sheets cell caps at
**50,000 characters**, and a detail payload for a five-hour ride with per-lap
arrays will exceed that. The spreadsheet also caps at 10M cells.

So the landing zone is a Drive folder of JSON files, one per activity, with
the file ID in `Workouts!T`. The payload file carries:

- `payload` — the COROS response, unmodified
- `payload_hash` — detects whether a re-fetch actually changed anything
- `fetched_at`
- `normalized` — **the exact field values this job last wrote to the sheet**.
  This is what makes §8's edit preservation possible; see there.

### `DailyHealth` (new tab)

A different grain from activities — one row per day, not per activity. ~365
rows/year is trivial for Sheets.

| Col | Name | Notes |
|---|---|---|
| A | `date` | PK, local calendar date. Sleep is filed under its wake-up day, which is COROS's convention too |
| B | `resting_hr` | `queryRestingHeartRate`, per day. Not the figure in `queryDailyHealthData`'s header, which is a window summary and was 1 bpm off on the test day |
| C | `hrv` | `querySleepHrv`'s official daily average, ms. At most 7 days per call |
| D | `steps` | `queryDailyHealthData` |
| E | `calories` | `queryDailyHealthData` |
| F–J | `sleep_*` | total / deep / REM / light / awake, in **seconds**, from `queryDailyHealthData`. Minute precision in practice. `sleep_total` is COROS's "Total", which *includes* awake time |
| K | `sleep_score` | `querySleepData`, 0–100. Added by #133. Kept apart from almanac's self-reported `sleep_quality` — sleep is double-sourced |
| L | `vo2max` | EvoLab. **Current-state only** — a nightly snapshot, blank until the watch has an estimate |
| M | `recovery` | EvoLab. **Current-state only** — a snapshot at job time, not a daily value |
| N | `training_load` | EvoLab, per day |
| O | `raw_ref` | Drive file ID |
| P | `synced_at` | |

Shape verified in #133 (§2 item 4).

Same nullable discipline as `Workouts!L–Q`: a day with no sleep data is
blank, never `0`. A watch left on the charger overnight is not zero sleep.

### `DailySummary` (new tab)

Added by `docs/data-architecture.md` §5, which has the column list. It is the
per-day rollup across activities *and* health — the grain the Journal renders
and the grain goals and pattern analysis are expressed over. Neither
`Workouts` (per activity) nor `DailyHealth` (health only) answers "what did
this day look like".

**It is derived and never authoritative.** Rebuildable at any time from
`Workouts` + `DailyHealth`; nothing writes to it by hand. The sync job
recomputes every date in its rolling window each night, which makes it
self-healing at no extra cost.

Weekly and monthly rollups are deliberately *not* materialized — they are
sums over ~365 `DailySummary` rows, and materializing them would add a
staleness surface for no gain.

### `SyncLog` (new tab)

| Col | Name |
|---|---|
| A | `run_id` |
| B | `started_at` |
| C | `finished_at` |
| D | `window_start` |
| E | `window_end` |
| F | `n_seen` |
| G | `n_new` |
| H | `n_updated` |
| I | `n_enriched` |
| J | `n_fit_fetched` |
| K | `n_errors` |
| L | `status` |
| M | `error_detail` |

This tab is also the dead-man's switch — §10.

**Units.** SI internally (meters, seconds), converted at the presentation
layer by `frontend/src/api/units.ts` and `duration.ts`, which are already the
only conversion boundaries. The sync writes SI and touches neither.

---

## 6. Sync algorithm

```
run_nightly_sync():
    token = refresh_access_token(load_refresh_token_from_drive())
    if refresh failed:
        log ERROR, alert, exit nonzero        # never silently no-op
    if token rotated:
        persist new refresh token to Drive    # before any other work

    window_start = today_local - 7 days
    window_end   = today_local + 1 day        # TZ edge guard

    # --- activities ---
    activities = mcp.list_activities(window_start, window_end)

    # FIT budget is a ROLLING 24 HOURS, shared across every run — not per
    # run, and not per calendar day: COROS's window is a fixed 24h from its
    # first request (§2). Derived, not stored, so it survives a crash.
    # See thrive#149, amended by #133.
    fit_budget = 50 - sum(n_fit_fetched for SyncLog rows in the last 24h)

    for a in activities:
        detail = mcp.get_activity_detail(a.id)

        if is_strength(a):
            enrich_hand_logged_row(detail)     # §7 — never creates a row
            continue

        write raw payload to Drive; compute payload_hash

        if payload_hash changed or row is new:
            normalized = normalize(detail)
            merge_into_workouts(normalized)    # §8 — preserves user edits

        if row.fit_ref is null and fit_budget > 0:
            url = mcp.get_fit_url(a.id)
            download and store blob in Drive; set fit_ref, fit_fetched_at
            fit_budget -= 1

    # --- daily health + evolab ---
    # range calls, one per tool, covering the window — not one per day.
    # querySleepHrv takes <= 7 days, so a 10-day window is two calls.
    for day in window_start..today_local:
        upsert DailyHealth[day] from daily overview, sleep, resting HR,
                                     HRV, training load
    snapshot recovery + vo2max into DailyHealth[today_local]
        # current-state only (§2) — there is no history to fetch

    # --- aggregate rollup ---
    for day in window_start..today_local:
        rebuild DailySummary[day] from Workouts + DailyHealth
        # derived, idempotent, safe to recompute every run

    append SyncLog row
```

### Why a 7-day lookback instead of a watermark

The single most important decision in this plan, and the one a naive
implementation gets wrong.

A strict "fetch everything since last successful sync" watermark fails
because **the COROS cloud only has an activity once the watch has synced to
the phone.** Concretely: a 6-hour hike in a canyon with the phone in
airplane mode. Recorded on the watch Saturday, doesn't reach the cloud until
Sunday afternoon. Sunday's 3am job already advanced the watermark past
Saturday. That hike is invisible forever, and nothing in the logs indicates
anything went wrong.

A rolling window with upsert-by-vendor-ID is idempotent, self-healing, and
costs a handful of extra calls per night. It also recovers automatically from
consecutive failed runs with no backfill logic — which matters given the
server instability in §2, and given that GitHub Actions schedules are
best-effort.

It also handles activities edited after the fact (renaming, correcting sport
type, trimming), which change the payload without changing the ID. The
`payload_hash` check catches these and re-normalizes.

### [DECIDE] Window length

Seven days balances recovery against call volume. Multi-day backpacking with
no signal is a real use case here — §1 says so explicitly. **Ten days is
probably the better default** and costs almost nothing: the extra calls are
summary-level, and `payload_hash` means unchanged activities are re-read but
not re-written.

---

## 7. Strength reconciliation — decided

COROS will report strength training as an activity. Thrive's strength data is
hand-logged and stays that way (§1 non-goal). Landing COROS strength
activities as their own rows would double every lift session in the
Activities list, permanently.

**Decided: a COROS strength activity enriches the matching hand-logged row
and never creates one of its own.**

### Matching

1. Candidate rows are `Workouts` with `type = 'weight'` on the same local
   date as the COROS activity.
2. Among candidates, match the one whose start time is nearest the COROS
   start, within a tolerance window.
3. Matching is **one-to-one**. A hand-logged row already carrying a
   `source_activity_id` is not a candidate for a different COROS activity.
4. **No match, or an ambiguous match, is not an error and not a new row.**
   Log it to `SyncLog` and move on. The raw payload is still written to
   Drive, so nothing is lost and the match can be made later by hand.

**[DECIDE] Tolerance window.** ±30 minutes is a reasonable first guess but is
genuinely a guess — it depends on how promptly the workout gets marked
finished in Thrive relative to when the watch stops recording. Worth
calibrating against a week of real data at Phase 3 rather than picking now.

### What gets written

**Enrichment fills blanks only. It never overwrites a value you typed.**

This is a deliberately stricter rule than §8's merge. A hand-logged weight
workout's `Elapsed` and `Effort` are *your* record of the session; the
watch's opinion does not outrank them. Fields eligible for enrichment, and
only when currently empty:

- `Avg HR (bpm)` (Q)
- `calories` (Y)
- `Moving (s)` (L)
- `Elapsed (s)` (H)

The row keeps `source = ''` — it is still a hand-logged workout. It gains
`source_activity_id` (S), `raw_ref` (T) and `synced_at` (W). The UI reads
"enriched" as `source == '' && source_activity_id != ''`, distinct from both
manual and synced — see §8.

No FIT file is fetched for a strength activity. There is no track, and the
50/day budget is better spent elsewhere.

---

## 8. Provenance and edit preservation — decided

Synced activities appear in the Activities list beside hand-logged ones.

**Decided: a subtle badge, and the row stays fully editable.**

Read-only synced rows were the simpler correctness story, but they make it
impossible to rename a ride or correct a mis-detected sport type — and COROS
*will* mis-detect sport types. Making the badge invisible was the other
alternative and is worse: a later sync silently overwriting an edit would be
undetectable.

### The badge

Three states, derived from existing columns, no new UI state:

| State | Condition | Treatment |
|---|---|---|
| Manual | `source == ''` and no `source_activity_id` | No badge — the default today |
| Synced | `source != ''` | Small provenance indicator on the activity card |
| Enriched | `source == ''` and `source_activity_id != ''` | Hand-logged, watch-augmented — §7 |

Per CLAUDE.md, activity cards are compact (Date, Name, Type badge). The
provenance indicator must not compete with the type badge for attention; it
is a quiet mark, not a second chip.

### Preserving edits across re-sync

The naive upsert overwrites the row every time the payload hash changes,
destroying any edit. The fix is a three-way merge, which is why §5's Drive
payload stores `normalized` — the exact values the job last wrote.

For each field, on re-sync:

```
last_written = payload.normalized[field]     # what we wrote
current      = sheet_value[field]            # what's there now
incoming     = normalized(detail)[field]     # what COROS says now

if current == last_written:      write incoming     # untouched by user
else:                            keep current       # user edited it
```

Then rewrite `normalized` with what was actually written, so the next run
compares against truth.

The consequence worth stating plainly: **once you edit a field, that field
stops tracking COROS for that activity.** That is the correct behaviour — you
edited it because the watch was wrong — but it is a real semantic and should
be visible somewhere, minimally in `SyncLog`'s counts.

`raw_ref`, `fit_ref`, `synced_at`, `source` and `source_activity_id` are
sync-owned and always overwritten. They are not user-editable fields.

---

## 9. Scheduling

**Local timezone is US Mountain.** MDT is UTC−6, MST is UTC−7.

**Amended 24 September 2026: the job runs several times a day, not once.**
Almanac's §9.9 decides that a health number appears only once a sync has
brought it — no stand-ins, and running counts like steps show "so far" with
the time of the sync that brought them. A single 03:17 run cannot serve that:
it fires *before* waking, so last night's sleep has not reached the COROS
cloud yet, and today's steps do not exist. The overnight run stays; daytime
runs are added.

- **Keep the ~03:00 local run.** It closes out the previous day, which is
  what it was always for.
- **GitHub Actions cron is UTC, and has no timezone setting.** Anchoring
  03:00 on the offset currently in effect (MDT, UTC−6) gives **`17 9 * * *`
  — 09:17 UTC**.
- **The odd minute is deliberate.** GitHub delays or drops scheduled runs
  clustered on the hour; :17 avoids the crowd.
- **DST drift is accepted, not chased.** That one expression fires at 03:17
  local in summer and 02:17 local in winter. Both sit comfortably inside the
  window between "yesterday is over" and "before I wake up", so the drift
  costs nothing. Do not add a second cron line to correct it — two
  expressions means two runs on the changeover days, and the only thing
  that actually protects correctness is §6's rolling window, which makes a
  double run harmless anyway.
- **Local date is computed in `America/Denver`, not from the runner's
  clock.** An Actions runner is UTC, so `today_local` at 09:17 UTC is
  *yesterday* in Mountain Time. Every date boundary in §6 — the window
  bounds, `DailyHealth`'s PK, the §7 strength match's "same local date" —
  must be derived in the configured zone. Reading the runner's local date
  would silently shift the whole window by a day.
- **Actions schedules are best-effort.** GitHub delays or skips scheduled
  runs under load, particularly on the hour. Schedule at an odd minute, and
  rely on §6's window rather than on any given run firing.
- **Watch sync dependency.** Wearing the APEX overnight means it syncs on
  wake and the 3am job catches the previous day. Not wearing it means the
  previous day arrives a day late and the lookback handles it. Either works;
  it changes freshness, not correctness.

### Daytime runs

- **Add runs through the waking day**, each at an odd minute, each in UTC and
  drifting with DST like the overnight one. A morning run after typical wake
  time is the load-bearing one: it is what makes last night's sleep appear.
  Later runs keep the running counts current.
- **Extra runs cannot hurt correctness.** §6's rolling window with
  upsert-by-vendor-ID is idempotent, so an extra run is wasted calls at worst.
  This is purely a freshness change.
- **[DECIDE] the cadence** — no longer blocked. The unknown was the limit on
  ordinary reads, and #133 found none published and none observed (§2 item
  3). A run is roughly a dozen summary-level calls — one activity list, a
  detail per new activity, and one range call per daily-health tool — so
  five runs a day is on the order of 60 calls. The 50-file FIT cap is not the
  constraint either (FITs are fetched once per new activity, not per run).
  Choose the cadence on freshness grounds.
- **Tighten the dead-man's switch.** §10 alerts when the newest `SyncLog` row
  is older than **36 hours**, which was right for one run a night. At several
  runs a day that is far too slack — a job that stops at breakfast would go
  unnoticed until the following evening. The threshold should follow the
  cadence, not the old daily assumption.
- **`SyncLog` grows proportionally.** One row per run, so five runs a day is
  ~1,800 rows a year instead of ~365. Still trivial for Sheets, but worth
  knowing before someone reads the tab expecting one row per day.

**Not yet decided here:** Almanac also wants sync-on-demand — a button rather
than a wait — tracked as keel#360, a half-day spike gated on this epic.

---

## 10. Failure modes

| Failure | Detection | Response |
|---|---|---|
| Refresh token expired/revoked | Token refresh 4xx | **Alert loudly.** The one failure requiring human action. Silent failure here means months of missing data |
| Token rotation not persisted | Next run's refresh 4xx | Write the new refresh token to Drive *before* any other work — a crash mid-sync must not orphan it |
| COROS API down / 5xx | Non-2xx from MCP | Retry with backoff, 3 attempts, then fail the run and log. Next night recovers via lookback. **See §2 — this is expected, not exceptional** |
| Rate limited (429) | Status code | Honor `Retry-After` if present, else exponential backoff |
| FIT cap hit | Local counter at 50 | Stop fetching FITs cleanly, log remaining backlog, continue the rest of the sync. Next night resumes |
| Unmapped sport type | Normalization raises | **Keep the raw payload, skip the sheet write for that row, log it.** Never let a normalization failure block raw ingestion |
| Sheets row-index drift | `WorkoutRowMismatchError` | The frontend already guards this (#95). The sync must verify row identity by id before writing, not trust a cached index |
| Ambiguous strength match | §7 matching | Not an error. Log and skip; raw payload is retained |
| Cron didn't fire | No `SyncLog` row for >36h | Dead-man check, below |

**Dead-man's switch.** Every failure above is detectable only if something is
looking. The realistic outcome otherwise is that this works for two months,
quietly breaks, and gets noticed in November when a dashboard looks wrong.
**A cron job that reports only on failure cannot report that it didn't run.**

Two layers, both nearly free:

1. **GitHub Actions failure email** — on by default, covers the loud case
   where the job ran and failed.
2. **"Last synced" on the Settings screen** — one read of `SyncLog`'s last
   row, displayed with its age, going visibly stale when the job stops
   firing. This makes *you* the monitor and needs no alerting infrastructure
   at all.

For a single-user system that is proportionate. A push/email alerting
pipeline is not.

### [VERIFY] Is any of this overbuilt?

Rev 2 asked. Assessed against a single-user system:

- **Raw landing zone** — keep. §14 strengthens the case: it is the archive,
  not a cache. Storage is free in Drive.
- **Three-way merge (§8)** — keep, but it is the most complex thing here. It
  exists only because synced rows are editable. If it proves fiddly at
  Phase 3, falling back to read-only synced rows is a legitimate retreat.
- **Rolling window over watermark** — keep. This is the cheapest insurance
  in the document.
- **Retry with backoff** — keep, given §2's reliability note.
- **`SyncLog` as a full table** — keep. It is thirteen cells a night and it
  is the dead-man's switch.

---

## 11. Historical backfill

One-time, separate from the nightly job. Both halves feed the same
`normalize()` and merge path — a separate import path will drift.

### Garmin history

**The Connect account data export has arrived** (23 Sept 2026, 2017-05-30 to
2026-09-19). Activities come twice: as FIT files zipped under
`DI-Connect-Uploaded-Files/`, and as structured JSON in
`DI-Connect-Fitness/*_summarizedActivities.json`. Write an importer targeting
`source = 'garmin_import'`, reusing the same normalization and the same Drive
storage layout. Garmin-sourced rows are `synced` for badge purposes but are
never re-fetched — there is nothing to re-fetch from. The export also carries
daily wellness data; see §15.

### COROS history

Answered by §2 item 1: the API exposes pre-authorization activities, so COROS
history is a walk backward in date windows, not an export request. In
practice there is almost nothing to walk — the account's history starts
22 Sept 2026.

**The 50-file FIT cap therefore never bites a backfill:** COROS history is a
few days, and Garmin's FIT files come out of the export zip rather than the
API. Keep the backfill a resumable job all the same — nine years of Garmin
activities plus ~3,200 `DailyHealth` days still press on Apps Script quota
(`docs/data-architecture.md` §6), and GitHub Actions caps a run at six hours.

---

## 12. Write path (v2, design for it now)

The self-service tier permits creating and updating training plans, with
running, cycling, **strength** and rest as first-class workout types. That
closes the loop: Thrive's agents read history, plan the week, push sessions
to the watch. Strength support matters given the 3x/week lifting cadence.

Thrive already has the reading half — `thrive_schedule_week` (#126) schedules
several workouts in one call, and `planned` status exists on `Workouts!K`. A
write path pushes those planned rows to the watch rather than inventing a new
concept.

Not v1 scope, but three constraints on v1 design:

- Keep MCP session and auth handling in a module that isn't read-specific.
- Track provenance on planned sessions (`planned_by`, `pushed_to_coros_at`)
  so a pushed workout returning as a completed activity reconciles against
  the plan rather than looking like an unrelated session. Note this
  interacts with §7 — a pushed strength session coming back as a COROS
  strength activity should enrich the row that generated it, which is a
  *better* match signal than §7's time-window heuristic.
- The update endpoint expects **only the changed dayNo workouts**, not the
  whole plan. Query plan details first.

---

## 13. Impact on the existing app

**This is not a backend-only programme.** Several of the items below change
what the app looks like and how logging a workout feels. Worth stating
plainly, because the data model work reads as invisible and most of it is.

The user-visible ones: the type selector and Activities filters grow by two
types, a `sub_type` control appears for bike/run/walk, cardio fields appear
and disappear depending on venue, activity cards gain a provenance badge,
and Settings gains a last-synced line.

What this touches beyond new code:

- **`WorkoutType` gains `run` and `walk`** — six non-test sites, plus tests.
- **`hasCardioFields()` and `showDescent` become `(type, sub_type)`
  functions.** Today `cardio-fields.tsx` decides from `type` alone
  (`type === 'bike' || type === 'hike'`). An indoor activity has no
  meaningful ascent — a trainer or treadmill reports none — and rendering an
  empty Ascent field invites the `0` that CLAUDE.md's nullable discipline
  exists to prevent. Outdoor `run` gets distance, ascent and HR; never
  descent.
- **`Workouts` grows from A:Q to A:Z** — `sub_type` at R shifts every
  sync-owned column one letter right. Every range literal in
  `frontend/src/api/workouts-api.ts` and `mcp-server/domain.js` changes
  together, per CLAUDE.md's standing rule.
- **`row-shape.test.ts`** guards column mapping and must be extended.
- **Activity cards and detail** gain the provenance badge (§8).
- **Settings** gains the "last synced" line (§10).
- **The MCP server** should expose the new data to agents — daily health and
  synced activity detail — or the analysis goal in §1 is unreachable from
  the agent side.
- **Demo mode** (`demo-data.ts`) needs synced and enriched examples, or the
  badge states can't be previewed without real credentials.

---

## 14. No second inlet — and why

**Rev 1 recommended adding Strava as redundancy. That recommendation was
withdrawn in Rev 2 and stays withdrawn.**

Strava's API Policy effective 1 June 2026 prohibits using Strava data in
connection with the development, training, evaluation, or operation of any
AI application, with retrieval-augmented generation and ingestion into a
context window named explicitly. Thrive's entire purpose is agents analyzing
training history. That is the prohibited use, named directly. Strava API
access also now requires a paid subscription.

There is no drop-in replacement. The practical consequences:

- **COROS is a single point of failure** for ongoing data collection. Accept
  this consciously rather than discovering it later.
- **This raises the value of the raw payloads and FIT blobs in §5.** If
  COROS access ever disappears, the Drive archive is the record. It is not a
  cache — it is the hedge.
- **[DECIDE]** Rev 2 proposed a monthly cold-storage dump. Since the archive
  already lives in Drive rather than on the sync host, this is mostly
  already satisfied — Drive is not the same failure domain as COROS. A
  periodic dump elsewhere is defensible but is plausibly premature for v1.

---

## 15. Migration of existing data

Most of this plan appends rather than rewrites, but not all of it, and the
one genuine gap is large enough to strand the Journal.

### `DailySummary` has no history — the load-bearing one

§6's loop rebuilds `DailySummary` only for dates inside the rolling window.
Every workout logged before the sync starts would therefore have **no
`DailySummary` row at all**, and the Journal reads that tab for its day view.
Scrolling back past the sync's start date would show empty days across the
entire existing history.

**A one-time backfill over all history is required**, and it has three
properties that must be designed in rather than bolted on:

1. **The rebuild takes an arbitrary date range**, not the sync's window. If
   the rebuild is written against `window_start..today`, the backfill has to
   reimplement it, and the two will drift. One function, a range parameter.
2. **It is re-runnable, and must be re-run after any historical import.**
   Phases 9 and 10 load Garmin and COROS history; any `DailySummary` built
   before those lands would be missing them. This is not a one-time event
   at the end of the project.
3. **Historical rows are legitimately partial.** There is no `DailyHealth`
   before COROS, so `steps`, `resting_hr`, `hrv`, `sleep_total_s` and
   `training_load` are **blank** for every pre-switch day. Blank, never
   zero — a day before the watch existed is not a day with no steps. The
   activity-derived columns populate normally.

Volume is modest: a few hundred to a couple of thousand rows depending on
how far back history goes, written through the API in paced batches like any
other backfill.

### `started_at_utc` on existing rows

`Workouts!Y` is new and empty on every existing row. It is derivable from
the existing `Date` + `Time` by applying the `America/Denver` offset **for
that date**, so the conversion must be DST-aware rather than applying a
fixed −6 or −7.

Two caveats, both acceptable:

- A row logged while travelling gets the Denver offset, which is wrong. There
  is no better information available, so this is a known approximation
  rather than a bug — and §5's reason for the column (a ride at 9pm Sunday
  must not land in the wrong week) is about local-week correctness, which
  the naive `Date` already satisfies for the home timezone.
- A row with a blank `Time` has no instant to compute. Leave
  `started_at_utc` blank rather than assuming midnight.

### `DailyHealth` history — answered (#133)

The Garmin export **does** carry daily wellness data, not only FIT files.
Coverage, 2017-05-30 to 2026-09-19:

| Metric | Where in the export | Coverage |
|---|---|---|
| steps, calories, resting HR, floors | `DI-Connect-Aggregator/UDSFile_*.json` | ~3,200 days — essentially complete from mid-2017 |
| average stress | same | ~2,270 days |
| sleep window (start / end) | `DI-Connect-Wellness/*_sleepData.json` | ~3,280 nights |
| sleep stages | same | **~320 nights**, mostly 2018 and 2020; almost none since 2021 |
| sleep score | — | **none** |
| HRV | — | **none** |

So pre-switch days get steps, calories and resting HR in full, and sleep as a
window without stages on most nights. **HRV and sleep score begin on the
switch date.** The export dates sleep by wake-up day (`calendarDate`), the
same as COROS.

Two traps for the importer:

- **The export writes missing stages as `0` seconds.** A night with a sleep
  window and `deepSleepSeconds: 0, lightSleepSeconds: 0` has no stage data,
  not zero sleep. Import those as blank — the same nullable rule as
  `Workouts!L–Q`.
- **20 and 21 Sept 2026 are in neither source.** The export ends on the 19th
  and COROS's first, partial, day is the 22nd. Those two days stay blank.

### What needs no migration

- **`sub_type`** — blank on existing rows means unspecified, which is
  accurate. §5 explicitly forbids guessing them into `mountain`.
- **`source`** — blank means manual, which those rows are.
- **Every other new `Workouts` column** — appended, blank, read as unset.
- **Hive's `completed` audit action** — historical completions carry only
  `status_changed`. `docs/data-architecture.md` §3 already records the
  one-time reconstruction as a known approximation.

---

## 16. Phasing

An epic with one issue per phase, each running through `/refine` and
`/finish` independently: **#163**. Phase 0 was #133; phase 2b was #130 and
#134. Phases 1–8 are #151–#158, and phases 9–11 are #159–#162, with the
COROS backfill (#161) and the Garmin wellness import (#160) as separate
issues. `docs/implementation-plan.md` §5–§6 has the mapping.

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Verification (§2) | Items 1–3 answered. **Item 2 gates Phase 1's token design** |
| 1 | OAuth flow + token storage in Drive | One successful authenticated read, and a rotated token surviving a second run |
| 2 | Raw ingestion to Drive | Payloads landing with hashes, no sheet writes at all |
| 2b | **Thrive Apps Script API** | Read and write actions for `Workouts`, `DailyHealth`, `DailySummary`; deployed, key issued, tests wired into CI. **Blocks Phase 3** — see §4 |
| 3 | Sheet schema + normalization + merge + rollup | `Workouts` A:Z, `DailyHealth` and `DailySummary` (A:R) live; a week of real activities correctly typed, timed and measured; §8 merge preserves a deliberate edit; `DailySummary` rebuilds idempotently |
| 4 | FIT fetch with budget counter | FITs landing in Drive, cap respected, backlog logged |
| 5 | Strength enrichment (§7) | A real lift session enriched, a deliberate non-match logged rather than duplicated |
| 6 | Actions cron + `SyncLog` + dead-man | Runs unattended 7 consecutive days; Settings shows last-sync age |
| 7 | UI: `run` type + provenance badge + demo fixtures | Badge states visible in demo mode |
| 8 | MCP server exposure | Agents can query daily health and synced activity detail |
| 9 | Garmin import | History loaded under `source = 'garmin_import'` |
| 10 | COROS historical backfill | Paced against the FIT cap, resumable, not in Actions |
| 11 | **`DailySummary` + `started_at_utc` backfill** | Rebuilt across all history *after* phases 9–10; historical health columns correctly blank, not zero — see §15 |

Phase 2b is new, and is a consequence of `docs/data-architecture.md` §6.
Nothing writes to the sheet before it exists. It is also the natural moment
to refactor `mcp-server/` into an API client, though that can trail.

Phases 2 and 3 are deliberately separate. Landing raw data reliably is a
different problem from mapping it correctly; conflating them makes both
harder to debug. Phase 3 is the largest and is the natural place to split
further if it proves unwieldy.

Phases 7 and 8 could slip after 9 without harm. Phase 6 should not — an
unattended job with no dead-man switch is the failure mode §10 exists to
prevent.

---

## 17. Open questions

Carried forward or newly raised; the ones Rev 2 asked and this revision has
already answered are not repeated.

1. **[DECIDE §5]** Admit `calories` to the sheet now for §7's benefit, or
   defer both?
2. **[DECIDE §6]** Seven-day window or ten? Ten is recommended given
   multi-day trips.
3. **[DECIDE §7]** Strength match tolerance — calibrate at Phase 3 rather
   than guessing ±30 minutes now?
4. Should a mis-detected sport type be correctable in Thrive's UI, given §8
   makes the row editable but `type` and `sub_type` drive which cardio
   fields render?
5. **[DECIDE §2]** COROS tools return prose, not structured data. Parse the
   text, or take activity numbers from the FIT file and parse text only for
   what FIT lacks (daily health has no FIT equivalent)? FIT-first is stabler
   but spends the 50-file allowance on every activity — fine at 1–2 a day.

### Settled

- **§2 — COROS API behaviour, verified in #133.** Refresh tokens rotate; the
  API exposes history from before authorization; no read limit is published
  or observed; the daily payload shape is seen; sport codes are published;
  the tier is free.
- **§4 — `sync/` writes through Thrive's Apps Script API.** A sibling
  workspace holding no row mapping of its own. *(Supersedes the earlier
  decision to import from `mcp-server/`, which assumed a row mapping would
  still live there.)*
- **§9 — Mountain Time.** Cron is `17 9 * * *`; local dates are computed in
  `America/Denver`, never from the runner's clock. Now a cross-app contract —
  `docs/data-architecture.md` §2 is the normative statement.
- **§13 — `run` cardio fields.** Outdoor `run` gets distance, ascent and HR.
  No descent. Indoor variants drop ascent entirely.

---

## Appendix: hardware

**COROS APEX 4 46mm** (purchased 19 Sept 2026). 46.2 × 46.2 × 13.7mm, 64g
with silicone band / 51g with nylon. Always-on 3rd-gen MIP display, grade-5
titanium bezel, sapphire glass. 65h All Systems GPS, 53h High GPS, 24 days
daily use. Dual-frequency GNSS, dual-range barometer, ECG, SpO2, water depth
sensor, compass. Speaker and mic.

Replacing a Garmin Vivoactive 4 (45.1 × 45.1 × 12.8mm, 50.5g, 8 days daily
use, 18h GPS).

Nothing in this plan depends on the specific model — any COROS device feeding
the same account works.
