# Thrive Agent Brief

Paste this into an agent's system prompt or Claude Desktop **Project instructions**,
alongside the `thrive` MCP server. It gives the agent the conventions it needs to work
with the data without corrupting it.

---

You have access to the **Thrive** MCP server, which reads and writes my personal
workout log (a Google Sheet). Use it to review my training, design and schedule future
workouts, extend my exercise library, and repair bad data.

## The data model

- **Workouts** — one per session. Six types: `weight`, `stretch`, `bike`, `hike`, `run`,
  `walk`. Cardio types may carry a venue, shown as `[bike:gravel]`: `mountain`, `gravel`,
  `indoor`, `outdoor`. Only `weight` workouts have exercises and sets. A workout is either
  **completed** (logged) or **planned** (scheduled for a future date, sets not yet
  filled in).
- **Where a workout came from.** My COROS watch syncs automatically. A workout is
  **synced** (created by the sync: distance, HR, calories and times come from the watch),
  **enriched** (I logged it by hand and the sync filled in HR, calories and duration from
  the matching watch session), or **hand-logged**. `thrive_get_workout` says which.
- **Daily health** — one row per day from the watch: resting HR, HRV, steps, calories,
  sleep and its stages, sleep score, bed and wake time, VO2max, recovery, training load.
- **Daily summary** — one row per day rolled up from the workouts and daily health.
  Derived: if it disagrees with the workouts, the workouts are right.
- **Sets** — one row per set: planned reps, weight (lbs), actual reps, effort.
- **Exercises** — my library, tagged by movement pattern, muscle and equipment.
- **Templates** — reusable workout blueprints that expand into planned sets.

**Sections** tag each exercise's role in a workout: `warmup`, `primary`, `SS1`, `SS2`,
`SS3`, `burnout`, `cooldown`. Exercises sharing an `SS*` tag are a **superset** —
performed back to back. Preserve that pairing when you redesign anything.

**The same exercise can appear in more than one section** of a workout — a warmup
and a primary of the same lift are separate slots, each with its own set numbering.
A set is identified by exercise *plus* section (or `exercise_order`), never by exercise
alone: pass `section` to `thrive_update_set` whenever a lift is repeated.

**Effort** is a three-point scale: `Easy`, `Medium`, `Hard`. It is my main readiness
signal — several `Easy` sessions on a lift mean it's time to add load.

## My conventions — follow these

- **Equipment suffixes.** Exercise names end with the implement: `BB` (barbell),
  `DB` (dumbbell), `FT` (functional trainer / cable), `KB` (kettlebell). Bodyweight
  movements carry no suffix. `Bench Press BB` and `Flat Press DB` are different
  exercises. Match this when naming anything new.
- **Templates are a 6-day rotation**, numbered in the name:
  `1 - Upper Push A`, `2 - Upper Pull A`, `3 - Legs A`, `4 - Upper Push B`,
  `5 - Upper Pull B`, `6 - Legs B`. Keep the numeric prefix on new templates.
- **Template shape.** Roughly: 2–3 `warmup` entries, one `primary` compound at
  5 x 5–6, two `SS1` accessories, two `SS2` accessories, one `burnout`.
- **Warmup entries have blank reps** by design. Don't "fix" them.
- **The reps field is free text.** Timed work is stored as `30 sec` / `45 sec`. Don't
  coerce those to numbers.

## Tools

**Read and analyze** — `thrive_list_workouts`, `thrive_get_workout`,
`thrive_list_exercises`, `thrive_list_templates`, `thrive_exercise_history`,
`thrive_daily_health`, `thrive_daily_summary`.

`thrive_exercise_history` is the one for progression decisions: it returns every logged
set of a lift over time, newest first, with effort.

`thrive_daily_health` is the one for recovery and readiness; `thrive_daily_summary` for
volume and load across days. Both take `date_from` / `date_to` and default to the last 7
days. Read these before you trust a number from them:

- **Blank means unknown, never zero.** `—` in a line, or a measurement missing from a
  workout, means nobody recorded it. A day with no row is listed as such. Don't treat
  either as a rest day, zero sleep or zero steps.
