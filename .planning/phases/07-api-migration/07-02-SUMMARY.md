---
phase: 07-api-migration
plan: 02
subsystem: api
tags: [sqlite, better-sqlite3, next.js, api-routes, reader, data-source]

# Dependency graph
requires:
  - phase: 07-01
    provides: db-queries.ts with all 6 typed SQLite query functions (getDashboardStatsFromDb, getSessionsFromDb, getProjectsFromDb, etc.)
provides:
  - All 4 historical API routes (stats, sessions, sessions/[id], projects) reading from SQLite in live mode
  - Stats-cache.json machinery fully retired (StatsCache type removed, supplemental stats removed)
  - getDashboardStats() in reader.ts rewritten for imported mode without stats-cache dependency
  - Data-source branching pattern: live=SQLite, imported=JSONL reader
affects: [08-ui-polish, future-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Data-source branching: getActiveDataSource() === 'live' ? dbFunction() : await readerFunction()"
    - "Hybrid session detail: DB aggregates + JSONL messages via getSessionDetailFromDb"
    - "Imported mode fallback: full JSONL scan in getDashboardStats() without stats-cache"

key-files:
  created: []
  modified:
    - src/app/api/stats/route.ts
    - src/app/api/sessions/route.ts
    - src/app/api/sessions/[id]/route.ts
    - src/app/api/projects/route.ts
    - src/lib/claude-data/reader.ts
    - src/lib/claude-data/types.ts

key-decisions:
  - "getDashboardStats() in reader.ts rewritten for imported mode — full JSONL scan, no stats-cache dependency; StatsCache type and supplemental stats machinery removed"

patterns-established:
  - "Data-source branching pattern: check getActiveDataSource(), call synchronous DB function for live or async reader function for imported"
  - "Active sessions API route remains untouched (live JSONL only, not subject to data-source toggle)"

requirements-completed: [API-01, API-02, API-03]

# Metrics
duration: 25min
completed: 2026-03-19
---

# Phase 07 Plan 02: API Migration Summary

**Four historical API routes migrated to SQLite with data-source branching, and stats-cache.json machinery fully retired from reader.ts and types.ts**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-19T17:00:00Z
- **Completed:** 2026-03-19T17:25:41Z
- **Tasks:** 2 (1 auto + 1 human-verify)
- **Files modified:** 6

## Accomplishments

- Migrated `/api/stats`, `/api/sessions`, `/api/sessions/[id]`, `/api/projects` to branch on data source: live=SQLite (synchronous, fast), imported=JSONL reader (async fallback)
- Removed `StatsCache` interface from types.ts and all supplemental stats machinery from reader.ts (`getStatsCache`, `computeSupplementalStats`, `getRecentSessionFiles`, `supplementalCache`, `SUPPLEMENTAL_TTL_MS`)
- Rewrote `getDashboardStats()` in reader.ts for imported mode using full JSONL scan without any stats-cache dependency
- All pages verified via Playwright: 199 sessions, 21,018 messages, 944.6M tokens, $1.8K cost, 20 projects — all correct

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate API routes and clean up stats-cache machinery** - `13752ce` (feat)
2. **Task 2: Verify API migration end-to-end** - human-verify checkpoint, approved by user

**Checkpoint state commit:** `847b4d1` (chore: update STATE.md task 1 complete)

## Files Created/Modified

- `src/app/api/stats/route.ts` - Branches on data source: getDashboardStatsFromDb() for live, getDashboardStats() for imported
- `src/app/api/sessions/route.ts` - Branches on data source for list, project filter, and search paths
- `src/app/api/sessions/[id]/route.ts` - Hybrid: getSessionDetailFromDb() for live (DB aggregates + JSONL messages), getSessionDetail() for imported
- `src/app/api/projects/route.ts` - Branches on data source: getProjectsFromDb() for live, getProjects() for imported
- `src/lib/claude-data/reader.ts` - Removed supplemental stats machinery; getDashboardStats() rewritten for imported mode
- `src/lib/claude-data/types.ts` - StatsCache interface removed

## Decisions Made

- getDashboardStats() for imported mode uses a full JSONL scan (iterates all sessions from getSessions(99999)) — imported datasets are typically smaller so performance is acceptable
- Active sessions route intentionally left untouched (API-02 requirement: active sessions always reads live JSONL regardless of data-source toggle)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - build passed cleanly on first attempt. End-to-end verification confirmed all pages load correctly with no console errors (only 6 pre-existing warnings).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- API migration complete: all historical pages now read from pre-parsed SQLite rows instead of re-scanning JSONL on every request
- Active sessions page behavior is completely unchanged
- Phase 07 (API Migration) is fully complete — both plans executed
- Ready for Phase 08 (UI Polish) or any subsequent phase

---
*Phase: 07-api-migration*
*Completed: 2026-03-19*
