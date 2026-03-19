---
phase: 08-portability-and-ui
plan: 02
subsystem: ui
tags: [recharts, barchart, sqlite, db-export, db-import, zip-to-sqlite, swr]

# Dependency graph
requires:
  - phase: 08-01
    provides: /api/db-export, /api/db-import, /api/projects/[id]/activity routes and useProjectActivity hook

provides:
  - ProjectActivityChart component (BarChart with messages/sessions toggle, empty state)
  - Database section on /data page (export, replace, merge cards)
  - ZIP-to-SQLite bridge button appearing after successful ZIP import
  - /api/ingest POST route wrapping runIngestCycle for imported data

affects: [data-page, project-detail-page, db-portability, ingest-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BarChart component mirrors AreaChart pattern: Card wrapper, metric toggle buttons, Recharts ResponsiveContainer"
    - "Empty state in chart: conditional render based on data.length === 0 inside same Card"
    - "DB file download: fetch blob -> URL.createObjectURL -> programmatic <a> click -> revokeObjectURL"
    - "showZipToDbBridge state gate: set true on ZIP import success, false after bridge completes"

key-files:
  created:
    - src/components/charts/project-activity-chart.tsx
    - src/app/api/ingest/route.ts
  modified:
    - src/app/data/page.tsx
    - src/app/projects/[id]/page.tsx

key-decisions:
  - "ZIP-to-SQLite bridge uses /api/ingest POST route (new) rather than calling runIngestCycle directly — client component boundary requires server route"
  - "Ingest route passes path.join(getImportDir(), 'claude-data', 'projects') per Pitfall 6 — not getImportDir() directly"
  - "DB replace uses window.confirm for confirmation (simplest approach, no modal dependency)"
  - "Bridge card uses green color scheme to distinguish from error/success messages"

patterns-established:
  - "Chart empty state: conditional render inside Card content with h-[200px] flex centering"
  - "DB file download pattern: fetch -> blob -> programmatic anchor -> revoke"

requirements-completed: [PORT-01, PORT-02, PORT-03, UI-01]

# Metrics
duration: 25min
completed: 2026-03-19
---

# Phase 08 Plan 02: Portability and UI Summary

**Database portability UI (export/replace/merge .db) and per-project BarChart activity view with ZIP-to-SQLite bridge on /data page**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-19T20:00:00Z
- **Completed:** 2026-03-19T20:25:00Z
- **Tasks:** 2 of 3 complete (Task 3 is checkpoint:human-verify)
- **Files modified:** 4

## Accomplishments
- Created ProjectActivityChart (Recharts BarChart) with Messages/Sessions toggle and empty state, integrated between stats and tools on project detail page
- Added Database section to /data page with Export .db, Replace .db (with confirmation), and Merge .db cards
- Created /api/ingest POST route to allow client-side trigger of runIngestCycle with imported JSONL directory
- Added ZIP-to-SQLite bridge: after successful ZIP import, a green banner card offers "Import to Database" one-click action

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ProjectActivityChart and wire to project detail page** - `2b58a9e` (feat)
2. **Task 2: Add Database section and ZIP-to-SQLite bridge to /data page** - `b2fc85b` (feat)
3. **Task 3: Visual verification** - checkpoint:human-verify (pending)

## Files Created/Modified
- `src/components/charts/project-activity-chart.tsx` - Recharts BarChart with 2-metric toggle, empty state for zero-activity projects
- `src/app/api/ingest/route.ts` - POST handler: runs runIngestCycle with imported JSONL projects path
- `src/app/data/page.tsx` - Database section (3-column grid), ZIP-to-SQLite bridge state and handlers
- `src/app/projects/[id]/page.tsx` - useProjectActivity hook wired, ProjectActivityChart rendered between stats and tools

## Decisions Made
- Used `/api/ingest` (new route) rather than direct server function call — necessary because data page is a client component
- Path passed to ingest: `path.join(getImportDir(), 'claude-data', 'projects')` per Pitfall 6 in RESEARCH.md
- `window.confirm` used for replace confirmation — avoids adding modal component dependency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All frontend UI for Phase 8 is complete pending Task 3 human-verify checkpoint
- After visual verification, the milestone v1.1 (History Database) is fully complete
- Build passes cleanly with all new routes and components included

---
*Phase: 08-portability-and-ui*
*Completed: 2026-03-19*