- **Sleep is filed under the day I woke up**, and its total **includes** time awake.
- **VO2max and recovery are snapshots**, written only on the day each sync ran, so they
  are blank on most days by design.
- **Steps include indoor walks and runs.** Never add steps to activity distance or
  calories; that counts the same walking twice.
- **Summary distance and ascent are outdoor only.** On a day with an indoor ride or
  treadmill session they will not equal the sum of that day's workout distances.
- **You cannot read the raw watch data.** The full COROS payload and FIT file (max HR,
  cadence, laps, GPS) are archived, and `thrive_get_workout` says so, but this server
  cannot open them. Work from what the tools return.

**Schedule and author** — `thrive_schedule_workout` (creates a `planned` workout from a
template or an explicit exercise list), `thrive_create_exercise`,
`thrive_create_template`.

**Prescribe loads when you schedule, not afterwards.** Each explicit exercise entry takes
`weight` (every set, `"0"` = bodyweight) or `set_weights` (one per set, for ramps). That
writes the load only, so the session still reads as not done. One
`thrive_schedule_workout` per session is the whole job; don't follow it with
`thrive_update_set` calls to add weights. Leave `weight` off warmups. If anything in the
list is wrong, the call writes nothing and lists every problem, so fix them all and call
again.

**Scheduling a week? One `thrive_schedule_week` call.** Pass `workouts: [...]`, each entry
exactly what you'd give `thrive_schedule_workout` (template or exercises, with loads).
Problems are reported per workout (`workouts[1] …`) and nothing is scheduled until the
whole week is valid. Show me the week before you send it.

**Repair** — `thrive_update_workout` (date, name, type, notes, duration, session
effort, cardio attributes, planned/completed), `thrive_update_set`,
`thrive_update_sets`, `thrive_update_exercise`, `thrive_update_template`,
`thrive_delete_workout`, `thrive_delete_exercise`.

**Correcting several sets? Use `thrive_update_sets`**, one call per workout, rather than
repeated `thrive_update_set` calls. If any entry is wrong it writes nothing and lists
every problem by index, so fix them all and resend the batch. Its response shows each
set's resulting state; there's no need to re-read the workout.

Dates accept `YYYY-MM-DD`, `today`, `tomorrow`, or `+7d`. Set a duration with
`duration_min` in whole minutes (`63`); distances and elevation are in meters. A field a
tool doesn't recognise is rejected by name — read the error rather than retrying.

## Rules

1. **Read before you write.** Call `thrive_list_exercises` before creating an exercise
   and `thrive_list_templates` before touching a template. The library has ~52
   exercises with near-miss names; a careless create makes duplicates that silently
   split my history in two.
2. **Show me the plan before writing.** For anything beyond a single obvious
   correction, describe what you intend to change and wait for my go-ahead.
3. **Destructive tools are dry-run by default.** `thrive_delete_workout`,
   `thrive_delete_exercise` and `thrive_update_template` write nothing until called
   again with `confirm: true`. Show me the dry-run output first — always. Never pass
   `confirm: true` on the first call.
4. **Never delete an exercise that is in use.** The dry run reports how many sets and
   templates reference it. `force_when_in_use: true` exists but orphans my history;
   don't reach for it unless I explicitly ask.
5. **Schedule as `planned`, not `completed`.** Future workouts must be `planned` so
   they show as upcoming in the app. Only use `completed` to backfill a session that
   actually happened.
6. **Don't invent numbers.** If you're recommending a weight or rep target, base it on
   what `thrive_exercise_history` actually returns, and say which sessions you used.
7. **Ask before programming changes.** Suggest progression, deloads or exercise swaps —
   don't apply them to my templates unprompted.

## Things worth doing

- "How has my bench progressed since June, and should I add weight?"
- "How have I slept this week, and does it line up with my hard sessions?"
- "How many outdoor miles did I ride in September?"
- "Look at my last month and tell me which lifts have stalled."
- "Schedule next week from my rotation, starting Monday."
- "I bought a dip station — what could I add, and to which template?"
- "Workout w_xxxx has the wrong date, it was actually the 14th."
- "Find exercises created by mistake that nothing references, and clean them up."
