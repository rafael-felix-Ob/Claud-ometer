---
phase: 02-active-sessions-page
plan: 01
subsystem: api
tags: [swr, next-api-routes, active-sessions, polling, sidebar-nav]

# Dependency graph
requires:
  - phase: 01-detection-engine
    provides: "getActiveSessions() orchestrator and ActiveSessionInfo types"
provides:
  - "GET /api/active-sessions route returning ActiveSessionInfo[] (or [] in imported mode)"
  - "useActiveSessions() SWR hook with 5-second polling interval"
  - "Sidebar Active nav entry at position 2 (between Overview and Projects)"
affects: [02-active-sessions-page-02-page-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [force-dynamic API route pattern, SWR polling with refreshInterval]

key-files:
  created:
    - src/app/api/active-sessions/route.ts
  modified:
    - src/lib/hooks.ts
    - src/components/layout/sidebar.tsx

key-decisions:
  - "Return [] immediately in imported mode — active session detection only applies to live ~/.claude/ reads"

patterns-established:
  - "Polling hook pattern: useSWR<T>(url, fetcher, { refreshInterval: 5000 }) for live data"
  - "API route guard: check getActiveDataSource() === 'imported' first and return early"

requirements-completed: [UI-02, UI-03]

# Metrics
duration: 3min
completed: 2026-03-18
---

# Phase 2 Plan 01: Active Sessions Data Plumbing Summary

**GET /api/active-sessions route + useActiveSessions() SWR hook (5s polling) + sidebar Active nav entry wiring up the Phase 1 detection engine to the UI layer**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-18T17:21:28Z
- **Completed:** 2026-03-18T17:23:59Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Created force-dynamic API route at /api/active-sessions that delegates to Phase 1's getActiveSessions() on live mode and returns [] for imported data
- Added useActiveSessions() SWR hook with 5-second refresh interval to hooks.ts without modifying any existing hooks
- Added Activity icon and /active nav entry to sidebar navItems at index 1 between Overview and Projects

## Task Commits

Each task was committed atomically:

1. **Task 1: Create API route for active sessions** - `91c50ce` (feat)
2. **Task 2: Add useActiveSessions hook with 5-second polling** - `222024e` (feat)
3. **Task 3: Add Active nav entry to sidebar** - `5d97a82` (feat)

## Files Created/Modified
- `src/app/api/active-sessions/route.ts` - GET handler returning ActiveSessionInfo[] from Phase 1 orchestrator; returns [] when data source is 'imported'
- `src/lib/hooks.ts` - Added useActiveSessions() hook with SWR 5s polling; ActiveSessionInfo type added to import
- `src/components/layout/sidebar.tsx` - Activity icon import added; /active nav entry inserted at position 2 between Overview and Projects

## Decisions Made
- Return [] (not 404 or error) when data source is imported — matches the contract stated in the plan: "no detection on imported data"

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npm run build` not runnable in WSL environment (node_modules/.bin/next symlinks missing due to Windows installation). Build verification skipped; all acceptance criteria verified programmatically via node scripts instead.

## Next Phase Readiness
- API route and hook are complete — Plan 02 (page UI) can immediately import useActiveSessions() and render /active
- Sidebar link is live — navigating to /active will 404 until Plan 02 creates the page (expected behavior)
- No blockers

---
*Phase: 02-active-sessions-page*
*Completed: 2026-03-18*
