---
phase: 05-sqlite-foundation
plan: 01
subsystem: database
tags: [better-sqlite3, sqlite, wal, singleton, schema, next.js]

# Dependency graph
requires: []
provides:
  - "SQLite singleton connection via getDb() and createDb()"
  - "Full 5-table schema: sessions, projects, daily_activity, model_usage, ingested_files"
  - "WAL mode + performance pragmas + 3 indexes"
  - "DB_PATH constant resolving to ~/.claude/claud-ometer.db (Linux ext4)"
  - "better-sqlite3 installed and excluded from Next.js bundling"
affects: [06-ingest, 07-api-migration, 08-portability]

# Tech tracking
tech-stack:
  added: [better-sqlite3@12.8.0, "@types/better-sqlite3@7.6.13"]
  patterns:
    - "globalThis singleton to prevent hot-reload DB duplication"
    - "createDb(path) exported for testability with custom paths"
    - "serverExternalPackages in next.config.ts to exclude native .node addons from bundling"

key-files:
  created:
    - src/lib/db.ts
    - src/__tests__/lib/db.test.ts
  modified:
    - package.json
    - package-lock.json
    - next.config.ts

key-decisions:
  - "createDb() exported separately from getDb() for test isolation without polluting ~/.claude/"
  - "eslint-disable for no-var removed — rule not configured in project, comment was flagged as unused"
  - "DB_PATH uses os.homedir() following existing data-source.ts pattern"

patterns-established:
  - "TDD pattern: write test importing module (RED) → implement module (GREEN)"
  - "globalThis.__claudeometerDb as singleton storage key for Next.js hot-reload safety"

requirements-completed: [DB-01, DB-02, DB-03, DB-04, DB-05]

# Metrics
duration: 11min
completed: 2026-03-19
---

# Phase 05 Plan 01: SQLite Foundation Summary

**better-sqlite3 singleton with WAL mode, 5-table schema (sessions/projects/daily_activity/model_usage/ingested_files), 3 indexes, and production build verified**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-03-19T14:58:09Z
- **Completed:** 2026-03-19T15:09:35Z
- **Tasks:** 3 (Task 2 had 2 TDD commits: RED + GREEN)
- **Files modified:** 5

## Accomplishments
- better-sqlite3 installed and Next.js configured to exclude native .node addon from bundling
- `src/lib/db.ts` created with `getDb()` singleton, `createDb(path)` testability hook, WAL mode, 6 pragmas, and full 5-table schema
- 11 TDD tests covering DB-01 through DB-05 (WAL mode, Database instance, all tables, singleton, Linux path)
- Production build verified: exit 0, no `Module not found: better_sqlite3.node` errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install better-sqlite3 and update build config** - `e379db5` (chore)
2. **Task 2 RED: Failing tests for db module** - `fc6878f` (test)
3. **Task 2 GREEN: Implement db.ts** - `decbe7d` (feat)
4. **Task 3: Verify production build and lint fix** - `3b59a55` (chore)

_Note: TDD task 2 has separate RED and GREEN commits per TDD protocol_

## Files Created/Modified
- `src/lib/db.ts` - SQLite singleton module: getDb(), createDb(), DB_PATH, schema creation
- `src/__tests__/lib/db.test.ts` - 11 tests covering all DB-01 through DB-05 requirements
- `package.json` - Added better-sqlite3 dependency, @types/better-sqlite3 devDependency
- `package-lock.json` - Lock file updated
- `next.config.ts` - Added serverExternalPackages: ['better-sqlite3']

## Decisions Made
- `createDb(dbPath)` exported separately from `getDb()` so tests can pass a tmpdir path instead of the real `~/.claude/claud-ometer.db`. This keeps test isolation clean without mocking os.homedir().
- Removed `// eslint-disable-next-line no-var` from the `declare global` block — the no-var rule isn't configured in this project's ESLint, making the disable comment itself a warning. Simply removed it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused eslint-disable directive in db.ts**
- **Found during:** Task 3 (lint verification)
- **Issue:** Plan specified `// eslint-disable-next-line no-var` above the `var __claudeometerDb` declaration, but the no-var rule is not configured in this project's ESLint. ESLint flagged the disable comment itself as an unused directive warning.
- **Fix:** Removed the eslint-disable comment; no functional change.
- **Files modified:** src/lib/db.ts
- **Verification:** `npm run lint` no longer reports any db.ts issues
- **Committed in:** 3b59a55 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (lint cleanup)
**Impact on plan:** Trivial cleanup, no scope creep. Functional behavior unchanged.

## Issues Encountered
- Jest 30 changed the flag name from `--testPathPattern` to `--testPathPatterns`. Updated test commands accordingly.

## User Setup Required
None - no external service configuration required. DB file will be created automatically at `~/.claude/claud-ometer.db` on first `getDb()` call.

## Next Phase Readiness
- `getDb()` and `createDb()` are ready for Phase 6 (ingest) to import and start writing session data
- All 5 tables are correctly structured with the columns ingest will need
- WAL mode ensures concurrent reads from Next.js won't block writes from the ingest scheduler
- No existing files were modified (reader.ts, types.ts, data-source.ts untouched)

---
*Phase: 05-sqlite-foundation*
*Completed: 2026-03-19*
