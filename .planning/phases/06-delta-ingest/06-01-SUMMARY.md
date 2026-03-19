---
phase: 06-delta-ingest
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, ingest, jsonl, delta-detection, tdd, instrumentation]

requires:
  - phase: 05-sqlite-foundation
    provides: SQLite DB schema (sessions, projects, daily_activity, model_usage, ingested_files tables) via getDb/createDb

provides:
  - runIngestCycle: scans JSONL files, applies mtime+size delta check, upserts sessions, recomputes aggregates
  - startIngestScheduler: globalThis-guarded 2-minute interval scheduler
  - getSyncStatus: last sync timestamp, session count, running flag
  - parseSessionFile: now exported from reader.ts for external use
  - instrumentation.ts: Next.js startup hook that triggers the ingest scheduler

affects:
  - 06-02 (API layer that reads from the SQLite DB populated by ingest)
  - 07-history-api (depends on sessions table being populated)
  - 08-history-ui (depends on aggregated tables: projects, daily_activity, model_usage)

tech-stack:
  added: []
  patterns:
    - "globalThis singleton guard prevents duplicate schedulers on hot-reload"
    - "Two-factor delta check (mtime + file size) for efficient incremental ingest"
    - "INSERT OR REPLACE for idempotent session upserts"
    - "Separate transactions for bulk insert vs. aggregate recompute"
    - "_resetSyncStateForTesting export pattern for module-level state in Jest"

key-files:
  created:
    - src/lib/ingest.ts
    - src/instrumentation.ts
    - src/__tests__/lib/ingest.test.ts
  modified:
    - src/lib/claude-data/reader.ts (added export keyword to parseSessionFile — no logic change)

key-decisions:
  - "ingest.ts always reads from live ~/.claude/projects, not getProjectsDir() which respects data source toggle — ingest should always ingest live data"
  - "_resetSyncStateForTesting export added to enable test isolation for module-level state (lastSyncedAt, lastSessionCount)"
  - "recomputeAggregates uses DELETE+INSERT pattern (not UPSERT) for full consistency on each cycle"

patterns-established:
  - "ingest.ts: check globalThis.__claudeometerIngestTimer before setInterval to prevent hot-reload duplication"
  - "ingest.ts: Math.floor(stat.mtimeMs) for integer mtime storage in SQLite"
  - "test pattern: createTestJsonl() helper creates minimal valid JSONL in tmp dir matching ~/.claude/projects/{id}/{session}.jsonl structure"

requirements-completed: [ING-01, ING-02, ING-03]

duration: 17min
completed: 2026-03-19
---

# Phase 06 Plan 01: Delta Ingest Engine Summary

**Ingest engine with two-factor delta detection (mtime+size), INSERT OR REPLACE session upserts, aggregate recompute (projects/daily_activity/model_usage), and globalThis-guarded scheduler started via instrumentation.ts**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-19T15:48:34Z
- **Completed:** 2026-03-19T16:05:52Z
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- Exported `parseSessionFile` from reader.ts for use by the ingest engine (one-word change, no logic changes)
- Built `src/lib/ingest.ts` with `runIngestCycle`, `startIngestScheduler`, `getSyncStatus`, and `recomputeAggregates`
- Created `src/instrumentation.ts` as the Next.js single-startup hook that launches the scheduler in Node.js runtime only
- 9 unit tests covering: scheduler dedup, delta skip, re-ingest on change, bulk import, idempotency, project aggregates, daily_activity aggregates, getSyncStatus before/after cycle — all pass GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Export parseSessionFile and create ingest test scaffold** - `ea68e08` (test)
2. **Task 2: Implement ingest engine (GREEN phase)** - `2c14bc2` (feat)

## Files Created/Modified

- `src/lib/ingest.ts` — core ingest engine: runIngestCycle, startIngestScheduler, getSyncStatus, recomputeAggregates, getProjectName helper
- `src/instrumentation.ts` — Next.js instrumentation hook, starts scheduler on Node.js server startup
- `src/__tests__/lib/ingest.test.ts` — 9 unit tests covering ING-01..ING-03
- `src/lib/claude-data/reader.ts` — added `export` keyword to `parseSessionFile` (line 206 only)

## Decisions Made

- `runIngestCycle` always reads from live `~/.claude/projects` as default, not `getProjectsDir()` which would respect the data source toggle — ingest should always operate on live data regardless of the UI's data source setting
- Added `_resetSyncStateForTesting()` export to handle module-level state isolation in Jest (module is cached across tests in a test suite)
- `recomputeAggregates` uses DELETE+INSERT per cycle rather than UPSERT — guarantees full consistency at the cost of slightly more I/O (acceptable for ~2-min cycles)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Module-level sync state not reset between tests**
- **Found during:** Task 2 (GREEN phase — first test run)
- **Issue:** `lastSyncedAt` is module-level state; Jest caches the module, so `getSyncStatus()` returned a non-null value even in a fresh-looking test
- **Fix:** Added `_resetSyncStateForTesting()` export to ingest.ts; called in test `beforeEach`
- **Files modified:** src/lib/ingest.ts, src/__tests__/lib/ingest.test.ts
- **Verification:** "returns null lastSynced before first cycle" test passes after fix
- **Committed in:** `2c14bc2` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Auto-fix was required for test correctness. No scope creep.

## Issues Encountered

None beyond the auto-fixed test isolation issue above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `src/lib/ingest.ts` is ready for phase 06-02 which will expose sync status and ingest control via API routes
- Sessions table will be populated on first server startup via instrumentation.ts
- All aggregate tables (projects, daily_activity, model_usage) are populated and ready for phase 07-08 history UI

## Self-Check: PASSED

All files verified present. All commits verified in git log.
