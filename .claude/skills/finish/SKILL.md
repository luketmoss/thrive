---
name: finish
description: Run a refined Thrive issue through the full delivery chain - development, QA, code review, merge. Use when the user says to finish, build out, ship, deliver, or complete an issue.
---

# /finish

The delivery run. Takes an issue from Refined to Done **without stopping**.

## Precondition

The issue must be in **Refined**. If it is in To Do, PM Refining or UX, it
hasn't been through the design gate — stop and say so. Running the refinement
chain and the delivery chain back to back skips the only review of the spec,
which is the point of having two runs.

If the issue is already partway down the chain, start from where it actually is
rather than from the top:

| Current column | Resume at |
|---|---|
| Refined | `/dev` |
| In Development | `/dev` |
| Testing | `/qa` |
| Code Review | `/review` |
| Ready to Ship | `/ship` |

```bash
node .thrive/board.mjs show <issue>
```

## Sequence

1. **`/dev`** — branch, tests, code, draft PR
2. **`/qa`** — verify against the acceptance criteria, take the PR out of draft
3. **`/review`** — review the diff, confirm CI, in a fresh-context sub-agent (below)
4. **`/ship`** — Results, merge, delete the branch

Each step is the real skill. Read and follow `.claude/skills/<step>/SKILL.md` at
each stage rather than approximating it.

Run the steps back to back in one pass. A stage returning is not a checkpoint —
do not ask the user whether to proceed between stages, and do not stop to report
progress. The only things that end this run early are the halt conditions below.

**Step 4 is `/ship` itself, not a merge written out again here.** `/review`
leaves the issue in Ready to Ship, which is the state `/ship` already requires,
so it runs against exactly what it expects — with its refusal conditions and its
Results section intact. The only irreversible operation in the system is written
down once.

## The review runs in a fresh context

Step 3 is the one stage that gains from not sharing this session's context: a
reviewer that did not write the code reads the diff as it is, not as it was
meant to be. So run `/review` in a **sub-agent on Opus** (the Agent tool,
`model: opus`), giving it the issue and PR numbers and telling it to read and
follow `.claude/skills/review/SKILL.md` and report its verdict. Continue from
that verdict: blocking → the issue is back in In Development and this run
returns to `/dev`; otherwise on to `/ship` here.

Every other stage runs inline. If sub-agents are unavailable, or the user said
not to use them, run `/review` inline too, and say so in the report.

## Halting

The run stops early if:

- the issue is underspecified in a way that matters — `/dev` stops with the
  branch in place and says what's missing, rather than inventing the answer
- a criterion fails and the fix isn't clear, or fixing it would exceed the Out
  of Scope section
- `/qa` cannot verify a criterion here at all — name it, don't pass it silently
- `/review` finds something blocking — the issue returns to In Development
- `/ship` refuses: a draft PR, checks failing, pending or absent, or a conflict.
  The issue **stays in Ready to Ship**, which is what that column means — not a
  queue to rubber-stamp, but the ones that could not finish on their own

Two attempts at a failing stage. After the second, stop and hand back.

**A halted run is a success.** Report where it stopped and why, and that nothing
merged. Do not work around a gate.

## Report

When the run merges:

- issue and PR with URLs, and the commit on `main`
- what changed, in a few lines
- which acceptance criteria were verified and how
- anything `/review` noted that didn't block, and whether it ran in a sub-agent
- any judgment call that could reasonably have gone the other way

When it stopped instead, say where, why, and that nothing merged.
