# Thrive as the Health Aggregator — Plan

**Revision 2** — 27 September 2026
**Decision:** almanac is retired. Thrive becomes the one app for health —
training, sleep, recovery and stress, body measurements, a daily note and trend
charts. The Hive panel is dropped, not moved. Forage is out of scope while it
is unfinished.

**Design references** — this plan sequences, it does not re-argue:
`luketmoss/keel` → `almanac/docs/spec.md` (revision 2) holds the product
decisions carried over, and `docs/data-architecture.md` the contracts. Where
this plan contradicts either, this plan is newer.

---

## 1. Why

Almanac was a fourth app built to read three others. Nearly everything it was
going to show already lives in Thrive's own sheet, and the one app it read
from outside Thrive — Hive — is the part being dropped. What remained was the
cost of being separate:

- **Cross-app auth.** A browser app on GitHub Pages cannot hold an API key, so
  almanac needed a Google-token path into both APIs (keel#355, thrive#144,
  hive#264). Thrive's SPA already reads its own sheet directly.
- **A third reader of the same tabs**, in a third repo, to keep in step with
  `apps-script/src/types.js` and `frontend/src/api/`.
- **Deep links between apps** for every action (thrive#143, hive#263). Inside
  Thrive they are ordinary routes.
- **A second design language** (keel#362, #363) and a second deploy.

Almanac had no code — `almanac/src/App.tsx` renders its name — so retiring it
discards specification, not software. The specification is the valuable part,
and the epics below carry its decisions over by name.

## 2. The epics

| Epic | Issue | Children | Replaces |
|---|---|---|---|
| **Journal** — a daily note, owned by Thrive | [#227](https://github.com/luketmoss/thrive/issues/227) | #233 tab, #234 API + MCP | keel#352 |
| **Day view** — one date, what was planned, done and slept | [#228](https://github.com/luketmoss/thrive/issues/228) | #235 navigation, #236 health reads, #237 screen, #238 training, #239 health + body, #240 note, #241 calendar | keel#351, #356–#358 |
| **Trends** — charts over recovery, sleep, stress, body and activity | [#229](https://github.com/luketmoss/thrive/issues/229) | #242 screen + chart, #243 recovery/sleep/fitness, #244 body/BP, #245 activity, #246 custom set | keel#359, thrive#202 |
| ~~Forage in Thrive~~ | [#230](https://github.com/luketmoss/thrive/issues/230) | — | closed: out of scope while Forage is unfinished |

Two more, under the COROS epic #163: **#231** syncs COROS's daily average
stress into `DailyHealth` (COROS sends it; nothing stores it yet), and **#232**
is the sync-on-demand spike, moved from keel#360.

Each child goes through `/refine` on its own; the epics carry the decisions.

## 3. The shape of it

```
  #227 Journal ─── #233 tab ────────────────────────────┐
                    └──────► #234 API + MCP              │
                                                          ▼
  #228 Day view ── #235 nav ──► #237 screen ──┬──► #238 Training ─┐
                  #236 reads ──────────────────┼──► #239 Health ◄──┼─► #241 Calendar
                                               └──► #240 Note ◄────┘
  #229 Trends ─── (#235 + #236) ──► #242 ──► #243–#245 ──► #246

  #231 stress ──► #239, #243
```

**Start with #233, #235 and #236 in parallel.** They share nothing. **#236 is
the seam**: the Day view and Trends both read through it, so it is built once.

**Trends can start as soon as #235 and #236 land**, and does not wait for the
Day view's panels.

## 4. What carries over from almanac, and what does not

**Carried over** (each epic names its sources):

- One date, three states — past, today, future — whose panels change in kind
- "Your range": 30-day mean ± 1 SD, shown from 14 values, coloured only in the
  unwelcome direction and always with words
- A number appears when a sync brought it — never yesterday's, never zero
- Trends: shared date axis, never two y-axes, blank days break the line, table
  view, charts that show and never conclude
- Monday–Sunday week strip; sunrise, sunset and daylight in the header

**Dropped:**

- The Hive panel and every Hive dependency
- **Every self-reported metric** — `sleep_hours`, `sleep_quality`, `energy`.
  Sleep and stress come from the watch; the journal is a note
- The Trends check-in group
- Almanac's own design language and amethyst accent — Thrive's `global.css` rules
- Cross-app auth and cross-app deep links
- The "not a journal" naming argument (spec §9.5). Inside Thrive the day's entry
  is plainly called a journal, because that is what you asked for

**Changed:**

- **Journal storage moves into Groundwork** as a `Journal` tab, reversing
  `data-architecture.md` §7's separate spreadsheet. That decision guarded a
  boundary between two apps; there is one app now.
- **Day is the landing screen**, replacing Activities, and the bottom
  navigation is redesigned with `/ux` (#235).

## 5. What stays in Thrive that was built for almanac

The upstream work is done — thrive#143–#149 and hive#263–#266 are all closed.
None of it is wasted, and none of it needs undoing now:

| Built | For almanac | Now |
|---|---|---|
| thrive#143 — planner opens for a date from a URL | "Plan" action | The Day view's "Plan" action, in-app |
| thrive#145 — estimated duration on a planned workout | Training panel | Day view's Training panel |
| thrive#147, #201 — `DailyHealth` and `BodyMeasurements` via the API | Health panels | MCP agents' read path. The SPA reads the tabs directly (#236) |
| thrive#146 — exercise and set counts on planned workouts | Training panel | MCP agents; the SPA has the rows already |
| thrive#144, hive#264 — accept a Google token for reads | Cross-app auth | **Unused.** Harmless; a candidate for removal later, not now |
| `DailySummary` append-only columns | almanac reads by position | **Rule stands.** Agents and the API read it the same way |

## 6. Housekeeping — done 27 September 2026

- **keel:** keel#350–#364 closed as not planned, each naming what replaced it.
  `almanac/docs/spec.md`, its implementation plan and `almanac/CLAUDE.md`
  carry a superseded banner and stay as prior art. The `almanac/` folder is
  kept.
- **thrive docs:** `data-architecture.md`, `implementation-plan.md` and
  `journal-spec.md` carry a retirement note pointing here. CLAUDE.md's
  `DailySummary` column rule no longer cites almanac, and its landing-screen
  decision names the Day view.

## 7. Decided with the user

1. **Day is the landing screen.**
2. **Bottom navigation** is designed with `/ux` in #235.
3. **Forage** is out of scope while it is unfinished (#230 closed).
4. **Sync on demand** moves to Thrive (#232).
5. **Only the watch reports health.** The journal is a free-text note, and
   stress is pulled from COROS (#231).

## 8. Risks

- **The bottom nav is the first real redesign Thrive has had.** It touches every
  screen's chrome and a recorded UX decision. Settle it before D2, not after.
- **A charting choice is a dependency decision.** Hand-rolled SVG keeps the
  bundle small; a library is faster to build. Decide it once in T1.
- **Journal abandonment** (`data-architecture.md` §7's original worry): the
  note has to be on the Day view, not behind it.
- **Contrast.** Chart dots and shading failed AA in almanac's design (keel#362,
  #363), and #183 is open here. Every new colour goes through a token and is
  checked in both themes.
