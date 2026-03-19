# Phase 6: Delta Ingest - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

A background job that populates the database from JSONL files on startup and every 2 minutes, skipping unchanged files via two-factor delta check, with sync status visible in the sidebar. No API migration (Phase 7), no DB export/import (Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Ingest Scheduler Architecture
- Scheduler starts in `instrumentation.ts` — Next.js single-startup hook, prevents duplicate schedulers
- New `src/lib/ingest.ts` module reuses `parseSessionFile` logic from `reader.ts` (import and call it) — avoids duplicating 200+ lines of JSONL parsing
- Prevent multiple scheduler instances on hot-reload via `globalThis.__claudeometerIngestTimer` guard — same pattern as DB singleton
- Ingest cycle runs every 2 minutes (120000ms) — also runs once on startup before first interval

### Sidebar Sync Status UI
- New `/api/sync-status` GET endpoint returning `{ lastSynced: string, sessionCount: number, isRunning: boolean }`
- Sync status displays in sidebar bottom section — replaces "Reading from ~/.claude/" text with "Synced Xs ago · N sessions" when in live mode
- Relative time display ("Synced 30s ago") updating on SWR refresh (5-second interval matches existing sidebar polling)
- Hide sync status in imported mode — imported data doesn't use SQLite (per Phase 5 decision)

### Delta Check & Idempotency
- Two-factor delta check: compare `fs.statSync().mtimeMs` + `size` against `ingested_files` table — skip file if both match
- Re-ingest strategy: `INSERT OR REPLACE` on sessions table (session UUID PK handles dedup) + recalculate aggregate tables
- Bulk import on first run: wrap entire import in a single transaction for atomicity — then update `ingested_files` for each file
- Aggregate tables (projects, daily_activity, model_usage): recompute from sessions table after each ingest cycle using SQL GROUP BY — simple and always consistent

### Claude's Discretion
- Exact error handling for failed individual file parses (skip and continue vs abort cycle)
- Whether to add a "Sync now" button or keep it purely automatic
- Logging strategy for ingest cycles (console.log summary vs silent)
- Whether parseSessionFile needs adaptation or can be called directly

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5 Foundation (just built)
- `src/lib/db.ts` — SQLite singleton with `getDb()`, `createDb()`, `DB_PATH`, full 5-table schema including `ingested_files` table
- `src/__tests__/lib/db.test.ts` — 11 tests covering DB-01 through DB-05

### JSONL Parsing (do not modify)
- `src/lib/claude-data/reader.ts` — `parseSessionFile()`, `forEachJsonlLine()`, `getProjectsDir()` — the parsing logic to reuse for ingest
- `src/lib/claude-data/types.ts` — SessionInfo, ProjectInfo, DashboardStats interfaces that DB rows must match
- `src/lib/claude-data/data-source.ts` — `getActiveDataSource()` to check live vs imported mode

### Requirements
- `.planning/REQUIREMENTS.md` — ING-01 through ING-04, UI-02

### Sidebar (will be modified)
- `src/components/layout/sidebar.tsx` — Current sidebar with bottom section showing "Reading from ~/.claude/" — this is where sync status goes

### Architecture
- `.planning/PROJECT.md` — Key decisions: globalThis singleton, instrumentation.ts for scheduler
- `.planning/codebase/ARCHITECTURE.md` — Three-tier architecture, SWR data flow pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/claude-data/reader.ts`: `parseSessionFile()` returns `SessionInfo` — can be imported directly by ingest module to parse JSONL files into DB rows
- `src/lib/claude-data/reader.ts`: `getProjectsDir()` returns the JSONL files directory
- `src/lib/claude-data/data-source.ts`: `getActiveDataSource()` returns 'live' or 'imported' — used to hide sync status in imported mode
- `src/lib/db.ts`: `getDb()` returns singleton Database instance — ingest writes to this
- `src/config/pricing.ts`: `calculateCost()` — if cost needs recalculation during ingest

### Established Patterns
- `globalThis` singleton: Already used for DB (`__claudeometerDb`) — scheduler uses same pattern (`__claudeometerIngestTimer`)
- SWR polling: Sidebar already polls `/api/data-source` every 5s — sync status uses same pattern
- `force-dynamic` API routes: New `/api/sync-status` follows same pattern
- Sidebar bottom section: Currently shows data source info — sync status replaces this in live mode

### Integration Points
- `src/instrumentation.ts`: New file — Next.js startup hook that triggers first ingest and starts scheduler
- `src/lib/ingest.ts`: New file — ingest logic (scan, delta check, parse, write to DB, recompute aggregates)
- `src/app/api/sync-status/route.ts`: New API route — returns sync metadata for sidebar
- `src/components/layout/sidebar.tsx`: Modified — adds sync status display in bottom section
- `src/lib/hooks.ts`: Modified — add `useSyncStatus()` SWR hook

</integration_points>

</code_context>

<specifics>
## Specific Ideas

- The `ingested_files` table schema is already created by Phase 5 with `file_path TEXT PRIMARY KEY, mtime INTEGER, file_size INTEGER, ingested_at TEXT` — ingest just needs to read and write to it
- Sidebar sync status should feel like the existing "Imported" badge — subtle, informational, not attention-grabbing
- First-run bulk import should be fast enough for ~1000 JSONL files (typical user) — single transaction helps

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-delta-ingest*
*Context gathered: 2026-03-19*
