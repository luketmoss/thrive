# COROS → Thrive Activity Sync — Implementation Plan

**Revision 3** — 19 September 2026
**Status:** Draft for review. Supersedes Rev 2 in full; do not work from Rev 2.
**Purpose:** Replace Garmin as the system of record for *recorded activities*
and *daily health summaries*, pulling both from COROS into Thrive
automatically so all training data lives in one analyzable place.

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
  second-by-second data. **Capped at 50 file requests per calendar day.**
- **No COROS subscription exists.** No fee is documented for the
  self-service tier, and the company's positioning is explicitly
  no-subscription. Soft caveat below.

### Remaining [VERIFY] items

1. **Historical backfill.** Does the API expose activities recorded *before*
   OAuth authorization? Polar's AccessLink is new-data-only; unknown for
   COROS. **This gates §11.**
2. **Token lifetime and refresh semantics.** Specifically whether refresh
   tokens rotate on use, and whether an absolute expiry forces periodic
   manual re-authorization. **This now gates a Phase 1 design choice, not
   just alerting volume — see §4's note on token storage.** Answer it first.
3. **General rate limits.** The 50/day FIT cap is confirmed; the limit on
   ordinary read calls is not. A 7-day lookback is low-volume, so this is
   unlikely to bite in steady state — confirm before the §11 backfill.
4. **Daily health payload shape.** Which sleep fields actually come back
   (total / deep / REM / light / awake), and whether steps and HRV arrive on
   the same call. §5's `DailyHealth` columns are provisional until this is
   seen. Cheap to answer once Phase 1 lands.
5. **Sport type vocabulary.** The full set of COROS sport type codes, so
   §6's normalization table is exhaustive rather than guessed.
6. **[Soft] Cost.** No pricing is published and no application gate exists to
   charge at. Absence of a price is not a contractual guarantee. Low risk,
   worth a glance at terms.

### Reliability note

A reviewer testing the MCP in May 2026 got "COROS API is temporarily
unavailable" from **every** endpoint across activities, daily health and
heart rate — authorization succeeded, tools loaded, queries all failed.
Treat server availability as genuinely unreliable rather than assumed. This
raises §10's retry logic and dead-man's switch from good-practice to
load-bearing.

---

## 3. Endpoint inventory

Fifteen endpoints across five groups. Not all are needed for v1.

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

`mcp-server/` already contains both halves of what the sync needs:
`sheets.js` (service-account REST wrapper) and `domain.js` (row mapping,
which CLAUDE.md requires be kept in step with `frontend/src/api/*.ts`). A
top-level `sync/` workspace that copied either one would create a **third**
mirror of the row mapping, and the two-mirror rule is already a standing tax.

**Decided: `sync/` is a sibling workspace that imports from `mcp-server/`.**
It does not duplicate `sheets.js` or `domain.js`. Anything the two come to
share moves *down* into `mcp-server/` as the common module rather than being
copied sideways. Two mirrors stay two.

Making the sync a subcommand of `mcp-server` was the alternative; it keeps
the dependency graph trivial but muddies what that package is for — an MCP
server for agents is a different thing from a nightly ETL job.

Practical consequences, none of them blocking but all of them real:

- **`mcp-server/` becomes a library as well as a binary.** Its `package.json`
  has a single `main`; the modules `sync/` imports become a de facto public
  surface. Adding an explicit `exports` map is the cheap way to say which
  modules those are, so a future refactor inside `mcp-server` doesn't break
  `sync/` silently.
- **CI needs a third job.** `.github/workflows/ci.yml` runs `frontend` and
  `mcp-server` and is deliberately not path-filtered, because `/ship`
  refuses to merge a PR whose checks are absent. A `sync` job follows the
  same pattern for the same reason.
- **A change inside `mcp-server/domain.js` can now break `sync/`.** That is
  the price of not having a third mirror, and it is the right trade — a
  break surfaces as a failing test rather than as data drifting apart
  silently, which is what the mirror rule exists to prevent.

### Token storage — a Phase 1 fork

If COROS refresh tokens **rotate on use** (§2 [VERIFY] item 2), GitHub Actions
secrets are the wrong home for the refresh token: a workflow cannot write
back to its own repo secrets without a PAT carrying `secrets:write` plus
libsodium encryption of the new value. That is unpleasant enough to design
around rather than discover at Phase 5.

**Recommended:** keep the rotating refresh token in a **single-purpose Drive
file** the service account already owns and can rewrite freely. The static
client ID and client secret stay as ordinary GitHub Actions secrets, since
they never change.

Verify item 2 before building Phase 1, not after.

### FIT file strategy

FIT retrieval is capped at 50 requests per calendar day.

**Decided: fetch-on-ingest.** Normal volume is 1–2 activities/day, so the cap
is irrelevant in steady state; only the §11 backfill needs pacing.
Fetch-on-demand was the alternative and is rejected — it introduces a latency
and a failure path into analysis, in exchange for storage that is free here.

