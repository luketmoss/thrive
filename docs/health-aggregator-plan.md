# Thrive as the Health Aggregator — Plan

**Revision 1** — 27 September 2026
**Decision:** almanac is retired. Thrive becomes the one app for health —
training, sleep and recovery, body measurements, a daily journal, trend charts,
and later food from Forage. The Hive panel is dropped, not moved.

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

| Epic | Issue | Priority | Replaces |
|---|---|---|---|
| **Journal** — a daily check-in and notes, owned by Thrive | [#227](https://github.com/luketmoss/thrive/issues/227) | high | keel#352 |
| **Day view** — one date, what was planned, done, slept and felt | [#228](https://github.com/luketmoss/thrive/issues/228) | high | keel#351, #356, #357, #358 |
| **Trends** — charts over recovery, sleep, body, activity and check-in | [#229](https://github.com/luketmoss/thrive/issues/229) | high | keel#359, thrive#202 |
| **Forage in Thrive** — what was cooked, beside training and health | [#230](https://github.com/luketmoss/thrive/issues/230) | low | almanac spec §7 |

All four sit in **To Do**. Each is an epic: `/refine` slices it into children,
and the slice tables in the issues are a starting point for `/pm`, not a
commitment.

## 3. The shape of it

```
  #227 Journal ─── J1 tab ──► J2 SPA + editor ────────────┐
                    └──────► J3 API + MCP                 │
                                                          ▼
  #228 Day view ── D1 health reads ──┬──► D4 Health/Body ─┼─► D6 Calendar
                   D2 day screen ────┼──► D3 Training ────┤
                                     │    D5 Journal ◄────┘
                                     ▼
  #229 Trends ──────────────────── T1 ──► T2–T5 groups ──► T6 custom set

  #230 Forage ──────────────── (after D2) ──► F1–F4
```

**Start with J1 and D1/D2 in parallel.** They share nothing: J1 is a new tab,
D1 is reads of tabs that already exist, D2 is a route and a layout. **D1 is
the seam** — Day view and Trends both read through it, so it is built once.

**Trends can start as soon as D1 lands**, and does not wait for the Day view's
panels. If trend charts are the thing you want first, T1–T4 need nothing from
the Journal; only T5 does.

**Forage waits** for the Day view to exist and for its open question — cooking
log or nutrition — to be answered.

## 4. What carries over from almanac, and what does not

**Carried over** (each epic names its sources):

- One date, three states — past, today, future — whose panels change in kind
- Journal fields: `notes`, `sleep_hours`, `sleep_quality`, `energy`, all nullable
- Sleep double-sourced; watch and self-report kept apart
- "Your range": 30-day mean ± 1 SD, shown from 14 values, coloured only in the
  unwelcome direction and always with words
- A number appears when a sync brought it — never yesterday's, never zero
- Trends: shared date axis, never two y-axes, blank days break the line, table
  view, charts that show and never conclude
- Monday–Sunday week strip; sunrise, sunset and daylight in the header

**Dropped:**

- The Hive panel and every Hive dependency
- Almanac's own design language and amethyst accent — Thrive's `global.css` rules
- Cross-app auth and cross-app deep links
- The "not a journal" naming argument (spec §9.5). Inside Thrive the day's entry
  is plainly called a journal, because that is what you asked for

**Changed:**

- **Journal storage moves into Groundwork** as a `Journal` tab, reversing
  `data-architecture.md` §7's separate spreadsheet. That decision guarded a
  boundary between two apps; there is one app now.

## 5. What stays in Thrive that was built for almanac

The upstream work is done — thrive#143–#149 and hive#263–#266 are all closed.
None of it is wasted, and none of it needs undoing now:

| Built | For almanac | Now |
|---|---|---|
| thrive#143 — planner opens for a date from a URL | "Plan" action | The Day view's "Plan" action, in-app |
| thrive#145 — estimated duration on a planned workout | Training panel | Day view's Training panel |
| thrive#147, #201 — `DailyHealth` and `BodyMeasurements` via the API | Health panels | MCP agents' read path. The SPA reads the tabs directly (D1) |
| thrive#146 — exercise and set counts on planned workouts | Training panel | MCP agents; the SPA has the rows already |
| thrive#144, hive#264 — accept a Google token for reads | Cross-app auth | **Unused.** Harmless; a candidate for removal later, not now |
| `DailySummary` append-only columns | almanac reads by position | **Rule stands.** Agents and the API read it the same way |

## 6. Housekeeping — proposed, not yet done

These change other repos or rewrite standing docs, so they wait for a yes:

- **keel:** close keel#350–#361 and #364 as not planned, each pointing at the
  Thrive epic that replaces it; mark `almanac/docs/spec.md` superseded; decide
  whether to delete the `almanac/` folder or leave it as a stub. keel#362 and
  #363 close with almanac's design language.
- **thrive docs:** `data-architecture.md` §1, §6, §7 and §10 name almanac as the
  Journal and a separate app; `implementation-plan.md` §7 is "Inbound from
  almanac"; `journal-spec.md` points at almanac's spec; CLAUDE.md gives almanac
  as the reason `DailySummary`'s columns never move. Each needs a line
  pointing here.
- **CLAUDE.md UX decisions:** the landing screen and bottom navigation entries
  change once §7's questions are answered.

## 7. Open questions — yours to answer

These block `/pm` on #228 and #230. Each epic lists them too.

1. **Is Day the new landing screen**, replacing Activities?
2. **Bottom navigation.** Four tabs today (Activities, Templates, Exercises,
   Settings). Day and Trends make six unless something merges — for example
   Templates and Exercises into one "Library". `/ux` can propose; you choose.
3. **Forage: a cooking log or nutrition?** Forage records recipes and cooking
   sessions, not calories or macros. Showing what you cooked needs nothing new
   from Forage; tracking nutrition needs Forage to record it first.
4. **Sync on demand** (keel#360) — carry the spike over, or drop it?

## 8. Risks

- **The bottom nav is the first real redesign Thrive has had.** It touches every
  screen's chrome and a recorded UX decision. Settle it before D2, not after.
- **A charting choice is a dependency decision.** Hand-rolled SVG keeps the
  bundle small; a library is faster to build. Decide it once in T1.
- **Journal abandonment** (`data-architecture.md` §7's original worry): three
  taps a day is the whole defence. The editor has to be on the Day view, not
  behind it.
- **Contrast.** Chart dots and shading failed AA in almanac's design (keel#362,
  #363), and #183 is open here. Every new colour goes through a token and is
  checked in both themes.
