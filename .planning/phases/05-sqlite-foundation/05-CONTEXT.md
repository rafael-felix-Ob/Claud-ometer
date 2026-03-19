# Phase 5: SQLite Foundation - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

A working SQLite connection with correct schema, WAL mode enabled, and the DB file confirmed on Linux ext4 — all architectural decisions locked in before any data is written. No ingest, no API migration, no UI changes. Pure foundation.

</domain>

<decisions>
## Implementation Decisions

### DB Access Approach
- Use `better-sqlite3` directly — no ORM (not Drizzle, not Prisma)
- Synchronous API, already on Next.js `serverExternalPackages` allowlist
- DB-02 requirement in REQUIREMENTS.md must be updated to match (remove Drizzle reference)
- Reuse existing TypeScript types from `types.ts` (SessionInfo, ProjectInfo, etc.) — cast query results to these interfaces
- Thin wrapper in `src/lib/db.ts` with typed helper functions (getDb, ensureSchema, etc.)

### Schema Design
- 5 tables: `sessions`, `projects`, `daily_activity`, `model_usage`, `ingested_files`
- `sessions` table: use session UUID (SessionInfo.id) as TEXT PRIMARY KEY — natural dedup key for Phase 8 merge
- `daily_activity` table: include `project_id` column — required by Phase 8 per-project activity chart. Rows are per-project-per-day.
- Complex fields (toolsUsed, models, compaction) stored as JSON text columns — use JSON.parse() on read
- `model_usage` table: one row per model globally (matches DashboardStats.modelUsage shape)
- `ingested_files` table: tracks mtime + file size for delta sync in Phase 6

### Startup & Initialization
- Lazy init on first query via `getDb()` function — creates connection on first call, caches in `globalThis.__claudeometerDb`
- No `instrumentation.ts` needed for Phase 5 — Phase 6 adds scheduler there later
- Schema creation via `CREATE TABLE IF NOT EXISTS` statements — no migration system
- If schema evolves later, use ALTER TABLE statements guarded by a version check
- DB file path: `~/.claude/claud-ometer.db` (Linux ext4, not NTFS via WSL)
- WAL mode enabled on connection open: `PRAGMA journal_mode=WAL`

### Data Source Integration
- Phase 5 DB module ignores the data-source toggle entirely — no awareness of live vs imported mode
- Phase 7 will wire API routes to read from DB when in live mode
- `stats-cache.json` mechanism to be retired after Phase 7 (DB replaces it)
- DB module lives at `src/lib/db.ts` — clean separation from `claude-data/` (JSONL reading)

### Claude's Discretion
- Exact column types and indexes (researcher/planner can optimize)
- Error handling approach for DB connection failures
- Whether to add PRAGMA statements beyond WAL (e.g., foreign_keys, busy_timeout)
- Internal structure of db.ts (single file vs helper functions)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Decisions
- `.planning/PROJECT.md` — Key Decisions table with SQLite architecture choices (better-sqlite3, globalThis singleton, two-path data access, DB file placement)
- `.planning/REQUIREMENTS.md` — DB-01 through DB-05 requirements (note: DB-02 being updated to remove Drizzle reference)
- `.planning/STATE.md` — Blockers/Concerns section with Phase 5 specific flags

### Existing Code (do not modify)
- `src/lib/claude-data/reader.ts` — MUST NOT be modified (active sessions depend on it)
- `src/lib/claude-data/types.ts` — All TypeScript interfaces that DB queries must return (SessionInfo, ProjectInfo, DashboardStats, etc.)
- `src/lib/claude-data/data-source.ts` — Data source toggle; Phase 5 does not interact with this

### Build Configuration
- `next.config.ts` — Currently empty; needs `serverExternalPackages: ['better-sqlite3']`
- `package.json` — Needs `better-sqlite3` added to dependencies

### Codebase Context
- `.planning/codebase/ARCHITECTURE.md` — Three-tier architecture, data flow patterns
- `.planning/codebase/CONVENTIONS.md` — Naming, module design, error handling patterns
- `.planning/codebase/STACK.md` — Current dependency inventory

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/claude-data/types.ts`: All interfaces (SessionInfo, ProjectInfo, DashboardStats, CompactionInfo, ModelUsage) — DB queries return these same shapes
- `src/lib/claude-data/data-source.ts`: `getClaudeDir()` returns the active data directory — useful for deriving DB file path
- `src/config/pricing.ts`: `calculateCost()`, model pricing — may be needed if DB stores cost data

### Established Patterns
- `globalThis` singleton: Already decided for DB connection, consistent with Next.js hot-reload patterns
- `force-dynamic` API routes: All routes read fresh data — DB queries will follow this same pattern
- Defensive data access: Guard optional fields with `|| []` and `|| {}` — apply same pattern to DB row parsing
- Error handling: try-catch with console.error and 500 response — DB errors should follow same pattern

### Integration Points
- `next.config.ts`: Must add `serverExternalPackages: ['better-sqlite3']` for native module bundling
- `package.json`: Must add `better-sqlite3` dependency
- `src/lib/db.ts`: New file — API routes will import `getDb()` starting in Phase 7
- No existing code is modified in Phase 5 — this phase only adds new files and config

</code_context>

<specifics>
## Specific Ideas

- ZIP import should offer option to ingest imported JSONL data into SQLite — captured as deferred idea for Phase 8 (Portability)
- DB file at `~/.claude/claud-ometer.db` specifically to avoid NTFS WAL locking issues in WSL2

</specifics>

<deferred>
## Deferred Ideas

- **ZIP import → SQLite ingest option** — When importing a ZIP with JSONL files, offer to also ingest them into the SQLite database. Belongs in Phase 8 (Portability) alongside the .db file import/merge features.
- **Per-model-per-day granularity** — model_usage could be per-day for richer cost trend analytics. Could be added later if needed for advanced analytics (v2 ANAL-01/ANAL-02 requirements).

</deferred>

---

*Phase: 05-sqlite-foundation*
*Context gathered: 2026-03-19*
