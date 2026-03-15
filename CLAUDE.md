# Groundwork — Personal Workout Tracker

## Project Overview
Personal workout tracker: Preact SPA → Google Sheets REST API.
- **frontend/**: Preact SPA (built with Vite) — deployed to GitHub Pages

## Key Commands
- `cd frontend && npm run dev` — start Vite dev server (localhost:5173)
- `cd frontend && npm run build` — production build to frontend/dist/
- `cd frontend && npm test` — run frontend tests (vitest)
- `cd frontend && npx tsc --noEmit` — TypeScript type checking

## Environment
- **Windows machine** — `jq` is NOT available. For JSON parsing in shell commands, use `gh` built-in `--jq` flags. Never pipe to a standalone `jq` command.
- Node 20+, npm

## Architecture Notes
- Frontend uses direct `fetch()` to Google Sheets REST API (not gapi.client)
- Auth: Google Identity Services (GIS) token model
- State: @preact/signals (module-level signals, NOT useState for shared state)
- Styling: CSS custom properties in `global.css` (no CSS framework, no Tailwind)
- Router: Signal-based hash router using signals (no library dependency)
- Mobile-first design (375px primary breakpoint)
- No backend server — SPA reads/writes Sheets API directly via OAuth

## Preview & Demo Mode
- The app requires Google OAuth to function. For preview testing (QA, UX agents), use **demo mode** by navigating to `http://localhost:5173/groundwork/?demo=true` after starting the dev server.
- Demo mode provides a fake user and skips Google auth. Changes are not persisted.

## Data Model
Google Sheet "Groundwork" with 5 tabs:
- **Exercises** (A:E): id, Name, Tags, Notes, Created
- **Templates** (A:L): template_id, Template Name, Order, exercise_id, Exercise Name, Section, Sets, Reps, Rest (s), Group Rest (s), Created, Updated
- **Workouts** (A:J): id, Date, Time, Type, Name, template_id, Notes, Duration (min), Created, copied_from
- **Sets** (A:K): workout_id, exercise_id, Exercise Name, Section, Exercise Order, Set #, Planned Reps, Weight (lbs), Reps, Effort, Notes
- **Config** (A:B): Key, Value

### Workout Types
- `weight` — structured weight training with exercises, sets, reps, effort
- `stretch` — notes + date only
- `bike` — notes + date only
- `yoga` — notes + date only

### Template Sections
Exercises in templates are tagged with sections: `warmup`, `primary`, `SS1`, `SS2`, `SS3`, `burnout`, `cooldown`. Superset exercises share the same `SS*` tag.

### Effort Scale
Three levels: `Easy`, `Medium`, `Hard`

### Exercise Tags
Comma-separated, multiple per exercise. Common tags: Push, Pull, Legs, Chest, Back, Shoulders, Arms, Core, Compound, Isolation.

## UX Design Decisions
These decisions were made with the user and must be respected by all agents:

- **Landing screen**: Activities (chronological workout list with floating "Start Workout" button)
- **Set logging**: Logbook-style — record sets when convenient, not real-time per-set
- **Rest timers**: None in-app — rest times are planning data only (user uses watch)
- **Supersets**: Flat list with section labels/colors (not grouped flow)
- **Start workout**: Choose [From Template] or [Build Custom]
- **Exercise library**: Inline creation (on-the-fly during workout/template building)
- **Set entry**: Quick-fill weight for all sets, override individual sets if different
- **Templates**: Create via dedicated editor AND save-from-workout
- **Navigation**: Bottom tab bar (Activities | Templates | Exercises | Settings)
- **Activity cards**: Compact (Date, Name, Type badge) — tap to view details
- **Activity detail**: Summary per exercise, tap to expand set-by-set
- **Copy workout**: Pre-fill from previous + show "last time" reference while logging
- **Device**: Mobile-first (375px primary breakpoint)

## Agent Routing

**Issue tracker: GitHub only.** All issue references mean GitHub issues. Use `gh` CLI exclusively.

When the user's request matches a custom skill, invoke it automatically:
- Bug report, feature idea, or new request → `/idea`
- UX or accessibility audit → `/ux`
- CI/CD or deployment issue → `/devops`

**When the user references an issue number**, always start the Full Pipeline.

## Pipeline Orchestration

**You (the main Claude instance) are the orchestrator.** You invoke skills in order, pass results between them, and ensure no step is skipped.

### Refinement Pipeline
1. Move issue to **PM Refining**. Invoke `/pm` with the issue number.
2. Move issue to **UX**. Invoke `/ux` with the issue number and ACs.
3. Invoke `/pm` again with UX findings (accept/defer/reject).
4. Move issue to **Refined**.
5. Present final ACs to user (design gate).

### Dev Pipeline
1. **Dev**: Invoke `/dev` with the issue number.
2. **QA**: Invoke `/qa` with the issue number.
3. **Code Review**: Invoke `/review` with the issue number.
4. **Auto-merge**: Approve + squash-merge + delete branch + move to Done.

### Conflict Resolution
2 attempts per failing stage max. After 2 failures, stop and tell the user.
