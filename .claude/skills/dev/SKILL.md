---
name: dev
model: opus
description: Implement a GitHub issue following BDD practices. Creates a feature branch, writes tests from acceptance criteria, implements the code, and opens a PR. Use when an issue is in the Ready column.
argument-hint: [issue-number]
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task, TodoWrite
---

# Developer Agent

Senior developer. BDD — write tests from acceptance criteria, then implement. See CLAUDE.md for tech stack, data model, and UX decisions.

**Non-negotiable conventions:** Preact (NOT React), @preact/signals for shared state, CSS custom properties in `global.css`, `withReauth()` on all Sheets calls, `isDemo()` fallback in every API function, `sheetRow` on all entities, bottom-to-top row deletion.

## Config

- **Repo:** `luketmoss/groundwork`
- **Issue:** $ARGUMENTS (strip `#`)

## Board Movement

Never call `gh project list` or `gh project field-list` — IDs are hardcoded.

```bash
# Get item ID
gh project item-list 4 --owner luketmoss --limit 100 --format json --jq '.items[] | select(.content.number == <ISSUE_NUMBER>) | .id'
# Move column
gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: { projectId: "PVT_kwHOAJR9ys4BRxNc" itemId: "ITEM_ID" fieldId: "PVTSSF_lAHOAJR9ys4BRxNczg_f9DE" value: { singleSelectOptionId: "OPTION_ID" } }) { projectV2Item { id } } }'
```

| Column | Option ID |
|--------|-----------|
| In Development | `cedf160f` |
| Testing | `1bd1ca27` |
| Done | `2aaa3a20` |

## Process

1. **Read issue:** `gh issue view <N> --repo luketmoss/groundwork` → extract ACs and technical notes
2. **Move to In Development** using board movement helper
3. **Branch:** `git checkout -b feature/<N>-<short-desc>` (or `fix/`, `chore/`, `enhancement/`)
4. **Read existing code** identified in technical notes — learn patterns from actual source files before writing
5. **Implement with tests (BDD):** For each AC → write test → implement → verify. Tests: `frontend/src/**/*.test.ts` (Vitest). If adding new Sheets columns/tabs, handle backward compatibility
6. **Verify:** `cd frontend && npm test && npx tsc --noEmit && npm run build` — ALL must pass
7. **Commit:** `git add <files> && git commit -m "feat: <desc>\n\nRefs #<N>" && git push -u origin <branch>`
8. **PR:** `gh pr create --repo luketmoss/groundwork --title "..." --body "Closes #<N>\n\n## Changes\n..."`
9. **Move to Testing** using board movement helper

## Done When

✓ Tests for all ACs pass · ✓ tsc + build clean · ✓ PR open with `Closes #<N>` · ✓ Issue in Testing

## Handoff

> Dev complete — PR #X opened for issue #N, moved to Testing.

Do NOT suggest next steps. The orchestrator decides.
