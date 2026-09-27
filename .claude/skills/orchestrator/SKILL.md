---
name: orchestrator
description: Batch-process several issues — every child of a parent, or a list — through the refinement and delivery runs, one sub-agent per issue on a model chosen per issue. Use when the user wants several issues refined or finished at once (e.g., "#3 children", "refine all children of #3", "refine #12, #14 and #15").
argument-hint: [#parent-number children | a list of issue numbers]
allowed-tools: Bash, Read, Grep, Glob, Agent, Task, TodoWrite, AskUserQuestion
---

# Batch Orchestrator

Takes several issues through the runs. It is a loop around `/refine` and
`/finish`, not a third pipeline: it does not chain stages itself and it does not
merge. For a single issue, invoke the run directly — this skill is only for
batches.

What it adds over running the issues one by one is coordination: an order that
respects their dependencies, a sub-agent per issue so no one context holds the
whole batch, a model matched to each issue, and a check that issues refined side
by side did not decide the same thing two ways.

## Config

- **Repo:** `luketmoss/thrive`
- **Input:** $ARGUMENTS — a parent issue number, or a list of issue numbers

## Board

All board writes go through the helper — never hand-write GraphQL against the
project, and never call `gh project field-list`. IDs live in `.thrive/board.json`.

```bash
# sub-issues: gh api repos/luketmoss/thrive/issues/<parent>/sub_issues
#   (no gh in a cloud session: the GitHub MCP issue_read tool, method get_sub_issues)
node .thrive/board.mjs show <issue>
```

The runs move the cards. This skill does not — with one exception: a new issue
it files goes on the board through `/idea`.

## Process

1. **List the issues** and their columns. Skip anything CLOSED or in Done.
   Put them in a TodoWrite checklist.

2. **Order them by dependency.** Read each issue's body for what it depends on
   ("Depends on #N", a slice table, a named contract). Group them into
   **waves**: wave 1 is every issue that depends on nothing else in the batch,
   wave 2 depends only on wave 1, and so on. Within a wave, issues closest to
   Done go first.

3. **Refine, one wave at a time.** Every issue at or before UX gets a sub-agent
   running `/refine` (the brief is below). A wave's agents run in parallel, at
   most six at once, in the background. Start wave N+1 when the issues it
   depends on are Refined — not when the whole of wave N is, if some of it is
   unrelated. A halted `/refine` is one line in the summary, not a reason to end
   the batch; issues that depend on it wait, and say so.

4. **Check the wave for conflicts** before starting the next one. Read the
   refined bodies of the issues just finished, side by side, and look for:
   - the same helper, file, token, storage key or format named or shaped two ways
   - two issues each claiming to build the same shared piece, or neither
   - a decision in one that contradicts a decision in another
   Resolve each with a comment on the later issue saying which one wins, and
   brief the next wave with the winner. List every one in the report.

5. **One design gate for the batch.** Present a table: issue, title, model,
   complexity, UX verdict, and any that halted with the reason. Under it, the
   judgment calls each agent flagged, and the conflicts from step 4. Then ask —
   approve all, approve a subset, or send some back. This is the same gate
   `/refine` stops at, asked once instead of N times.

6. **Deliver the approved ones, one at a time**, in wave order, each in its own
   sub-agent running `/finish`. Not in parallel: they share one checkout, and
   one issue's merge is often the next one's base. An issue that halts stays
   where it stopped; note it, and skip anything that depends on it.

7. **Report:** a table of merged / halted / skipped, with the model that did
   each, the reason for each halt, and the PR or issue link. Close the parent
   only if every child merged; otherwise leave it open and say what's left.

## Choosing the model

Per issue, from what the issue *is*, not how long it is:

| Opus | Sonnet |
|---|---|
| Sets a contract other issues build on: a shared module, a data layer, a schema or tab, an API shape, navigation | Fills a contract another issue already defined: a panel in a screen, an entry in a registry, a metric in a group |
| Heavy design or UX judgment: a new screen, an interaction model, a chart | Mechanical mapping or wiring against existing patterns |
| Auth, security, credentials, anything irreversible | A spike being tightened, docs, a small bug with a known cause |

When unsure, Opus. Never Haiku for a pipeline stage. `/finish` picks Opus for
its own `/review` step whatever model delivers the issue. The user's word
overrides all of this: "all on Opus", "no sub-agents" — and with no sub-agents,
run the issues inline one at a time and say the context budget below applies.

## The sub-agent brief

A sub-agent starts cold: it knows only what the brief tells it. Every brief
says:

- the issue number, and to read `CLAUDE.md`, then follow
  `.claude/skills/refine/SKILL.md` (or `finish/`) exactly, reading each stage's
  skill file as it goes
- the parent epic, and **every Refined issue this one depends on, by number,
  as binding** — with the specific decisions from them it must build on (a
  helper's name, a route, a file that owns a shared piece)
- the issues being refined in parallel, by number: do not refine them, and do
  not decide things they own
- **deferred work goes through `/idea`** and onto the board, and is listed in
  the report — never dropped, and never left for the orchestrator to notice
- during refinement, no repo files are written or committed. Screenshots come
  from `.thrive/look.mjs`, which writes them outside the repo; never stop the
  shared dev server (`pkill -f vite`) other agents are using
- in a cloud session there is no `gh`: every `gh` step means the same
  operation through the GitHub MCP tools, and board writes still go
  through `board.mjs`
- finish with the run skill's report: the ACs in full, complexity, the UX
  verdict, and every judgment call that could have gone the other way

## Context budget

With sub-agents, each issue's run lives in its own context and this one holds
only the briefs and reports, so a batch of ten is fine to refine in one session.
Delivery is heavier: stop after three or four merged issues and hand the rest
back with a list, rather than let a long session degrade. Say which you did.

Running inline (no sub-agents), the old limit applies: three or more issues
through the full delivery run will exhaust the context window. Refine the batch
here, then deliver at most two per session.

## What this skill does not do

- It does not run stages inline. Every issue goes through `/refine` or `/finish`
- It does not merge. `/ship`, inside `/finish`, is the only thing that merges
- It never runs `gh pr review --approve` — GitHub rejects approving your own PR
- It does not create issues directly. Deferred work goes through `/idea`
- It does not skip the design gate. Refining and delivering in one pass without
  asking is exactly what the two runs exist to prevent
