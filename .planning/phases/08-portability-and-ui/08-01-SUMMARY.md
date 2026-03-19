---
phase: 08-portability-and-ui
plan: 01
subsystem: api
tags: [sqlite, better-sqlite3, db-export, db-import, merge, wal-checkpoint, tdd]

# Dependency graph
requires:
  - phase: 07-api-migration
    provides: db-queries.ts query patterns, ingest.ts scheduler, DB schema with daily_activity(project_id)
provides:
  - recomputeAggregates exported from ingest.ts
  - stopIngestScheduler exported from ingest.ts
  - getProjectActivityFromDb query in db-queries.ts
  - useProjectActivity SWR hook in hooks.ts
  - GET /api/db-export — WAL-safe SQLite file download
  - POST /api/db-import (mode=replace) — singleton lifecycle DB swap
  - POST /api/db-import (mode=merge) — ATTACH DATABASE message_count dedup
  - GET /api/projects/[id]/activity — per-project daily activity for charts
affects:
  - 08-02 (portability UI — all four endpoints consumed by frontend)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - WAL checkpoint before DB copy for safe export
    - ATTACH DATABASE with main.sessions qualified JOIN for merge dedup
    - stopIngestScheduler + close singleton + clean WAL/SHM + createDb for replace lifecycle
    - recomputeAggregates called after merge to rebuild all aggregate tables

key-files:
  created:
    - src/app/api/db-export/route.ts
    - src/app/api/db-import/route.ts
    - src/app/api/projects/[id]/activity/route.ts
    - src/__tests__/lib/db-export.test.ts
    - src/__tests__/lib/db-import.test.ts
  modified:
    - src/lib/ingest.ts
    - src/lib/db-queries.ts
    - src/lib/hooks.ts
    - src/__tests__/lib/db-queries.test.ts

key-decisions:
  - "Merge SQL uses main.sessions qualified JOIN to avoid 'ambiguous column name' error with ATTACH DATABASE"
  - "recomputeAggregates changed from private to exported — required by db-import merge handler"
  - "stopIngestScheduler placed before startIngestScheduler in ingest.ts for logical ordering"
  - "getProjectActivityFromDb is synchronous (not async) — better-sqlite3 is synchronous"
  - "Test dates use Date.now() offsets instead of fixed 2024 dates to survive 30-day window filter"

patterns-established:
  - "ATTACH DATABASE pattern: always qualify JOIN with main.sessions to avoid ambiguity"
  - "DB replace order: stopIngestScheduler -> close DB -> delete WAL/SHM -> write file -> createDb -> startIngestScheduler"
  - "Test seeding: use Date.now() - N*86400000 for dates that must pass within time-window queries"

requirements-completed: [PORT-01, PORT-02, PORT-03, UI-01]

# Metrics
duration: 11min
completed: 2026-03-19
---

# Phase 08 Plan 01: DB Portability Backend Summary

**Three new API routes (db-export, db-import with replace/merge, project activity) backed by WAL-safe copy, ATTACH DATABASE merge dedup, and singleton lifecycle management**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-19T19:42:59Z
- **Completed:** 2026-03-19T19:53:59Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Exported `recomputeAggregates` and added `stopIngestScheduler` to ingest.ts for DB import lifecycle management
- Added `getProjectActivityFromDb` synchronous query with 30-day window filter and project-scoped filtering
- Added `useProjectActivity` SWR hook for Plan 02 frontend consumption
- Created 43 tests across 3 new/extended test files covering export validity, replace lifecycle, merge dedup, idempotency, and activity query filtering
- All three API routes compile cleanly and are accessible (confirmed via `npm run build`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Export ingest helpers, add activity query, create tests** - `7469a4e` (feat)
2. **Task 2: Create DB export, import, merge, and activity API routes** - `b0a2904` (feat)

## Files Created/Modified

- `src/lib/ingest.ts` — Added `export` to `recomputeAggregates`, added new `stopIngestScheduler` export
- `src/lib/db-queries.ts` — Added `getProjectActivityFromDb(projectId, days=30)` query function
- `src/lib/hooks.ts` — Added `useProjectActivity(projectId)` SWR hook
- `src/app/api/db-export/route.ts` — GET endpoint: wal_checkpoint(TRUNCATE) + copyFileSync + stream buffer
- `src/app/api/db-import/route.ts` — POST endpoint: replace (singleton lifecycle) and merge (ATTACH DATABASE dedup)
- `src/app/api/projects/[id]/activity/route.ts` — GET endpoint: per-project daily activity array
- `src/__tests__/lib/db-export.test.ts` — WAL checkpoint export tests (4 cases)
- `src/__tests__/lib/db-import.test.ts` — Replace lifecycle + merge dedup + stopIngestScheduler tests (11+ cases)
- `src/__tests__/lib/db-queries.test.ts` — Extended with getProjectActivityFromDb tests (4 cases)

## Decisions Made

- Merge SQL requires `main.sessions` qualification in the LEFT JOIN ON clause to avoid "ambiguous column name" SQLite error when both databases have a `sessions` table
- `recomputeAggregates` promoted from private to exported because the merge handler in the API route needs to rebuild aggregates after merging sessions
- Tests use `Date.now() - N * 86400000` for seed timestamps instead of hardcoded 2024 dates to ensure they pass within the 30-day window query filter

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ATTACH DATABASE ambiguous column error in merge SQL**
- **Found during:** Task 1 (writing db-import tests)
- **Issue:** `LEFT JOIN sessions ON sessions.id = src.sessions.id` causes "ambiguous column name: sessions.id" when both `main.sessions` and `src.sessions` exist
- **Fix:** Qualified all unambiguous references as `main.sessions.id` in the JOIN ON clause and WHERE clause
- **Files modified:** src/__tests__/lib/db-import.test.ts, src/app/api/db-import/route.ts
- **Verification:** All merge tests pass (43/43)
- **Committed in:** 7469a4e and b0a2904

**2. [Rule 1 - Bug] Fixed hardcoded 2024 test dates failing 30-day window filter**
- **Found during:** Task 1 (running db-queries tests)
- **Issue:** Tests seeded sessions with `2024-03-15` timestamps; `getProjectActivityFromDb` filters `date >= 30 days ago`, so all 2024 dates were excluded
- **Fix:** Changed test seed timestamps to use `Date.now() - N * 24 * 60 * 60 * 1000` relative dates
- **Files modified:** src/__tests__/lib/db-queries.test.ts, src/__tests__/lib/db-import.test.ts
- **Verification:** Activity query tests pass with correct counts
- **Committed in:** 7469a4e

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs)
**Impact on plan:** Both auto-fixes required for correctness. No scope creep.

## Issues Encountered

None beyond the two auto-fixed bugs above.

## Next Phase Readiness

- All backend APIs for Plan 02's portability UI are ready
- `/api/db-export` and `/api/db-import` (replace + merge) provide the full DB portability surface
- `/api/projects/[id]/activity` provides data for the per-project activity chart
- `useProjectActivity` hook is wired and ready to use in project detail pages

---
*Phase: 08-portability-and-ui*
*Completed: 2026-03-19*
