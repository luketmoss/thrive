# Cross-App Data Architecture — Thrive, Hive, Journal

**Revision 1** — 20 September 2026
**Status:** Draft for review.
**Scope:** The contracts that let a journaling app present one day's data
drawn from Thrive, Hive, and its own notes. Forage is named where it would
attach, and otherwise out of scope. Goals are deferred entirely — §8 records
why, including the target Thrive already removed once.

Companion to `docs/coros-sync-plan.md`, which covers getting COROS data
*into* Thrive. This document covers getting data *out* of several systems
and onto one page. Where the two disagree, this one is newer — §9 lists the
amendments it forces on the sync plan.

`docs/implementation-plan.md` sequences the Thrive and Hive work these
contracts require.

`docs/journal-spec.md` specifies the Journal app itself. **This document
holds the contracts; that one holds the product.** Where they overlap, the
spec is newer and says so explicitly.

### A note on scope

These are mostly contracts, but **§4 changes what Thrive looks like.** New
activity types appear in the selector and filters, a `sub_type` control is
added, and cardio fields start appearing and disappearing by venue.
`coros-sync-plan.md` §13 lists the rest of the user-visible surface — a
provenance badge on activity cards and a last-synced line in Settings.

Everything else here — the join key, the audit-log read, `DailySummary`, the
Apps Script API — is invisible to anyone using the existing apps.

### Why all three live in `thrive/docs`

These documents impose work on Hive and on an unbuilt Journal app, so
Thrive's repository is not an obviously neutral home. It is nonetheless the
right one for now:

- Thrive holds the large majority of the work described here.
- The three documents cross-reference each other constantly, and relative
  links inside one repository beat cross-repo links that rot.
- Thrive is public; keeping them together means they stay readable together.

The neutrality problem is real but small, and is better fixed with a pointer
from Hive's README to this document than by moving the document somewhere
neither app owns. **Revisit when the Journal repository exists** — that is
when `journal-spec.md` has an obviously better home, and when the question
becomes concrete rather than hypothetical.

---

## 1. The systems

| System | Repo | Storage | Grain | Read path today |
|---|---|---|---|---|
| **Thrive** | `luketmoss/thrive` | Google Sheet "Groundwork" | One row per workout; one row per set | Browser OAuth (SPA), service account (MCP server) |
| **Hive** | `luketmoss/hive` | Google Sheet "Hive Board" | One row per item | Browser OAuth (SPA), **Apps Script API with API key** |
| **Journal** | *not started* | — | One row per day | — |
| **Forage** | `luketmoss/forage` | *incomplete* | Presumably per meal | — |

Thrive and Hive are the same architecture — Preact SPA, `@preact/signals`,
direct `fetch()` to the Sheets REST API, GitHub Pages, demo mode, the same
board workflow. The Journal should be the third instance of that pattern,
not a new one.

**Separate spreadsheets, and they should stay separate.** Each app owns its
data. The Journal reads across them; it does not consolidate them.

### The asymmetry that matters

Hive has an **Apps Script API** (`doGet()` with a `payload` query param, API
key auth) that enforces business rules and writes an audit log. **Hive's MCP
server is a client of it** — `mcp-server/index.js` calls it over
`HIVE_API_URL` + `HIVE_API_KEY` rather than touching Sheets directly. So the
API is live and proven in daily use.

Thrive has no equivalent. Its MCP server talks to Sheets directly with a
service account, which means Thrive's business rules live in whichever
client is running. The two projects have diverged on this, and the Journal
is the first thing that makes the divergence cost something.

*(A ChatGPT custom GPT is also documented against Hive's API in
`chatgpt-gpt-setup.md`, but it is unused — MCP from Claude is the live
consumer.)*

So a Journal built today would call an API for Hive and hand-roll Sheets
reads for Thrive. That asymmetry drives §6.

---

## 2. The join key, and the bug in it

