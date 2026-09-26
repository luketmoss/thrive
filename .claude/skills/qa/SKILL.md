---
name: qa
description: Test a GitHub issue's implementation against its acceptance criteria. Runs automated tests, performs manual verification in demo mode, and reports pass/fail results. Use when an issue is in the Testing column.
argument-hint: [issue-number]
---

# QA Agent

Meticulous tester. Verifies implementations against acceptance criteria with automated + manual testing. See CLAUDE.md for tech stack and data model.

## Config

- **Repo:** `luketmoss/thrive`
- **Issue:** $ARGUMENTS (strip `#`)

## Board

All board writes go through the helper — never hand-write GraphQL against the
project, and never call `gh project field-list`. IDs live in `.thrive/board.json`.

```bash
node .thrive/board.mjs show <issue>
node .thrive/board.mjs set <issue> --status "Testing"
node .thrive/board.mjs set <issue> --status "Code Review"
```

## Demo Mode

`cd frontend && npm run dev` → `http://localhost:5173/thrive/?demo=true`

Demo data: 16 exercises, 10 labels, 2 templates (Upper Push A, Upper Pull A), 3 workouts (1 weight/20 sets, 1 stretch, 1 bike).

### Auth in Preview

Demo mode auto-authenticates — no login screen, no OAuth popups. Just navigate to `http://localhost:5173/thrive/?demo=true` and the app loads directly into the authenticated state.

### Demo Mode Limitations

- Deletions are not persisted — `fetchLabels`/`fetchExercises` always return the original demo set after re-fetch
- Creates/renames update signals in-memory but reset on page reload
- Console will show Google OAuth popup blocked errors — these are expected and not bugs

### Token Efficiency Tips

- Open the app with `preview_start` (`.claude/launch.json` defines the dev server), then drive it with the Browser pane tools
- Prefer `read_page` or `javascript_tool` over screenshots when checking specific elements or computed CSS — a screenshot cannot tell you a contrast ratio
- Use `computer` with `action: "screenshot"` for visual evidence, `resize_window` for the 375px breakpoint
- Batch multiple DOM checks into a single `javascript_tool` IIFE instead of many calls
- Skip 480px tablet breakpoint unless the feature specifically involves responsive layout changes

### Cloud sessions (no Browser pane)

The `preview_*`/Browser pane tools exist only in the desktop app. Where they are missing, test visually with `.thrive/look.mjs` — never fall back to code inspection alone:

- `node .thrive/look.mjs /templates --width 375 --theme dark --out <scratchpad>/tpl.png` starts the dev server if needed, screenshots the demo app, and prints console errors. Open the PNG with `Read` to see it.
- For AC flows, write a short script that does `import { open } from '<repo>/.thrive/look.mjs'` and drives `page` with Playwright: `getByRole(...).click()`, `fill`, `page.evaluate` for computed CSS, `page.screenshot`.
- Send the key screenshots to the user; GitHub's API takes no image uploads, so the PR report describes the evidence in words.

## Process

1. **Read issue + PR:** `gh issue view <N>` → `gh pr list --search "Closes #<N>"` → `gh pr diff <PR_N>` → extract ACs
2. **Automated tests:** `cd frontend && npm test && npx tsc --noEmit && npm run build` — all must pass
3. **Manual testing in demo mode** — for each AC: follow Given/When/Then exactly, screenshot evidence, note PASS/FAIL
4. **Test matrix:** 375px mobile + 480px tablet · light + dark theme · check console errors
5. **Edge cases:** empty states, boundary values, navigation flow, error states
6. **Post QA report** as PR comment:

```bash
gh pr comment <PR_N> --repo luketmoss/thrive --body "$(cat <<'EOF'
## QA Report — Issue #<N>
### Automated: Vitest ✓/✗ · TypeScript ✓/✗ · Build ✓/✗
### AC Results
#### AC1: <name> — PASS/FAIL
<steps + evidence>
### Observations
Mobile (375px): ... · Dark theme: ... · Edge cases: ...
### Verdict: PASS / FAIL
EOF
)"
```

7. **Move issue:** PASS → Code Review · FAIL → leave in Testing, tag with failure details

## Handoff

On PASS: take the PR out of draft (`gh pr ready <PR_N>`) and move the issue to
**Code Review**. `/review` reviews the diff.

On FAIL: move it back to **In Development** and say what failed. A criterion you
did not actually check is a failure, not a pass — never infer from a green build
that the behavior is correct.
