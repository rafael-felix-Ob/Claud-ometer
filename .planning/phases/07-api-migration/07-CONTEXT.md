# Phase 7: API Migration - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate all historical API routes to read from SQLite instead of JSONL. Active sessions page stays on live JSONL. Session detail uses hybrid approach (DB aggregates + JSONL messages). Retire stats-cache.json. No new features, no UI changes beyond data source.

</domain>

<decisions>
## Implementation Decisions

### API Route Migration Strategy
- New `src/lib/db-queries.ts` module with typed query functions matching existing reader.ts signatures (getDashboardStatsFromDb, getSessionsFromDb, getProjectsFromDb, etc.)
- No JSONL fallback on empty DB — if DB is empty, routes return empty/zero state. Ingest (Phase 6) handles population.
- Session detail hybrid: route reads aggregates (tokens, cost, duration, metadata) from `sessions` table, then reads messages from JSONL via existing `getSessionDetail()` in reader.ts
- Data-source toggle integration: when in imported mode, continue using JSONL reads (reader.ts). Only use SQLite queries when in live mode. Routes check `getActiveDataSource()` and branch accordingly.

### stats-cache.json Retirement
- Remove stats-cache.json reading code from `/api/stats` route — DB replaces it entirely
- Remove the supplemental stats mechanism (StatsCache merging) — DB is always up to date via ingest
- Remove `StatsCache` type and related supplemental types from `types.ts` — clean up dead code
- Remove `getStatsCache()` function from reader.ts

### Correctness Validation
- Automated test that calls both DB and JSONL paths and compares response shapes/totals at aggregate level
- Compare: session counts, total tokens, total cost, project counts. Accept small floating-point differences in cost calculations.
- Skip exact message content comparison — messages still come from JSONL in both paths

### Claude's Discretion
- Exact SQL query structure and optimization (indexes already exist from Phase 5)
- How to compute DashboardStats fields (dailyActivity, dailyModelTokens, hourCounts) from DB tables
- Whether to create a db-queries.test.ts for unit tests or rely on integration tests via API routes
- Order of route migration (can parallelize since routes are independent)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 & 6 Foundation
- `src/lib/db.ts` — SQLite singleton, schema with 5 tables (sessions, projects, daily_activity, model_usage, ingested_files)
- `src/lib/ingest.ts` — Ingest engine that populates DB from JSONL, recompute aggregates logic

### API Routes (to be migrated)
- `src/app/api/stats/route.ts` — GET DashboardStats (overview page)
- `src/app/api/sessions/route.ts` — GET SessionInfo[] with search, pagination
- `src/app/api/sessions/[id]/route.ts` — GET SessionDetail (hybrid: DB aggregates + JSONL messages)
- `src/app/api/projects/route.ts` — GET ProjectInfo[]

### Unchanged Routes (do NOT modify)
- `src/app/api/active-sessions/route.ts` — Stays on live JSONL (API-02)
- `src/app/api/data-source/route.ts` — Toggle mechanism stays as-is
- `src/app/api/export/route.ts` — JSONL ZIP export stays as-is
- `src/app/api/import/route.ts` — JSONL ZIP import stays as-is

### Types and Data Layer
- `src/lib/claude-data/types.ts` — All interfaces (SessionInfo, ProjectInfo, DashboardStats) — DB queries must return these exact shapes
- `src/lib/claude-data/reader.ts` — Still used for: imported mode reads, session detail messages, active sessions
- `src/lib/claude-data/data-source.ts` — `getActiveDataSource()` for live vs imported branching

### Requirements
- `.planning/REQUIREMENTS.md` — API-01, API-02, API-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/db.ts`: `getDb()` for all DB queries
- `src/lib/claude-data/reader.ts`: `getDashboardStats()`, `getSessions()`, `getProjects()`, `getSessionDetail()` — the JSONL-based functions being replaced (but still used in imported mode)
- `src/lib/claude-data/data-source.ts`: `getActiveDataSource()` to branch between DB and JSONL paths
- `src/config/pricing.ts`: `calculateCost()`, `getModelDisplayName()` — may be needed for DB query result formatting

### Established Patterns
- `force-dynamic` on all API routes — continue this pattern
- Defensive data access (`|| []`, `|| {}`) — apply to DB row parsing
- SWR hooks in `src/lib/hooks.ts` — no changes needed (hooks call same API endpoints)

### Integration Points
- `src/lib/db-queries.ts`: New file — typed query functions for all DB reads
- Each API route: Modified to check data source and branch between db-queries.ts and reader.ts
- `src/lib/claude-data/types.ts`: Modified to remove StatsCache and supplemental types
- `src/lib/claude-data/reader.ts`: Modified to remove getStatsCache() and supplemental stats code

</code_context>

<specifics>
## Specific Ideas

- The costs page reads from `/api/stats` — same migration handles both overview and costs
- Session search (`?q=` param) needs a DB-backed implementation — likely `LIKE` query on session fields or a simple text search
- The `recentSessions` field in DashboardStats should be a simple `ORDER BY timestamp DESC LIMIT 10` from DB

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-api-migration*
*Context gathered: 2026-03-19*