The Journal's entire premise is "show me this day." Every system must agree
on what a day is. **They currently do not.**

| System | Field | Format | Zone |
|---|---|---|---|
| Thrive | `Workouts!B` (`date`) | `YYYY-MM-DD` | **Naive local** — `toLocalDateStr()` reads the browser's `getFullYear()`/`getMonth()`/`getDate()` |
| Thrive | `DailyHealth!A` (planned) | `YYYY-MM-DD` | America/Denver, per the sync plan §9 |
| Hive | `Items!K` (`completed_at`) | ISO 8601 | **UTC** — `new Date().toISOString()`, `Z`-suffixed |

### Worked example

Complete a Hive task at **6:30pm Mountain on 19 September**:

```
completed_at = "2026-09-20T00:30:00.000Z"
completed_at.slice(0, 10) = "2026-09-20"     ← wrong day
```

Log a Thrive workout the same evening and it stores `date = "2026-09-19"`.

The Journal page for **19 September** shows the workout and omits the task.
The page for **20 September** shows a task you completed the previous
evening. In MDT the misfiling starts at 18:00; in MST it starts at 17:00 —
so **roughly a quarter of every day lands on the wrong page**, and it is the
evening quarter, which is when tasks actually get closed.

Nothing errors. The Journal just quietly lies.

### The contract

> **The join key is the local calendar date in `America/Denver`, formatted
> `YYYY-MM-DD`.** Every system converts to that zone before taking a date.
> No consumer may slice an ISO timestamp to get a date.

`YYYY-MM-DD` is kept because Thrive already relies on it sorting lexically
(`w.date >= thisMondayStr` in `activities-helpers.ts`), which is correct and
worth preserving.

Three consequences:

- **Hive** must expose a Denver-local completion date, or every consumer
  must convert. Converting in one place beats converting in three — see
  §5.1.
- **Thrive's `toLocalDateStr()` reads the browser clock**, which is right
  today and wrong the moment a workout is logged in another timezone on a
  trip. The sync plan already requires `America/Denver` explicitly for
  server-side code; the SPA should match.
- **Forage, when it exists, inherits this contract** rather than inventing
  a third convention.

### Boundary rules

Ambiguities that need stating once rather than being decided three times:

- **An activity belongs to the day it started**, local. A ride from 23:00 to
  01:00 is Sunday's ride, not Monday's.
- **Sleep belongs to the wake day.** Sleep from Sunday 23:00 to Monday 07:00
  is Monday's sleep, because that is the morning it governs. COROS will have
  its own opinion in the payload; normalize to this one. **[VERIFY]**
- **A Hive item belongs to the day it was completed**, not created or due.
- **Daily health metrics belong to their own calendar day**, already.

---

## 3. Gap: Hive completion history is erasable

`applyStatusSideEffects` in `apps-script/src/rules.js` (mirrored in
`frontend/src/state/rules.ts`) sets `completed_at` on entering a terminal
status **and clears it on leaving one**:

```js
if (isTerminal) {
  updated.completed_at = isoNow();
} else if (item.completed_at) {
  updated.completed_at = '';        // ← history erased
}
```

That is correct for a kanban board, where `completed_at` means "is currently
done." It is wrong for a journal, where the question is "what did I finish
on the 12th" — a question whose answer must not change in October.

Reopen a task and it silently disappears from a past day's page. Worse, it
disappears from the historical record the pattern analysis runs on.

**The durable record already exists:** the `Audit Log` tab
(`timestamp, item_id, action, field, old_value, new_value, actor`) captures
the transition. It is append-only and nothing clears it.

**Verified: the audit log has no holes.** Both write paths log it — the Apps
Script API via `audit.js`, and the SPA via `appendAuditEntry` in
`frontend/src/state/actions.ts`, which fires on create, on `status_changed`,
and on cascaded child updates.

**Decided: the Journal reads completions from `Audit Log`, not from `Items`.**