Either way, **track a daily FIT request counter** and have the job stop
cleanly at the cap rather than erroring through it.

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
| A | `date` | PK, local calendar date |
| B | `resting_hr` | |
| C | `hrv` | |
| D | `steps` | |
| E | `calories` | |
| F–J | `sleep_*` | total / deep / REM / light / awake, in **seconds**. **[VERIFY]** — provisional until the payload is seen |
| K | `vo2max` | EvoLab |
| L | `recovery` | EvoLab |
| M | `training_load` | EvoLab |
| N | `raw_ref` | Drive file ID |
| O | `synced_at` | |

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
    fit_budget = 50

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
    for day in window_start..today_local:
        upsert DailyHealth from mcp.get_daily_data(day)
                              + mcp.get_evolab(day)

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

- **Run at ~03:00 local.** Late enough that the previous day is complete,
  early enough to be fresh by morning.
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

**The Connect account data export has been requested.** It returns FIT files.
Write an importer targeting `source = 'garmin_import'`, reusing the same
normalization and the same Drive storage layout. Garmin-sourced rows are
`synced` for badge purposes but are never re-fetched — there is nothing to
re-fetch from.

### COROS history

Depends on §2 [VERIFY] item 1. If the API exposes pre-authorization
activities, walk backward in date windows. If not, request a bulk export.

Either way, **pace FIT retrieval against the 50/day cap.** A backfill of
several hundred activities is a multi-day job by design. Build it as a
resumable queue, not a single long-running script — and not as a GitHub
Actions job, which has a 6-hour ceiling per run.

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

What this touches beyond new code:

- **`WorkoutType` gains `run` and `walk`** — six non-test sites, plus tests.
- **`hasCardioFields()` and `showDescent` become `(type, sub_type)`
  functions.** Today `cardio-fields.tsx` decides from `type` alone
  (`type === 'bike' || type === 'hike'`). An indoor activity has no
  meaningful ascent — a trainer or treadmill reports none — and rendering an
  empty Ascent field invites the `0` that CLAUDE.md's nullable discipline
  exists to prevent. Outdoor `run` gets distance, ascent and HR; never
  descent.
- **`Workouts` grows to A:Z, not A:Y** — `sub_type` at R shifts every
  sync-owned column one letter right.
- **`Workouts` grows from A:Q to A:Y** — every range literal in
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

## 15. Phasing

Intended to become an epic with one issue per phase, each running through
`/refine` and `/finish` independently.

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Verification (§2) | Items 1–3 answered. **Item 2 gates Phase 1's token design** |
| 1 | OAuth flow + token storage in Drive | One successful authenticated read, and a rotated token surviving a second run |
| 2 | Raw ingestion to Drive | Payloads landing with hashes, no sheet writes at all |
| 3 | Sheet schema + normalization + merge + rollup | `Workouts` A:Z, `DailyHealth` and `DailySummary` live; a week of real activities correctly typed, timed and measured; §8 merge preserves a deliberate edit; `DailySummary` rebuilds idempotently |
| 4 | FIT fetch with budget counter | FITs landing in Drive, cap respected, backlog logged |
| 5 | Strength enrichment (§7) | A real lift session enriched, a deliberate non-match logged rather than duplicated |
| 6 | Actions cron + `SyncLog` + dead-man | Runs unattended 7 consecutive days; Settings shows last-sync age |
| 7 | UI: `run` type + provenance badge + demo fixtures | Badge states visible in demo mode |
| 8 | MCP server exposure | Agents can query daily health and synced activity detail |
| 9 | Garmin import | History loaded under `source = 'garmin_import'` |
| 10 | COROS historical backfill | Paced against the FIT cap, resumable, not in Actions |

Phases 2 and 3 are deliberately separate. Landing raw data reliably is a
different problem from mapping it correctly; conflating them makes both
harder to debug. Phase 3 is the largest and is the natural place to split
further if it proves unwieldy.

Phases 7 and 8 could slip after 9 without harm. Phase 6 should not — an
unattended job with no dead-man switch is the failure mode §10 exists to
prevent.

---

## 16. Open questions

Carried forward or newly raised; the ones Rev 2 asked and this revision has
already answered are not repeated.

1. **[DECIDE §5]** Admit `calories` to the sheet now for §7's benefit, or
   defer both?
2. **[DECIDE §6]** Seven-day window or ten? Ten is recommended given
   multi-day trips.
3. **[DECIDE §7]** Strength match tolerance — calibrate at Phase 3 rather
   than guessing ±30 minutes now?
4. **[VERIFY §2.2]** Token rotation — answer before Phase 1.
5. **[VERIFY §2.4]** Daily health payload shape — `DailyHealth`'s columns are
   provisional until seen.
6. **[VERIFY §2.5]** COROS sport type codes — needed for an exhaustive
   normalization table.
7. Should a mis-detected sport type be correctable in Thrive's UI, given §8
   makes the row editable but `type` and `sub_type` drive which cardio
   fields render?

### Settled

- **§4 — `sync/` imports from `mcp-server/`.** A sibling workspace, not a
  subcommand, and not a third copy of the row mapping.
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
