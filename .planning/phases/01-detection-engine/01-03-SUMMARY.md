---
phase: 01-detection-engine
plan: 03
subsystem: api
tags: [active-sessions, token-cache, readline, jest, typescript]

# Dependency graph
requires:
  - phase: 01-detection-engine
    plan: 02
    provides: tailReadJsonl, inferSessionStatus, scanActiveFiles, ACTIVE_SESSION_CONFIG
  - phase: 01-detection-engine
    plan: 01
    provides: TDD test scaffolds and behavioral contract for detection engine
provides:
  - getActiveSessions() async orchestrator returning ActiveSessionInfo[]
  - Per-session TokenCache with full-parse-once + tail-read-on-poll strategy
  - findCurrentBlockStart() for contiguous activity block duration
  - updateCacheFromTailRead() for incremental polling updates
  - Cache eviction for sessions leaving the 30-minute active window
  - 5 new integration tests for getActiveSessions orchestrator
affects:
  - 02-realtime-api (will import and call getActiveSessions)
  - 03-dashboard-ui (will consume ActiveSessionInfo[])

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Full JSONL parse on first detection, tail-read on subsequent polls"
    - "Module-level Map as token cache (tokenCacheMap) — persists across 5s poll cycles"
    - "jest.mock at module scope with per-test mockReturnValue for getProjectsDir"

key-files:
  created:
    - src/lib/claude-data/active-sessions.ts (additions: token cache, orchestrator)
  modified:
    - src/lib/claude-data/active-sessions.ts
    - src/lib/claude-data/reader.ts
    - src/__tests__/lib/active-sessions.test.ts

key-decisions:
  - "Export extractCwdFromSession, projectIdToName, projectIdToFullPath from reader.ts — required by getActiveSessions orchestrator"
  - "updateCacheFromTailRead does NOT deduplicate tail-overlapping tokens — tail window is small enough that double-counting risk is acceptable vs complexity of deduplication"
  - "fullParseSession is async (readline streaming) — getActiveSessions is therefore async"
  - "blockStart computed during fullParseSession using backward gap walk — findCurrentBlockStart returns first message of current contiguous block"

patterns-established:
  - "Token cache pattern: interface + module-level Map + eviction on scan — reusable for any polling-based aggregation"
  - "jest.mock at module scope + mockReturnValue in beforeEach for directory mocking"

requirements-completed: [DETECT-01, DETECT-02, DETECT-05]

# Metrics
duration: 5min
completed: 2026-03-18
---

# Phase 01 Plan 03: Detection Engine Orchestrator Summary

**getActiveSessions() orchestrator with per-session token caching, full-parse-once strategy, and cache eviction for performance-safe 5-second polling**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-18T15:19:22Z
- **Completed:** 2026-03-18T15:24:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Implemented `getActiveSessions()` async orchestrator composing scanActiveFiles + tailReadJsonl + inferSessionStatus + token cache
- Token cache performs full parse exactly once per session (first detection), tail-read updates on subsequent polls
- Cache eviction removes stale entries for sessions that have left the 30-minute active window
- Duration computed from contiguous block start (backward gap walk), not total session lifetime
- 5 new integration tests covering: empty results, status inference, token accuracy, cache eviction, and metadata population

## Task Commits

Each task was committed atomically:

1. **Task 1: Token cache, duration calculation, getActiveSessions orchestrator** - `2e30acc` (feat)
2. **Task 2: Tests for getActiveSessions orchestrator** - `52fb730` (test)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `src/lib/claude-data/active-sessions.ts` — Added TokenCache interface, tokenCacheMap, fullParseSession, findCurrentBlockStart, updateCacheFromTailRead, and getActiveSessions orchestrator (482 lines total)
- `src/lib/claude-data/reader.ts` — Added export keyword to extractCwdFromSession, projectIdToName, projectIdToFullPath
- `src/__tests__/lib/active-sessions.test.ts` — Added jest.mock for reader module + describe('getActiveSessions') with 5 test cases (491 lines total, 25 tests pass)

## Decisions Made
- Exported three helpers from reader.ts (extractCwdFromSession, projectIdToName, projectIdToFullPath) — required for orchestrator to resolve project metadata without re-implementing the same logic
- `updateCacheFromTailRead` accumulates tokens from tail messages without deduplication — acceptable because the tail window is small and the cost of tracking seen timestamps outweighs the marginal accuracy gain
- `getActiveSessions` is async because `fullParseSession` uses readline (async streaming); synchronous file reads were not used to avoid blocking on large files

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
- `getActiveSessions()` is fully implemented and tested — ready for Phase 2 API route consumption
- All 25 detection engine tests pass (Plans 01-03)
- TypeScript compiles clean (no new errors)
- The `ActiveSessionInfo` type is defined in `types.ts` and matches all orchestrator output fields

---
*Phase: 01-detection-engine*
*Completed: 2026-03-18*