A journal is a record of events, and an event log is the right shape for
one. The alternative — stop clearing `completed_at` — was simpler to consume
and would have been roughly right, but it loses a completion permanently the
moment a task is reopened and finished again. Complete on the 12th, reopen on
the 15th, finish on the 20th: `completed_at` holds only the 20th, and the
12th silently empties. That is precisely the kind of retroactive change that
makes historical pattern analysis untrustworthy.

### What this requires building in Hive

Neither option was free — there is **no completion-date filter in Hive
today**, on either field. `getItems` filters `status`, `owner`, `label`,
`parent_id`, `board_id` and `roots_only`; the MCP server adds `due_after`
and `due_before`. Nothing reads `completed_at`, and there is no
`getAuditLog` action at all. The API's actions are `getItems`, `getItem`,
`getOwners`, `getLabels`, `getBoards`, `getStatuses`, plus the write and
status-management ones.

So this decision adds to Hive:

1. **A `getAuditLog` action**, filtered by date range and optionally action
   type. It reads the existing tab; nothing about the write path changes.
2. **An explicit `completed` audit action** — see below.
3. **Denver-local date filtering**, per §2. `appendAuditEntry` stamps
   `new Date().toISOString()`, so audit timestamps are UTC and carry the
   same trap as `completed_at`.

### Emit `completed`, don't infer it

Audit rows record the status *name* (`status_changed`, `Doing` → `Done`),
not whether that status was terminal at the time. `is_terminal` is a
per-board flag on the status row and `updateStatus` can change it, so a
consumer that infers "completed" by checking today's terminal set against a
historical status name **reinterprets history whenever a column is
reconfigured**. Rename or re-flag a column and last spring's journal changes.

The fix is to make the event self-describing: when `applyStatusSideEffects`
sees `isTerminal`, have Hive write an audit row with action `completed`
(and `reopened` on the way out) alongside the existing `status_changed`.
The Journal then filters on `action = 'completed'` and never needs to know
what the board looked like in April.

This is append-only and backward compatible — existing rows keep their
meaning, and the Journal's history simply starts from when the new action
ships. Pre-existing completions can be reconstructed from `status_changed`
once, against the terminal set as it stands, and that reconstruction is a
known approximation rather than a silent one.

---

## 4. Gap: the activity taxonomy does not fit a flat enum

`WorkoutType` is `weight | stretch | bike | hike`. The target list is:

Hiking · Weight Training · Biking-Mountain · Biking-Indoor · Biking-Gravel ·
Running-Indoor · Running-Outdoor · Walking-Indoor

These are not eight peer values. They are a **sport** crossed with a
**venue/terrain** modifier, and flattening them causes three problems:

1. "Total miles biked this month" becomes an OR across three enum values,
   and breaks again the day Biking-Road is added.
2. Existing `bike` and `hike` rows have no correct new value. They would
   need a guess-based migration.
3. The filter UI grows from four chips to eight, on a 375px screen.

### Decided: `type` + `sub_type`

Keep `Workouts!D` (`type`) coarse, add `sub_type` as a new column.

**The modifier dimension is expected to grow** — Biking-Road, Running-Trail
and similar variants are anticipated rather than hypothetical. That is what
makes the split worth its complexity: each new variant is a new *value* in
an existing column, touching no enum, no filter UI and no migration. A flat
enum would pay a code change for each one, and pay it forever.

| User-facing | `type` | `sub_type` | Distance | Ascent/Descent | HR |
|---|---|---|---|---|---|
| Hiking | `hike` | `''` | yes | both | yes |
| Weight Training | `weight` | `''` | — | — | enriched (§7 of sync plan) |
| Biking — Mountain | `bike` | `mountain` | yes | ascent | yes |
| Biking — Gravel | `bike` | `gravel` | yes | ascent | yes |
| Biking — Indoor | `bike` | `indoor` | device-reported | **no** | yes |
| Running — Outdoor | `run` | `outdoor` | yes | ascent | yes |
| Running — Indoor | `run` | `indoor` | device-reported | **no** | yes |
| Walking — Indoor | `walk` | `indoor` | device-reported | **no** | yes |
| Stretching | `stretch` | `''` | — | — | — |

