# Journal — Product Specification

**Revision 1** — 20 September 2026
**Status:** Draft. The app does not exist and has no repository yet.
**Companions:** `docs/data-architecture.md` (the cross-app contracts this
depends on) and `docs/coros-sync-plan.md` (how the health data arrives).

This document specifies the app. The contracts it consumes live in
`data-architecture.md` and are being built into Thrive and Hive
independently — see §8 for what those apps owe this one.

*(The app is referred to as "the Journal" throughout. It has no name yet.)*

---

## 1. What it is

**A morning driver, not a retrospective log.**

Revision 1 of `data-architecture.md` assumed a journal was something you
scroll backwards through — a record of days that already happened. That was
wrong, or at least half right. The primary use is opening it in the morning
to see the day ahead: what is scheduled, what is due, what the night's sleep
looked like. Looking backwards is the secondary mode.

This distinction drives almost everything below, because **the data that
answers "what is today" is not the data that answers "what was the 12th."**
`DailySummary` is a completed-day rollup and answers only the second.

### Non-goals

- **Not a second Thrive or Hive.** It surfaces and links; it does not
  reimplement either app's workflows.
- **Not an analysis tool.** Pattern-finding over this data is an agent's
  job, reading the same sheets.
- **Not a Forage client**, yet. Forage is unbuilt; §7 names where it attaches.

---

## 2. The three day states

A date is past, today, or future, and the page means something different in
each. This is one screen with three states, not three screens — but building
only the "today" state and bolting the others on afterwards will not work,
because the panels' content changes kind, not just value.

| Panel | Past day | Today | Future day |
|---|---|---|---|
| **Thrive** | What was done — activities, distance, effort | What is scheduled, plus what has been done so far | What is scheduled |
| **Hive** | What was completed that day | Due today, due soon, overdue | Due that day |
| **Notes** | The entry, editable | The entry, editable | Usually empty; editable |
| **Health** | That day's metrics | Last night's sleep, resting HR, HRV | Nothing yet |

The **Hive** row is the one that changes most sharply: a past day asks "what
did I finish," which is an event-log question (`getAuditLog`), while today
asks "what is outstanding," which is a due-date question (`getItems`). Two
different queries against two different fields, sharing a panel.

---

## 3. Thrive panel

### Today and future

- **Scheduled workout** for the date, if one exists. Thrive already models
  this as `Workouts.status = 'planned'`.
- **Tapping it opens Thrive at that workout in edit mode**, where it can be
  rescheduled or deleted. The Journal does not do either itself — see §5.
- **No scheduled workout** → an action that launches Thrive to create one.
  The Journal does not build workouts.

### Past

- The day's completed activities: type, sub_type, distance, moving time,
  effort.
- Tapping one opens it in Thrive.

### Reading

The day rollup comes from `DailySummary` (one row, fifteen cells). Individual
activities come from the `Workouts` read, both through Thrive's Apps Script
API. Scheduled workouts are `status = 'planned'` rows for the date.

**Gap:** `DailySummary` is computed nightly from completed activities. It
does not carry scheduled work, so the "today" state cannot be served from it
alone and needs a separate planned-workout query. This is the Journal's only
genuinely new read requirement in Thrive. See §8.

---

## 4. Hive panel

### Today

Three groups, in this order:

1. **Overdue** — `due_date` before today, not in a terminal status.
2. **Due today** — `due_date` equals today.
3. **Due soon** — a short forward window. **[DECIDE]** — three days, seven,
   or configurable.

### Past

What was completed that day, from the `Audit Log` via the new `getAuditLog`
action, filtered on the `completed` action. `data-architecture.md` §3 covers
why this reads the event log rather than `completed_at`.

### Links

Every item links into Hive, opening that item directly with its full detail.

**This does not work today.** Hive puts board and view in the URL
(`initActiveBoardFromUrl`, `initActiveViewFromUrl`) but `selectedItemId` is a
plain signal with no URL binding. Deep-linking to an item is new work in
Hive — see §8.

---

## 5. Writes

**The Journal writes its own notes, and nothing else.**
`data-architecture.md` §10 stands unchanged.

Rescheduling a workout, deleting one, completing a task, fixing a wrong
sport type — all of it happens in the app that owns the data, reached by a
link. The Journal's job is to show you the day and get you to the right
place; it is not a second editor.

**Deep-linking is what makes this work rather than merely safe.** Thrive's
`#/history/:id/edit` route already opens a planned workout in the planner UI
(`workout-edit.tsx` branches on `isPlanned`), so "reschedule this" is one tap
into an editor that already exists and already enforces Thrive's rules. No
API write action, no row mapping in the Journal, no interaction with the sync
plan's §8 merge, and no second implementation of anything.

