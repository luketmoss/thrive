# Implementation Plan — Thrive & Hive

**Revision 1** — 20 September 2026
**Scope:** The work in **Thrive** and **Hive** only. The Journal app is
specified in `docs/journal-spec.md` and is being built elsewhere; this plan
covers what the existing apps owe it, not the app itself.

**Design references** — this document sequences, it does not re-argue:
`docs/coros-sync-plan.md` (COROS → Thrive), `docs/data-architecture.md`
(cross-app contracts), `docs/journal-spec.md` (what the Journal consumes).

---

## 0. Issues

Created 20 September 2026. Thrive items are sub-issues of the epic; Hive's
are standalone and cross-referenced, since sub-issue links do not span the
two boards cleanly.

| Item | Issue | Depends on |
|---|---|---|
| Epic | [thrive#127](https://github.com/luketmoss/thrive/issues/127) | — |
| B1 + B5 — `Workouts` A:Z, `started_at_utc` backfill | [thrive#128](https://github.com/luketmoss/thrive/issues/128) | — |
| B2 — activity taxonomy | [thrive#129](https://github.com/luketmoss/thrive/issues/129) | #128 |
| B3a — Apps Script API: scaffold + `Workouts` | [thrive#130](https://github.com/luketmoss/thrive/issues/130) | #128 |
| B3b — API actions: Exercises, Templates, Sets | [thrive#134](https://github.com/luketmoss/thrive/issues/134) | #130 |
| *(Labels needs no API — `domain.js` has none and no tool touches it)* | — | — |
| B4 — `DailySummary` | [thrive#131](https://github.com/luketmoss/thrive/issues/131) | #128, #130 |
| B6 — MCP server → API client | [thrive#132](https://github.com/luketmoss/thrive/issues/132) | #130, #134 |
| A — COROS verification spike | [thrive#133](https://github.com/luketmoss/thrive/issues/133) | — |
| C1–C3 — Hive audit log read path | [hive#239](https://github.com/luketmoss/hive/issues/239) | — |
| C4 — Hive item deep links | [hive#240](https://github.com/luketmoss/hive/issues/240) | — |

**Not on the project boards.** This environment has no `gh` CLI, and both
repos' board tooling shells out to it (`.thrive/board.mjs` uses
`execFileSync('gh', …)`; Hive's convention is `gh api graphql`). Placement
needs `node .thrive/board.mjs` run locally, or the project's auto-add
workflow.

Track D (the sync phases) is deliberately not broken out — those phases
depend on answers from #133, and specifying them now would be guesswork.

---

## 1. The shape of it

Four tracks. **Three of them start immediately and in parallel**, because
only one depends on COROS, and COROS is not set up yet.

```
  A. COROS verification  ──────────────┐
     (no code; answers 6 questions)    │
                                       ▼
  B. Thrive foundation ──────────────► D. COROS sync ──► E. History
     (no COROS dependency)                                  backfill
  C. Hive additions
     (no dependency on anything)
```

The instinct is to treat this as one linear march from COROS outwards. That
would be wrong and slow: **most of Track B improves Thrive on its own
merits**, needs no watch, and can be built and tested against the workout
history that already exists. `DailySummary` in particular aggregates data you
already have.

Track A is not code. It is registering an OAuth app, making a handful of
calls, and writing down what comes back. It gates Track D and nothing else,
so it should run alongside B and C rather than ahead of them.

---

## 2. Track A — COROS verification

**Blocks:** Track D entirely, Track E's COROS half.
**Blocked by:** nothing.
**Shape:** one focused session, not a project. No production code.

Nothing is set up today — the watch is bought, no OAuth app is registered.

| # | Question | Why it blocks | Ref |
|---|---|---|---|
| A1 | Do refresh tokens rotate on use? | **Decides Phase 1's design**, not just alerting. Rotation means the token cannot live in an Actions secret | sync §2.2 |
| A2 | Are pre-authorization activities exposed? | Decides whether COROS history is an API walk or a bulk export | sync §2.1 |
| A3 | General read rate limits | The 50/day FIT cap is known; ordinary reads are not | sync §2.3 |
| A4 | Sport type codes — do they distinguish indoor/outdoor? | Decides whether venue derivation is a lookup or falls back to GPS presence | arch §4 |
| A5 | Daily payload shape — which sleep fields, is there a sleep score? | `DailyHealth` columns are provisional until seen; a sleep score makes `sleep_quality` double-sourced | sync §2.4, journal §6 |
| A6 | Does the Garmin export carry daily wellness data, or only FIT? | Decides whether pre-switch days can show health at all | sync §15 |

A6 is answered by the export itself, which is already requested. A1–A5 need
an authorized API session.

**Deliverable:** the `[VERIFY]` markers in the three design documents
replaced with answers. Nothing else.

---

## 3. Track B — Thrive foundation

**Blocks:** Track D, and the Journal.
**Blocked by:** nothing.

Ordered by dependency. B1 unblocks everything else.

### B1 — Extend `Workouts` to A:Z
Add `sub_type` (R) and the sync-owned columns S–Z. Purely additive: existing
rows read blank, and blank is meaningful for every one of them.

Touches `frontend/src/api/workouts-api.ts` and `mcp-server/domain.js`
together per CLAUDE.md, plus `row-shape.test.ts`.

*Ships nothing visible. Everything else depends on it.*

### B2 — Activity taxonomy
`WorkoutType` gains `run` and `walk`. A `sub_type` control appears for bike,
run and walk. `hasCardioFields()` and `showDescent` become `(type, sub_type)`
functions, so Ascent disappears for indoor activities.

**User-visible.** The type selector and Activities filters grow; logging a
ride gains a terrain choice.

*Depends on B1. Independent of everything else — could ship first if the
logging improvement is wanted sooner.*

### B3 — Thrive Apps Script API
**Split during refinement into #130 and #134.** Sizing it against Hive — 955
lines and 13 actions for their whole API, against Thrive's 16 MCP tools and
~1,700 lines of `domain.js` + `index.js` — made one issue materially larger
than the thing it copies, on the critical path, as a refactor of code in
daily use.

The split is by **consumer**, not read/write: a read/write split cuts across
every consumer, since the Journal needs reads and the sync needs writes on
the same tab.

- **#130** — scaffold, auth, envelope, deployment, CI, plus `Workouts` and
  planned-by-date. Unblocks #131 and the Journal. Medium.
- **#134** — `Exercises`, `Templates`, `Sets`. Consumed only by #132.

Refining #134 sharpened the boundary into a principle worth recording:
**the API accepts domain objects, never sheet rows or row indices.** Row
mapping *and row resolution* (`findSetSlots`, `resolveSetTarget`,
`planSetUpdates`) move server-side; narration (`describeSlots`,
`describeSetState`, `describeLoad`) stays in `mcp-server/`, since formatting
tool output for an agent is not a data concern. Had the API exposed
row-index CRUD instead, `mcp-server/` would still need the sheet shape to
call it and the mirror would have survived the refactor intact.

The gate for the Journal. Hive's `apps-script/` is a working
template: `doGet()` with a `payload` param, API key auth, business rules and
validation server-side.

Read and write actions covering `Workouts`, `DailyHealth`, `DailySummary`,
plus the planned-workout query the Journal needs. Tests wired into CI as a
third job — unfiltered, like the existing two, because `/ship` refuses to
merge a PR whose checks are absent.

*Depends on B1 (needs the final column shape). Large enough to split if the
read and write halves want separating.*

### B4 — `DailySummary` tab, rebuild, and backfill
The tab (A:O), the rebuild function, and the one-time historical backfill.

**The rebuild takes an arbitrary date range from the start**, not the sync's
rolling window — otherwise the backfill reimplements it and the two drift.

Historical rows are legitimately partial: no `DailyHealth` exists before
COROS, so health columns are blank, never zero.

*Depends on B1 and B3. Testable against existing history with no watch
involved — this is the clearest example of Track B standing on its own.*

### B5 — `started_at_utc` backfill
Derive from existing `Date` + `Time` using the `America/Denver` offset **for
that date** — DST-aware, not a fixed −6 or −7. Blank `Time` stays blank
rather than assuming midnight.

*Depends on B1. Small.*

### B6 — MCP server → API client
`mcp-server/` stops talking to Sheets and becomes a thin client of B3, as
Hive's already is. Removes one of the two row mappings.

*Depends on B3. **Real work on code that currently functions** — sequence it
deliberately and do not fold it into the COROS effort.*

---

## 4. Track C — Hive additions

**Blocks:** the Journal only.
**Blocked by:** nothing. **Fully parallel with A and B.**

Four small additions to a deployed, working Apps Script project. None
changes Hive's write path or its UI behaviour, except C4.

**Verified against `1ad93bb` (#238, 20 September 2026).** All four findings
hold at current head, along with the claims they rest on: the SPA writes 25
audit entries including `status_changed` on both the item and cascaded
children (`actions.ts:620, 625, 671, 676`), matching Apps Script's
`items.js:153, 197`, so the event stream has holes on neither path. `Items`
is unchanged at A:N with `completed_at` at index 10.

Worth noting for the Journal's sake: Hive moved roughly 200 commits without
`Items` changing shape once.

### C1 — `getAuditLog` action
A read action over the existing `Audit Log` tab, filtered by date range and
optionally action type. The tab is already written by both paths — Apps
Script via `audit.js` and the SPA via `appendAuditEntry` — so the event
stream has no holes.

### C2 — Explicit `completed` / `reopened` audit actions
When `applyStatusSideEffects` sees `isTerminal`, write an audit row with
action `completed` alongside the existing `status_changed`.

Without this, a consumer must infer completion by checking a historical
status *name* against today's terminal set — and `is_terminal` is a mutable
per-board flag, so re-flagging a column silently rewrites history.

Mirrored in `apps-script/src/rules.js` and `frontend/src/state/rules.ts`, per
Hive's own CLAUDE.md.

### C3 — Denver-local date filtering
`appendAuditEntry` stamps `new Date().toISOString()` — UTC. Filtering must
convert to `America/Denver` before taking a date, or everything completed
after 18:00 MDT lands on the following day.

### C4 — Item-level deep links
`selectedItemId` is a plain signal with no URL binding, so there is no way to
link to an item today. Board and view are already URL-bound
(`initActiveBoardFromUrl`, `initActiveViewFromUrl`) — this follows the same
pattern.

*The only Track C item with user-visible effect.*

**Not needed:** due-date range queries already work server-side in
`items.js`.

---

## 5. Track D — COROS sync

**Blocked by:** Track A (all of it) and Track B (B1, B3).

Follows `coros-sync-plan.md` §16 phases 1–6. Not re-specified here; the
sequencing note is that **D1's design depends on A1** and must not start
before it is answered.

| # | Phase | Gate |
|---|---|---|
| D1 | OAuth + token storage in Drive | **A1** — rotation decides where the token lives |
| D2 | Raw ingestion to Drive | |
| D3 | Normalization + `DailyHealth` | **A4, A5** — sport codes and payload shape |
| D4 | FIT fetch with budget counter | **A3** |
| D5 | Strength enrichment | |
| D6 | Actions cron + `SyncLog` + dead-man | |
| D7 | Thrive sync UI — provenance badge, last-synced line, demo fixtures | **User-visible** |

---

## 6. Track E — History

**Blocked by:** Track D.

| # | Work | Gate |
|---|---|---|
| E1 | Garmin FIT import under `source='garmin_import'` | Export arrival |
| E2 | Garmin daily wellness import | **A6** — may not exist |
| E3 | COROS historical backfill | **A2** — API walk or bulk export |
| E4 | **Re-run `DailySummary` backfill** | E1–E3 |

**E4 is not optional and is easy to forget.** Any rollup built before the
historical imports land is missing them. This is why B4's rebuild takes a
date range.

---

## 7. Where to start

Three things can begin at once, by different efforts:

1. **B1** — unblocks all other Thrive work and ships nothing, so it wants to
   be first and quick.
2. **Track C** — entirely independent, four small changes, and it is in a
   different repository so it does not contend with Thrive work at all.
3. **Track A** — a session with the COROS API, no code.

**B2 is the first thing that improves the app**, and depends only on B1. If
early visible progress matters, that is the route.

**B3 is the critical path** for both the Journal and the sync. Nothing on
the Thrive side that writes reaches production before it.

---

## 8. Risks

- **B3 and B6 are a refactor of working code.** The API is not additive the
  way the schema work is. This is the largest single risk in the plan and
  the one most likely to be underestimated.
- **Track A may invalidate design decisions**, not merely fill blanks. A1 in
  particular could change where credentials live.
- **Track C spans two repositories**, and Hive has its own board and its own
  agent workflow. It needs its own issues, and this session has read-only
  access to that repository.
- **COROS is a single point of failure** for ongoing collection, and its
  server availability is documented as unreliable (`coros-sync-plan.md` §2).
  The Drive archive is the hedge, which is why D2 precedes D3.
- **The Journal is being built in parallel against contracts that do not
  exist yet.** B3, B4 and Track C are its prerequisites. If it moves faster
  than this plan, it will be blocked.
