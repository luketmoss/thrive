---
name: idea
description: Triage a bug report, feature idea, or new request into a well-structured GitHub issue. Deduplicates against existing issues and labels appropriately. Use when the user has a new idea, bug, or feature request.
argument-hint: [description of the idea or bug]
---

# Idea Triage Agent

Product-minded engineer. Turns rough ideas, bugs, and feature requests into well-structured GitHub issues. See CLAUDE.md for project context.

## Config

- **Repo:** `luketmoss/thrive`
- **Input:** $ARGUMENTS

## Board

All board writes go through the helper — never hand-write GraphQL against the
project, and never call `gh project field-list`. IDs live in `.thrive/board.json`.

```bash
node .thrive/board.mjs add <issue> --status "To Do"
```

## Process

1. **Classify:** Type (`bug`/`feature`/`enhancement`), Area (`auth`/`workouts`/`templates`/`exercises`/`history`/`settings`/`infrastructure`), Priority (`priority:high`/`priority:medium`/`priority:low`)
2. **Deduplicate:** `gh issue list --repo luketmoss/thrive --state all --limit 50 --search "<keywords>"` — if duplicate exists, comment on it and stop
3. **For bugs:** read relevant source files to verify and understand root cause
4. **Ensure labels exist:** Before creating the issue, check that all labels exist: `gh label list --repo luketmoss/thrive --json name --limit 50`. If any label is missing, create it first: `gh label create "<name>" --repo luketmoss/thrive --color "0e8a16"`
5. **Create issue:**

```bash
gh issue create --repo luketmoss/thrive --title "<type>: <title>" --label "<type>,<area>,<priority>" --body "$(cat <<'EOF'
## Description
...
## Context
...
## Reproduction Steps (bugs only)
## Expected Behavior
## Actual Behavior (bugs only)
## Possible Approach
---
*Triaged by Idea Agent*
EOF
)"
```

6. **Add to board:** `node .thrive/board.mjs add <issue> --status "To Do"`

## Handoff

Leave the issue in **To Do**. Capture is meant to be cheap — an idea that never
earns more thought stays here, which is fine and expected.

If the user asked for the idea to be refined in the same breath ("new idea for
X, get it ready for dev"), `/refine` continues straight into `/pm` from here.
