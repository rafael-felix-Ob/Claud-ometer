---
phase: 06-delta-ingest
plan: 02
subsystem: ui
tags: [swr, date-fns, sidebar, sync-status, sqlite]

# Dependency graph
requires:
  - phase: 06-delta-ingest/06-01
    provides: getSyncStatus() export from ingest.ts, SQLite sessions table
provides:
  - /api/sync-status GET endpoint returning { lastSynced, sessionCount, isRunning }
  - useSyncStatus() SWR hook with 5s polling interval
  - Sidebar sync status display (live: "Synced X ago / N sessions in DB", importing: "Syncing...", fallback: "Reading from ~/.claude/", imported mode: unchanged)
affects: [sidebar, hooks, api-routes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - force-dynamic API route returning getSyncStatus() in one line
    - SWR hook with refreshInterval: 5000 matching existing polling pattern
    - Conditional sidebar bottom section: imported badge / synced info / fallback

key-files:
  created:
    - src/app/api/sync-status/route.ts
  modified:
    - src/lib/hooks.ts
    - src/components/layout/sidebar.tsx

key-decisions:
  - "SyncStatus interface defined in hooks.ts (not imported from ingest.ts) to keep client/server boundary clean"

patterns-established:
  - "Pattern: API route wrapping ingest module status — force-dynamic + NextResponse.json(getSyncStatus())"
  - "Pattern: Sidebar bottom section has three distinct states: imported, synced, pre-sync/running"

requirements-completed: [ING-04, UI-02]

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 06 Plan 02: Sync Status UI Summary

**Sidebar bottom section now shows real-time sync status ("Synced X ago / N sessions in DB") polled every 5 seconds via /api/sync-status endpoint wired to the ingest engine**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-19T16:09:02Z
- **Completed:** 2026-03-19T16:17:00Z
- **Tasks:** 2 of 3 (Task 3 is human-verify checkpoint)
- **Files modified:** 3

## Accomplishments
- Created `/api/sync-status` GET route (force-dynamic, returns `getSyncStatus()` from ingest module)
- Added `SyncStatus` interface and `useSyncStatus()` SWR hook (5s refresh) to `hooks.ts`
- Replaced static sidebar bottom text with three-state dynamic display: synced info, syncing indicator, or fallback

## Task Commits

Each task was committed atomically:

1. **Task 1: Create sync-status API route and useSyncStatus hook** - `4195e79` (feat)
2. **Task 2: Add sync status display to sidebar** - `42532d3` (feat)

## Files Created/Modified
- `src/app/api/sync-status/route.ts` - GET endpoint returning sync status JSON (force-dynamic)
- `src/lib/hooks.ts` - Added `SyncStatus` interface and `useSyncStatus()` hook with 5s polling
- `src/components/layout/sidebar.tsx` - Added `formatDistanceToNow` + `useSyncStatus`, replaced static text with conditional sync display

## Decisions Made
- `SyncStatus` interface defined locally in `hooks.ts` (not re-exported from `ingest.ts`) to maintain clean client/server boundary — client code should not import server-only modules

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing lint error in `src/app/active/page.tsx` (line 111: setState synchronously within effect) — out of scope for this plan. No errors introduced by this plan's changes. Logged to deferred items.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Complete ingest pipeline (Plan 01) + sync status UI (Plan 02) ready for human verification
- After verification: Phase 06 is complete, pipeline is operational
- Sidebar accurately reflects DB state — users have confidence data is being indexed

---
*Phase: 06-delta-ingest*
*Completed: 2026-03-19*