**Existing rows need no migration.** A blank `sub_type` means unspecified,
which is exactly what a `bike` row logged last month is. Do not guess them
into `mountain` retroactively; offer a one-time reclassification in the UI if
it turns out to matter.

### How `sub_type` gets filled

The two modifiers are not equally knowable, and the sync treats them
differently.

**Venue (`indoor` / `outdoor`) is derived.** Resolve in this order:

1. COROS's sport type code, if it distinguishes them — **[VERIFY]**, and the
   cheapest signal if present.
2. Otherwise, the presence of GPS/location data in the activity detail
   payload. An indoor ride or treadmill run has no track.

Prefer a field on the *detail* payload over the FIT file. FIT retrieval is
capped at 50/day and happens after normalization in the sync plan's §6 loop,
so making venue depend on it would leave `sub_type` blank whenever the budget
is exhausted, and fill it in on a later night — a value that changes on its
own is worse than one that was never set.

**Terrain (`mountain` / `gravel`) is never derived.** It is not a
device-observable property: two rides with identical track, HR and elevation
differ only in what they were ridden on. The sync leaves it blank and the
user sets it in Thrive.

**Nothing is defaulted.** Defaulting `bike` to `mountain` because most rides
are was considered and rejected — it is the same move CLAUDE.md forbids for
`Workouts!L–Q`, where a defaulted value becomes indistinguishable from a
meant one. Blank means unspecified, and that is a legitimate permanent state.

Manual correction is safe by construction: the sync plan's §8 three-way merge
sees the field diverge from what it last wrote and stops touching it.

`type` gains `run` and `walk` — currently six non-test sites, per the sync
plan §13.

### This breaks `hasCardioFields()`

`cardio-fields.tsx` currently decides field visibility from `type` alone:

```ts
return type === 'bike' || type === 'hike';
```

Indoor activities have no meaningful ascent — a trainer or treadmill
reports none, and showing an empty Ascent field invites a `0` that the
nullable discipline in CLAUDE.md exists to prevent. Field applicability
becomes a function of `(type, sub_type)`, and `showDescent` (today
`type === 'hike'`) joins it.

---

## 5. Gap: there is no aggregate layer

The ask is "raw **and** aggregated." The sync plan produces:

- raw COROS payloads and FIT blobs (Drive)
- one row per activity (`Workouts`)
- one row per day of health metrics (`DailyHealth`)

Missing entirely: **anything per-day that spans activities**, and anything
per-week or per-month. "Miles ridden this week", "am I sleeping worse in
weeks I lift four times", and the Journal's own day header all need it.

Computing it on read is fine for one day and bad for a year — the Journal
scrolls, and Sheets reads are whole-range fetches.

### Proposed: `DailySummary`, materialized by the sync job

| Col | Field | Notes |
|---|---|---|
| A | `date` | PK, America/Denver |
| B | `activity_count` | |
| C | `activity_types` | e.g. `bike:mountain,weight` |
| D | `total_moving_s` | |
| E | `total_elapsed_s` | |
| F | `total_distance_m` | **Outdoor only** — see below |
| G | `total_ascent_m` | |
| H | `max_effort` | Hardest effort logged that day. `Easy`/`Medium`/`Hard`, or blank |
| I | `effort_counts` | e.g. `Hard:1,Medium:2`. Blank when nothing was logged |
| J | `steps` | From `DailyHealth` |
| K | `resting_hr` | |
| L | `hrv` | |
| M | `sleep_total_s` | |
| N | `training_load` | Duplicated from `DailyHealth` — see below |
| O | `computed_at` | |

