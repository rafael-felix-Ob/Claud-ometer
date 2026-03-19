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
    - src/lib/ingest.ts

key-decisions:
  - "SyncStatus interface defined in hooks.ts (not imported from ingest.ts) to keep client/server boundary clean"
  - "Ingest sync state moved to globalThis to survive Next.js module isolation between instrumentation.ts and API route handlers"

patterns-established:
  - "Pattern: API route wrapping ingest module status — force-dynamic + NextResponse.json(getSyncStatus())"
  - "Pattern: Sidebar bottom section has three distinct states: imported, synced, pre-sync/running"
  - "Pattern: Any state shared between instrumentation.ts and API routes must live on globalThis (same class as DB connection singleton)"

requirements-completed: [ING-04, UI-02]

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 06 Plan 02: Sync Status UI Summary

**Sidebar bottom section now shows real-time sync status ("Synced X ago / N sessions in DB") polled every 5 seconds via /api/sync-status endpoint wired to the ingest engine**

## Performance

- **Duration:** ~35 min (including human verification + bug fix)
- **Started:** 2026-03-19T16:09:02Z
- **Completed:** 2026-03-19
- **Tasks:** 3 of 3 (all complete including human-verify checkpoint)
- **Files modified:** 4

## Accomplishments
- Created `/api/sync-status` GET route (force-dynamic, returns `getSyncStatus()` from ingest module)
- Added `SyncStatus` interface and `useSyncStatus()` SWR hook (5s refresh) to `hooks.ts`
- Replaced static sidebar bottom text with three-state dynamic display: synced info, syncing indicator, or fallback
- Fixed critical bug: moved ingest sync state variables to `globalThis` so state survives Next.js module isolation between `instrumentation.ts` and API route handlers
- Human verification confirmed: sidebar shows "Synced less than a minute ago" and "199 sessions in DB" in live mode, `/api/sync-status` returns correct data

## Task Commits

Each task was committed atomically:

1. **Task 1: Create sync-status API route and useSyncStatus hook** - `4195e79` (feat)
2. **Task 2: Add sync status display to sidebar** - `42532d3` (feat)
3. **Task 3: Verify sync status in sidebar** - checkpoint approved; bug fix `1e70b4a` (fix)

**Plan metadata:** `b1dbd16` (docs: complete sync status UI plan)

## Files Created/Modified
- `src/app/api/sync-status/route.ts` - GET endpoint returning sync status JSON (force-dynamic)
- `src/lib/hooks.ts` - Added `SyncStatus` interface and `useSyncStatus()` hook with 5s polling
- `src/components/layout/sidebar.tsx` - Added `formatDistanceToNow` + `useSyncStatus`, replaced static text with conditional sync display
- `src/lib/ingest.ts` - Bug fix: sync state variables moved to `globalThis` singleton to survive module isolation

## Decisions Made
- `SyncStatus` interface defined locally in `hooks.ts` (not re-exported from `ingest.ts`) to maintain clean client/server boundary — client code should not import server-only modules
- Ingest sync state moved to `globalThis` to survive Next.js module isolation — instrumentation.ts and API routes run in separate module instances, so module-level state is not shared between them

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ingest sync state lost due to Next.js module isolation**
- **Found during:** Task 3 (human verification — sidebar showed no sync data)
- **Issue:** Module-level `let` variables (`lastSynced`, `sessionCount`, `isRunning`) in `ingest.ts` were invisible to the `/api/sync-status` route handler. `instrumentation.ts` and API routes load separate module instances in Next.js, so state written by the scheduler was never visible to the API.
- **Fix:** Moved sync state to a `globalThis._ingestState` singleton object, applying the same pattern already established for the DB connection and scheduler in Phase 5/06-01.
- **Files modified:** `src/lib/ingest.ts`
- **Verification:** Playwright confirmed sidebar shows "Synced less than a minute ago" and "199 sessions in DB" after fix
- **Committed in:** `1e70b4a` (fix(06): store ingest sync state on globalThis to survive module isolation)

---

**Total deviations:** 1 auto-fixed (Rule 1 — Bug)
**Impact on plan:** Fix essential for correctness — without it, sync status UI was non-functional. Applies same globalThis pattern already established in this milestone.

## Issues Encountered

Pre-existing lint error in `src/app/active/page.tsx` (line 111: setState synchronously within effect) — out of scope for this plan. No errors introduced by this plan's changes. Logged to deferred items.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 06 (Delta Ingest) fully complete — both plans executed and human-verified
- Ingest pipeline is operational: DB populated on startup, refreshed every 2 minutes, sidebar shows live sync status
- Phase 07 (API Migration) is unblocked: SQLite DB is populated with correct data, ready for historical API routes to read from it instead of JSONL

## Self-Check: PASSED

- FOUND: `.planning/phases/06-delta-ingest/06-02-SUMMARY.md`
- FOUND: commit `4195e79` (Task 1)
- FOUND: commit `42532d3` (Task 2)
- FOUND: commit `1e70b4a` (bug fix)

---
*Phase: 06-delta-ingest*
*Completed: 2026-03-19*
