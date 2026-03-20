---
phase: quick-260320-els
plan: 01
subsystem: active-sessions
tags: [lsof, process-detection, active-sessions, ui]

requires:
  - phase: none
    provides: existing active-sessions module
provides:
  - lsof-based process detection for active sessions (detectOpenJsonlFiles)
  - hasRunningProcess field on ActiveSessionInfo
  - Split UI with Active vs Recently Active sections
affects: [active-sessions, api-active-sessions]

tech-stack:
  added: []
  patterns: [lsof +D for file descriptor detection, graceful fallback when system tool unavailable]

key-files:
  created: []
  modified:
    - src/lib/claude-data/active-sessions.ts
    - src/lib/claude-data/types.ts
    - src/app/active/page.tsx
    - src/__tests__/lib/active-sessions.test.ts

key-decisions:
  - "detectOpenJsonlFiles returns { openFiles, lsofWorked } tuple for graceful fallback detection"
  - "When lsof unavailable, all sessions default to hasRunningProcess=true (no regression)"
  - "Recently Active section collapsed by default with opacity-60 when expanded"

patterns-established:
  - "Process detection graceful fallback: when system tool unavailable, assume permissive defaults"

requirements-completed: [ELS-01]

duration: 5min
completed: 2026-03-20
---

# Quick Task 260320-els: Improve Active Session Detection Summary

**lsof-based process detection to filter stale sessions from active view, with collapsible Recently Active section**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-20T10:37:12Z
- **Completed:** 2026-03-20T10:42:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added detectOpenJsonlFiles() using lsof +D to identify JSONL files with open file descriptors from running Claude Code processes
- Added hasRunningProcess boolean field to ActiveSessionInfo interface with graceful fallback when lsof is unavailable
- Split active sessions page into Active (process-backed) and Recently Active (collapsible, collapsed by default) sections
- Active Now stat card count now only reflects sessions with running processes
- All 31 tests pass including 6 new tests for process detection

## Task Commits

Each task was committed atomically:

1. **Task 1: Add process detection and hasRunningProcess to active session pipeline** - `7f19be6` (feat, TDD)
2. **Task 2: Split active sessions UI into Active vs Recently Active sections** - `2d9fb83` (feat)

## Files Created/Modified
- `src/lib/claude-data/types.ts` - Added hasRunningProcess field to ActiveSessionInfo
- `src/lib/claude-data/active-sessions.ts` - Added detectOpenJsonlFiles() and wired hasRunningProcess into getActiveSessions()
- `src/app/active/page.tsx` - Split UI into Active and Recently Active sections with collapsible toggle
- `src/__tests__/lib/active-sessions.test.ts` - Added 6 new tests for process detection and hasRunningProcess integration

## Decisions Made
- detectOpenJsonlFiles returns `{ openFiles, lsofWorked }` tuple instead of just Set, enabling the caller to distinguish "lsof found nothing" from "lsof unavailable"
- When lsof is unavailable, hasRunningProcess defaults to true for all sessions (preserves current behavior, no regression)
- SessionCard extracted as a reusable component shared between Active and Recently Active sections
- Recently Active section uses opacity-60 when expanded to visually de-emphasize stale sessions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertions updated for tuple return type**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan specified detectOpenJsonlFiles returning Set<string>, but implementation uses { openFiles, lsofWorked } tuple for graceful fallback detection
- **Fix:** Updated unit test assertions to destructure tuple return value
- **Files modified:** src/__tests__/lib/active-sessions.test.ts
- **Verification:** All 31 tests pass
- **Committed in:** 7f19be6 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor API shape change for better fallback semantics. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

---
*Phase: quick-260320-els*
*Completed: 2026-03-20*