**Effort (H, I) is the only subjective signal in the row**, and likely the
most predictive one for "what has negative effects" — a day's intensity
says more than its distance. Two columns rather than one because `max_effort`
alone cannot distinguish one hard session from three: a single hard set and
an all-hard workout both read `Hard`. `effort_counts` carries the volume.

Both stay blank when nothing was logged. A day with no workouts has no
effort, which is not the same as `Easy`.

**`total_distance_m` (F) excludes indoor activities.** Trainer and treadmill
distance is a different quantity from ground covered, and summing them makes
"how far did I travel this month" meaningless as a trend. The consequence
worth documenting wherever this is displayed: **F is not the sum of the day's
activity distances**, and will disagree with the drill-down on any day with
an indoor session.

**`training_load` (N) is duplicated from `DailyHealth`** — a deliberate
denormalization so the Journal's day view is one read. It cannot drift,
because the whole row is recomputed from source every night.

**`DailySummary` is derived and never authoritative.** It is rebuildable at
any time from `Workouts` + `DailyHealth`, and nothing may write to it by
hand. The sync job recomputes every date in its rolling window each night,
which makes it self-healing for free.

**That nightly window covers only recent days, so existing history has no
rows and needs a one-time backfill.** The Journal reads this tab for its day
view, so without it, scrolling back past the sync's start date shows empty
days across all pre-existing data. The rebuild must therefore take an
arbitrary date range rather than the sync's window, and must be re-run after
any historical import. `coros-sync-plan.md` §15 specifies it.

Historical rows are legitimately partial: there is no `DailyHealth` before
COROS, so the health columns are **blank** for every pre-switch day. Blank,
never zero — a day before the watch existed is not a day with no steps.

Weekly and monthly rollups are **not** materialized. They are cheap sums
over a year of `DailySummary` rows (365 rows) and materializing them adds a
staleness surface for no gain.

### The steps double-count

`DailyHealth.steps` counts every step, including those taken during a logged
**Walking — Indoor** or **Running — Indoor** activity. Presenting "8,400
steps" and "45 min treadmill walk" side by side is fine; **summing them into
a distance or calorie total is double counting.** `total_distance_m` above
therefore excludes indoor activities, and the Journal must present steps as
context, never as an addend.

---

## 6. Gap: the Journal has no read path

Neither Thrive nor the Journal has an answer to "how does a fourth app get
this data." Three options:

| Option | Good | Bad |
|---|---|---|
| **A. Journal reads all sheets directly** via OAuth | No new infrastructure; same pattern as both existing SPAs | Journal must mirror Thrive's *and* Hive's row mappings — the mirror tax goes from 2 to 4 |
| **B. Thrive gets an Apps Script API** mirroring Hive's | Symmetric; agents and future apps benefit; business rules enforced server-side; Hive's is a working template | A new deployment, a new API key, a new thing to keep in sync |
| **C. Journal reads the aggregate only** | One read per day; almost no mirroring | Drill-down into a specific activity still needs a raw read |

**Decided: Thrive gets an Apps Script API, following Hive's pattern (B).**
The day view still reads `DailySummary` (C), because one row beats a query
however it is served.

### What this does and does not fix

It is worth being precise, because Hive is the evidence and Hive did **not**
unify everything:

- **Hive's SPA still talks to Sheets directly.** `frontend/src/api/sheets.ts`
  calls `sheetsAppend('Items!A:N', …)`, and Hive's CLAUDE.md still requires
  `apps-script/src/rules.js` and `frontend/src/state/rules.ts` to be kept in
  step. Only the MCP server moved behind the API.
- So this **caps** Thrive's mirror count at two — the SPA's mapping and the
  Apps Script one — **permanently, regardless of how many consumers appear.**
  It does not reduce it to one.

That cap is the actual win. Without it, every new reader of Thrive's data
adds a mirror; with it, the Journal, a future dashboard and anything else
cost nothing. Thrive's MCP server also stops duplicating `domain.js` and
becomes a thin client, exactly as Hive's is.

