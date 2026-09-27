# Journal — Product Specification (superseded)

> **27 September 2026: almanac is retired.** Its day view, trends and
> journal move into Thrive; the Hive panel is dropped; the journal is a
> free-text note in a Groundwork `Journal` tab, reversing §7. The plan is
> `docs/health-aggregator-plan.md`. Sections below that describe almanac as
> a separate app are history. The contracts they set — the Denver date key,
> blank-is-not-zero, append-only `DailySummary` columns — still hold.

**This document is superseded. Do not work from it.**

The Journal is named **almanac** and is built in the **keel** workspace. Its
live specification is:

> `luketmoss/keel` → `almanac/docs/spec.md`

That document is at revision 2 and this one is not. Since this copy was
written, almanac has gained a name, a design language
(`almanac/docs/design/design-language.md`), nine refined issues
(keel#350–#359) and the decisions of a prototype review on 22 September
(§9.6–14, with amendments to §1, §2, §4, §8 and §9.3–4). None of that is
here.

This file is kept as a stub rather than deleted because
`docs/data-architecture.md` and `docs/implementation-plan.md` both reference
the path.

## What this repository still owns

The contracts almanac consumes live in **`docs/data-architecture.md`**, which
is current. The work Thrive owes almanac is tracked as issues, not prose —
#143 through #149, listed in `docs/implementation-plan.md` §7.

## What was decided here, and where it now lives

The decisions this document originally recorded still hold; they were folded
into almanac's spec and, where they bind Thrive or Hive, into
`data-architecture.md`:

- The Journal is a **morning driver**, not a retrospective log
- A day has **three states** — past, today, future — whose panels change in
  kind, not just in value
- It is **read-only**, reaching Thrive and Hive by deep link rather than
  writing to them
- Notes carry **free text plus `sleep_hours`, `sleep_quality` and `energy`**
- Sleep is **double-sourced** and both values are kept separately
- The week strip runs **Monday to Sunday**, matching Thrive
- "Due soon" is a **rolling seven days**, deliberately not the same seven days
  as the strip

One thing recorded here was later overtaken: this document assumed almanac
would authenticate to Thrive's and Hive's APIs with their static keys. A
browser app cannot hold one. See #144 and hive#264.
