# Phase 8: Portability and UI - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Export/import/merge .db files for cross-machine portability, plus project detail activity chart. Extends the existing /data page with a Database section. No new pages.

</domain>

<decisions>
## Implementation Decisions

### DB Export/Import/Merge UX
- Extend existing `/data` page — add a "Database" section below the JSONL export/import section
- Export: API route streams the .db file as `application/octet-stream` download. Copy to temp file first to avoid locking the live DB.
- Import (replace): stop ingest scheduler, close DB connection, swap the .db file, reinitialize. Show confirmation dialog warning data will be replaced.
- Merge: `INSERT OR REPLACE` where incoming session `message_count > existing` — session with more messages wins dedup. Recompute all aggregate tables after merge. Idempotent — merging same file twice produces identical row count.

### Project Activity Chart
- Recharts BarChart showing daily message/session count for a specific project — similar to overview Usage Over Time but per-project
- Data source: query `daily_activity` table filtered by `project_id` — data already populated by Phase 6 ingest
- Placement: below project stats section on `/projects/[id]` page, before session list
- Time range: last 30 days by default

### ZIP Import → SQLite Bridge
- After successful ZIP import, show "Also import to database?" button on the /data page
- When clicked, run `runIngestCycle()` with the imported data directory path to populate SQLite from the imported JSONL files

### Claude's Discretion
- Exact UI layout of the Database section on /data page (card styling, button placement)
- Whether to show merge preview or just merge directly
- Activity chart toggle (messages vs sessions) or fixed to one metric
- Temp file cleanup timing for export

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 5-7 Foundation
- `src/lib/db.ts` — SQLite singleton with `getDb()`, `createDb()`, `DB_PATH`
- `src/lib/ingest.ts` — `runIngestCycle()`, `startIngestScheduler()`, `getSyncStatus()`, `recomputeAggregates()`
- `src/lib/db-queries.ts` — All typed DB query functions (Phase 7)

### Data Page (to be extended)
- `src/app/data/page.tsx` — Current /data page with JSONL export/import/data-source toggle
- `src/app/api/export/route.ts` — JSONL ZIP export (keep as-is, add DB export alongside)
- `src/app/api/import/route.ts` — JSONL ZIP import (add "import to DB" option after)

### Project Detail (to be extended)
- `src/app/projects/[id]/page.tsx` — Project detail page where activity chart goes
- `src/components/charts/` — Existing chart components (usage-over-time pattern to follow)

### Requirements
- `.planning/REQUIREMENTS.md` — PORT-01, PORT-02, PORT-03, UI-01

### Types
- `src/lib/claude-data/types.ts` — DailyActivity interface for chart data

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/charts/usage-over-time.tsx` — Recharts BarChart/AreaChart pattern to reuse for activity chart
- `src/lib/db-queries.ts` — DB query functions, add `getProjectActivityFromDb()` for chart data
- `src/lib/ingest.ts` — `runIngestCycle(projectsDir)` accepts custom dir for ZIP→SQLite bridge
- `src/lib/hooks.ts` — SWR hooks pattern, add hooks for new API endpoints

### Established Patterns
- `/data` page: Card sections for export, import, data source toggle — follow same card pattern for DB section
- API routes: `force-dynamic`, try-catch, NextResponse.json pattern
- File upload: `/api/import` POST handler with FormData — reuse pattern for DB import

### Integration Points
- `src/app/api/db-export/route.ts` — New API route for .db file download
- `src/app/api/db-import/route.ts` — New API route for .db file upload (replace) and merge
- `src/app/api/projects/[id]/activity/route.ts` — New API route for project activity chart data
- `src/app/data/page.tsx` — Modified to add Database section
- `src/app/projects/[id]/page.tsx` — Modified to add activity chart

</code_context>

<specifics>
## Specific Ideas

- The merge should use `ATTACH DATABASE` to read the uploaded .db and run cross-database INSERT queries — SQLite supports this natively
- Activity chart should match the visual style of the existing Usage Over Time chart (same colors, same card pattern)
- Export filename should include a timestamp: `claud-ometer-2026-03-19.db`

</specifics>

<deferred>
## Deferred Ideas

- **Merge preview** (PORT-04 in v2 requirements) — Show what will be added/updated before committing merge
- **Selective merge** (PORT-05 in v2 requirements) — Choose which projects/sessions to import

</deferred>

---

*Phase: 08-portability-and-ui*
*Context gathered: 2026-03-19*