Moving the SPA behind the API too is possible and is what would reach one
mirror, but it trades a direct Sheets call holding the user's own OAuth
token for an extra network hop through a script deployment. Hive judged that
trade not worth it. Nothing here needs to revisit that.

Concretely, rendering a day is:

1. **Thrive** — one `DailySummary` row for the date, via the API. One read,
   fifteen cells, no schema mirroring at all.
2. **Hive** — the existing Apps Script API, via the new `getAuditLog`
   action from §3, filtered to that Denver-local date. The transport
   already exists and is proven by the MCP server; the action does not.
3. **Journal notes** — the Journal's own sheet.
4. **Drill-down** (tapping the day's activities) — `Workouts` rows for that
   date, also via the API, so the Journal never carries Thrive's row shape.

### How the sync writes

**Decided: through the API, like every other non-browser client.** The
historical backfill paces itself against Apps Script quota the same way it
already paces against the 50/day FIT cap — it is specified as a resumable
queue rather than one long run, so the shape already fits.

Nightly volume (1–2 activities plus a 7–10 day rollup recompute) sits far
inside any quota. The backfill is the only real pressure, and the failure
mode there is a loud quota error on a resumable job, not silent divergence.

The alternative — direct service-account writes — would have reintroduced
the third row mapping this decision exists to prevent. The sync needs
service-account credentials anyway for Drive blobs and the rotating COROS
refresh token, so it ends up holding three credentials: COROS OAuth tokens
(stored in Drive), the Google service account (Drive only), and the Thrive
API key. Only the first two are secrets it manages; the API key is a static
GitHub Actions secret.

**Sequencing consequence:** the API must exist before the sync can write
anything. This moves it ahead of the sync plan's Phase 3, which is the first
phase that touches the sheet. See that document's §15.

### Knock-on effects

- **Thrive's MCP server becomes an API client.** `mcp-server/domain.js` and
  `mcp-server/sheets.js` largely dissolve into the Apps Script deployment,
  as Hive's did. This is a meaningful refactor of working code and should be
  sequenced deliberately, not bundled into the COROS work.
- **The sync plan's §4 changes.** It has `sync/` importing from
  `mcp-server/` precisely to avoid a third mapping. If `mcp-server/` no
  longer holds one, that reasoning is obsolete and the sync's write path is
  the open question above.
- **A shared types package is no longer the answer**, and the sync plan's
  standing `[DECIDE]` on it can close. The API is the seam instead.

---

## 7. Gap: journal notes have no home

Everything above is derived data. "A place for me to add additional notes
for the day" is **authored** data, and it cannot live in a derived table —
`DailySummary` is rebuilt nightly and would erase it.

**Decided: its own Google Sheet**, written directly by the Journal SPA. No
Apps Script API of its own for now — nothing else consumes Journal data yet,
and building a seam before there is anything on the other side of it is
premature. If Forage or an agent later needs journal entries, Hive's pattern
is the template and the sheet does not have to move.

This follows the principle the §6 decision made explicit:

> **Talk directly to what you own; go through an API to what you don't.**

Both existing SPAs already work this way — Hive's frontend writes `Items`
directly, while its MCP server, which owns nothing, goes through the API. The
Journal reads Thrive and Hive through their APIs and writes its own notes
directly.

Keeping it in a separate spreadsheet rather than a Groundwork tab keeps the
ownership boundary crisp, keeps the 10M-cell ceiling independent — which
matters as `DailySummary` accrues a row per day indefinitely — and means no
schema change in Thrive can reach it.

The Journal's sheet:

| Col | Field |
|---|---|
| A | `date` (PK, America/Denver) |
| B | `notes` |
| C | `created_at` |
| D | `updated_at` |

**Superseded — see `docs/journal-spec.md` §6.** The Journal now carries
`sleep_hours`, `sleep_quality` (`Poor`/`OK`/`Good`) and `energy`
(`Low`/`OK`/`High`) alongside free text.

The reversal came with the morning-driver reframing, which did not exist
when this was decided. The original reasoning — below — was about a
retrospective log nobody would reliably fill in. An app opened every morning
as the first thing you look at is a different proposition, and three taps is
a different burden from a nightly writing exercise. The concern the original
decision raised still stands as a risk to watch, not as a reason to refuse.

*Original decision, retained for the argument:*

**Free text only for v1.** No mood, energy, soreness or weight columns.

The argument for structure was that correlation needs a dependent variable
measured consistently — everything the system captures automatically is
either what the body did or what the watch inferred, and nothing records how
a day actually felt. The argument against won: a subjective field filled for
three weeks and then abandoned produces a dataset that *looks* analyzable
and is not, with gaps landing disproportionately on bad days, which is
exactly when it would matter most. Sparse subjective data biased toward good
days is worse than none.

**This defers correlation against subjective state; it does not foreclose
it.** Free text is lossier than a scale but it is not a dead end — the prose
persists and an agent can score a year of it retroactively. An unfilled
numeric column cannot be recovered that way. If a structured field is added
later, it starts collecting from that day forward and the back catalogue is
still readable by other means.

Columns are cheap to add and the day view does not change shape, so this is
a genuinely reversible decision.

---

## 8. Goals — deliberately out of scope

"Capture data that will help me achieve goals" and "create plans to achieve
goals" imply a goal entity — a target, a metric, a window, a progress
reading. Nothing in Thrive, Hive, or this document holds one, and **nothing
here will.** Goals are explicitly deferred, not forgotten.

The sequencing argument is that goals are expressed *over* `DailySummary`,
so that has to exist first. But there is stronger evidence than sequencing.

### Thrive already tried this and removed it

Commit `d7fd771` (#112, closed via #114, 11 September 2026) deleted a weekly
session target from the Activities screen. The commit message is the clearest
statement of the problem:

> The targets (3 lifts / 2 rides / 1 stretch) were hardcoded constants
> shipped as AC3 of #105, not user data. Nobody chose them, hike activities
> counted toward nothing, and #100 removed the Config sheet tab so there was
> nowhere to persist a real per-user goal. Removed rather than kept as a
> number nobody set.

Three things worth carrying forward whenever goals are revisited:

1. **A target nobody set is worse than no target.** It was removed for being
   decorative, not for being wrong.
2. **There is no configuration persistence in Thrive.** #100 removed the
   `Config` tab. Any real goal needs somewhere to live, and that place does
   not currently exist.
3. **Partial coverage is a design flaw, not a gap to fill later.** Hikes
   counting toward nothing is what made the feature feel arbitrary — and the
   activity taxonomy has since grown from four types to eight-plus under §4,
   which makes "what counts toward this goal" harder, not easier.

Anything built here later should also expect goals to be several different
shapes — accumulation ("500 miles this year"), consistency ("lift 3x a
week"), performance ("squat 275", which lives at set grain, not day grain),
and constraint ("no more than two hard days running"). A single
metric/target/deadline row handles the first two and misrepresents the other
two. That is a large enough design problem to deserve its own pass rather
than a column bolted onto something else.

---

## 9. Amendments this forces on `coros-sync-plan.md`

| Sync plan section | Change |
|---|---|
| §5 — "the sheet carries what the UI renders" | **Revise.** Written when Thrive's UI was the only consumer. The Journal and the agents are consumers too. The principle becomes: the sheet carries what *some consumer* reads; everything else stays in the Drive payload |
| §5 — `Workouts` columns | Add `sub_type`. Column letters shift; A:Y becomes A:Z |
| §5 — new tabs | Add `DailySummary` (§5 here) alongside `DailyHealth` and `SyncLog` |
| §6 — sync algorithm | Add a recompute step: after upserting activities and health for the window, rebuild `DailySummary` for every date in it |
| §9 — timezone | Already correct (`America/Denver`), and now a **cross-app** contract rather than a sync-job detail. §2 here is the normative statement |
| §13 — impact | `WorkoutType` gains `run` *and* `walk`; `hasCardioFields()` and `showDescent` become `(type, sub_type)` functions |
| §15 — phasing | `DailySummary` is part of Phase 3, not a later addition — the Journal depends on it and it is cheap once normalization exists |
| §16 — open question 7 | Answered: `run` gets cardio fields, ascent only when outdoor, never descent |

---

## 10. The Journal is read-only

**Decided: the Journal reads Thrive and Hive, and writes only its own
notes.** Corrections happen in the app that owns the data.

The temptation is real — you are looking at a day, the sport type is wrong,
and fixing it in place beats opening another app. But the cost is
disproportionate:

- `DailySummary` is derived and rebuilt nightly, so a write aimed at it
  would simply vanish. A real correction has to reach through to `Workouts`.
- That means the Journal needs write actions, the row mapping it currently
  avoids entirely, and a rule for how its edits interact with the sync
  plan's §8 three-way merge.
- Hive is worse: `Items` writes carry business rules, cascading child
  updates and audit entries, all of which live in the Apps Script layer
  precisely so that clients do not reimplement them.

Read-only also keeps a quietly valuable property: **the Journal cannot
corrupt anything.** If it is wrong, it is wrong on screen and every source
of truth is intact.

**Deep-linking is the escape hatch** if the ergonomics chafe — tapping an
activity opens it in Thrive, tapping a task opens Hive. That is navigation,
not writes: no mapping, no merge interaction, just URL plumbing in both
apps. Worth doing the moment read-only starts to feel constraining, and it
does not change any contract in this document.

---

## 11. Open questions

1. **[VERIFY §4]** Whether COROS's sport codes distinguish indoor from
   outdoor. If they do, venue derivation is a lookup; if not, it falls back
   to GPS presence in the detail payload. Either way the *rule* is settled —
   this only decides which signal it reads.
2. **[VERIFY §2]** COROS's sleep-day attribution, so the wake-day rule can be
   implemented rather than assumed.

---

## 12. Settled decisions

In the order they were taken.

- **§3 — Journal reads Hive completions from `Audit Log`.** Adds a
  `getAuditLog` action, an explicit `completed` audit action, and
  Denver-local date filtering to Hive. Verified that both Hive write paths
  already log, so the event stream is complete.
- **§4 — `type` + `sub_type` confirmed.** More venue/terrain variants are
  expected, so each one must cost a value rather than a code change.
- **§4 — `sub_type` fill rule.** Venue is derived (sport code, else GPS
  presence); terrain is never derived and stays blank until set by hand.
  Nothing is defaulted.
- **§5 — `DailySummary` columns fixed at A:O.** Carries `max_effort` and
  `effort_counts`; `total_distance_m` is outdoor-only.
- **§6 — Thrive gets an Apps Script API**, following Hive's pattern. Caps
  the mirror count at two permanently; does not reduce it to one, because
  the SPA keeps its direct Sheets path as Hive's does.
- **§6 — The sync writes through the API**, backfill paced against quota.
  The API must therefore land before the sync plan's Phase 3.
- **§7 — Journal notes are free text only** for v1. **Reversed** once the
  Journal became a morning driver — see `journal-spec.md` §6 for the fields
  and the reasoning.
- **§7 — The Journal gets its own Google Sheet**, written directly, no API
  of its own yet. Establishes the rule: talk directly to what you own, via
  an API to what you don't.
- **§10 — The Journal is read-only**, writing only its own notes. Holds
  unchanged. Deep-linking is now the *primary* mechanism rather than a
  fallback (`journal-spec.md` §5): rescheduling a workout opens Thrive's
  existing planner UI instead of reimplementing it.