The same holds for Hive, whose writes carry business rules, cascading child
updates and audit entries that live in Apps Script precisely so that clients
do not reimplement them.

This is the cheaper design as well as the more conservative one: every write
capability the Journal *doesn't* have is one it doesn't have to build, test,
or keep in step.

---

## 6. Notes panel

Free text, plus a small structured set. This reverses
`data-architecture.md` §7's free-text-only decision, taken before the
morning-driver framing existed.

| Field | Type | Values |
|---|---|---|
| `notes` | Free text | |
| `sleep_hours` | Number | Self-reported. Coexists with the watch figure — see below |
| `sleep_quality` | 3-level | `Poor` / `OK` / `Good` |
| `energy` | 3-level | `Low` / `OK` / `High` |

**Three named levels, matching Thrive's `Effort` in shape but not in
wording.** Effort is `Easy`/`Medium`/`Hard`, which reads correctly for a
workout and not at all for sleep — "hard sleep" means nothing. The useful
property being copied is three named steps rather than a numeric scale:
faster to enter daily, and self-reported middle values on a 1–5 or 1–10
scale blur together anyway.

All fields nullable. A blank field means nobody said, and must never render
or store as a zero or a middle value — the same discipline CLAUDE.md applies
to `Workouts!L–Q`. A day you did not fill in is not an `OK` day.

### The sleep conflict

`sleep_hours` overlaps `DailyHealth.sleep_total_s`, which already arrives
from COROS. These are **different measurements**, and neither is wrong:

- The watch measures sleep, but only when worn, and reports its own idea of
  what counted as sleep.
- A self-report is always available and is usually time in bed.

**Decided: store both, separately, and never let one overwrite the other.**

- `DailyHealth.sleep_total_s` — what the watch measured, owned by the sync.
- `sleep_hours` — what you reported, owned by the Journal, in its own sheet.

Display the watch figure when present, with the self-report as fallback on
nights the watch has nothing and as an override when you disagree with it.

Collapsing them into one number would lose the ability to ask why they
disagree, and that disagreement is plausibly the more interesting signal — a
night the watch scored well and you remember badly is exactly the kind of
thing this system exists to surface.

Note that `sleep_quality` may end up partially double-sourced too: COROS
EvoLab produces a sleep score, and whether it appears in the daily payload
is **[VERIFY]**. If it does, the same rule applies — separate fields, no
overwriting.

### Where it lives

The Journal's own Google Sheet, written directly — `data-architecture.md`
§7. One row per day, keyed on the local calendar date in `America/Denver`.

---

## 7. Where Forage attaches

Not now. When it exists, it adds a fourth panel on the same contract: a
per-day summary keyed on the Denver-local date, read through whatever seam
Forage exposes. Nothing in this specification needs to change to admit it,
which is the point of §2's panel structure.

---

## 8. What the other apps owe this one

The Journal cannot be built until these exist. **All of it is work in Thrive
and Hive, not here** — which is the main reason this specification is
separate.

### Thrive

| Needs | Status |
|---|---|
| Apps Script API | Planned — sync plan Phase 2b |
| `DailySummary` tab | Planned — sync plan Phase 3 |
| `DailyHealth` tab | Planned — sync plan Phase 3 |
| COROS sync running | Planned — sync plan Phases 1–6 |
| `sub_type` on activities | Planned — sync plan §5 |
| **Query planned workouts by date, via API** | **New** — needed to *display* the scheduled workout |
| Deep link to an activity | **Already works** — `#/history/:id` |
| Deep link to a planned workout's editor | **Already works** — `#/history/:id/edit` handles `status = 'planned'` |

### Hive

| Needs | Status |
|---|---|
| `getAuditLog` action | **New** — `data-architecture.md` §3 |
| Explicit `completed` audit action | **New** — same |
| Denver-local date filtering | **New** — same |
| Due-date range queries | **Already works** — `getItems` filters `due_after` / `due_before` server-side |
| **Deep link to an item** | **New** — board and view are URL-bound, `selectedItemId` is not |

### Sequencing

Thrive's API (Phase 2b) gates everything on the Thrive side. Hive's work is
independent of it and can proceed in parallel — it is four small additions to
an existing deployment, none of which changes Hive's write path.

---

## 9. Open questions

1. **[VERIFY §6]** Does COROS's daily payload carry a sleep score? If so,
   `sleep_quality` is double-sourced and follows the same store-both rule.
2. **[DECIDE §4]** "Due soon" window — three days, seven, or configurable?
3. **[DECIDE §2]** Does the Journal show a week view, or only single days?
   The original framing said "my day, week, etc." and this specification
   currently describes only days.
4. What is the app called, and does it get its own repository?
