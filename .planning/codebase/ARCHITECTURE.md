# Architecture

**Analysis Date:** 2025-03-17

## Pattern Overview

**Overall:** Server-side filesystem reader with client-side data visualization

**Key Characteristics:**
- Local-first: Reads Claude Code JSONL data directly from `~/.claude/` filesystem (or imported ZIP)
- Serverless API routes: All routes are `force-dynamic` (no caching, fresh reads on every request)
- Client-driven UI: React components use SWR for data fetching with auto-revalidation
- No external dependencies: No database, no cloud, no authentication
- Three-tier separation: Filesystem reader → API routes → React pages

## Layers

**Filesystem Reader Layer:**
- Purpose: Parse JSONL files from `~/.claude/projects/` and compute aggregated statistics
- Location: `src/lib/claude-data/`
- Contains: JSONL parsing, session aggregation, search indexing, cost calculation
- Depends on: Node.js `fs`, `readline`, pricing config
- Used by: All API routes

**API Layer:**
- Purpose: HTTP endpoints that delegate to filesystem reader and return JSON
- Location: `src/app/api/`
- Contains: Route handlers marked `export const dynamic = 'force-dynamic'`
- Depends on: Filesystem reader layer
- Used by: Client-side SWR hooks and pages

**UI Layer:**
- Purpose: React components and pages that fetch data via SWR and render charts/tables
- Location: `src/app/`, `src/components/`
- Contains: `'use client'` pages, presentational components, SWR hooks
- Depends on: API routes, formatting utilities, UI component library
- Used by: Browser clients

**Layout & Navigation:**
- Purpose: Fixed sidebar navigation and root layout
- Location: `src/app/layout.tsx`, `src/components/layout/sidebar.tsx`
- Provides: Cross-app navigation, theme provider (TooltipProvider), dark mode container

## Data Flow

**Live Data Read:**

1. User navigates to page or hook triggers SWR fetch
2. Client calls `/api/{endpoint}` (e.g., `/api/stats`, `/api/sessions`)
3. API route handler calls reader function (e.g., `getDashboardStats()`)
4. Reader scans `~/.claude/projects/` directory for JSONL files
5. Reader parses each JSONL line-by-line with `readline` (streaming)
6. Reader aggregates tokens, costs, metadata across sessions
7. Reader returns typed data (DashboardStats, SessionInfo[], etc.)
8. API returns JSON response
9. SWR caches response client-side, auto-revalidates on focus/interval

**Supplemental Stats Mechanism:**

- If `stats-cache.json` exists and is stale, `getDashboardStats()` computes "supplemental stats" from JSONL files modified after the cache date
- Supplemental stats are merged with cache stats to bridge stale cache with fresh data
- Supplemental cache itself is TTL'd at 30 seconds to avoid re-parsing on rapid requests

**Search Flow:**

1. User enters query in `/sessions` page
2. Component calls `useSessions(limit, offset, query)`
3. Hook calls `/api/sessions?q={query}`
4. Reader iterates all session JSONL files and checks for matching user/assistant content
5. Returns first matching session (based on text match), sorted by timestamp

**Imported Data Mode:**

- User uploads ZIP via `/data` page → POST `/api/import`
- ZIP extracted to `.dashboard-data/claude-data/projects/` in project root
- `.dashboard-data/.use-imported` flag file is created
- All subsequent reads check `getActiveDataSource()` and read from `.dashboard-data/` instead of `~/.claude/`
- User can switch back to live with PUT `/api/data-source`

**State Management:**

- No global state: Each page/component manages its own SWR data
- URL params used for persistence: search query via `?q=`, offset via `?offset=`
- Data-source toggle persisted via filesystem flag (`.use-imported`)

## Key Abstractions

**SessionMessage & Parsing:**
- Purpose: Represents raw JSONL line object from Claude Code
- Examples: `src/lib/claude-data/types.ts` → `SessionMessage` interface
- Pattern: Defensive access guards - always check for optional fields (`msg.message?.model`, `msg.compaction || {...}`)

**SessionInfo & Aggregation:**
- Purpose: Computed summary of a single session (costs, token counts, metadata)
- Examples: Computed by `parseSessionFile()` in `src/lib/claude-data/reader.ts`
- Pattern: Accumulate totals across JSONL file, extract metadata from first occurrence

**DashboardStats & Merging:**
- Purpose: Aggregated stats across all projects and sessions
- Examples: Computed by `getDashboardStats()` in `src/lib/claude-data/reader.ts`
- Pattern: Merge cache (historical) with supplemental (fresh) stats; handle date boundaries

**Pricing & Cost Calculation:**
- Purpose: Map model name to token pricing, calculate USD cost
- Examples: `src/config/pricing.ts` → `calculateCost()`, `getModelDisplayName()`, `getModelColor()`
- Pattern: Model family lookup (`claude-opus-4-6` → `opus`), fallback to Sonnet if unknown

**Data Source Abstraction:**
- Purpose: Toggle between live (`~/.claude/`) and imported (`.dashboard-data/`) data
- Examples: `src/lib/claude-data/data-source.ts` → `getActiveDataSource()`, `setDataSource()`
- Pattern: Check flag file existence; reader functions call `getClaudeDir()` which delegates

## Entry Points

**Root Layout:**
- Location: `src/app/layout.tsx`
- Triggers: Every navigation
- Responsibilities: Apply dark theme, render sidebar, set up TooltipProvider, define max-width container

**Overview Dashboard:**
- Location: `src/app/page.tsx`
- Triggers: Navigation to `/`
- Responsibilities: Fetch stats from `/api/stats`, render stat cards, display charts (usage over time, model breakdown, activity heatmap, peak hours), show recent sessions

**Sessions List:**
- Location: `src/app/sessions/page.tsx`
- Triggers: Navigation to `/sessions`
- Responsibilities: Fetch sessions with pagination/search, render session table, support URL-based search (`?q=`)

**Session Detail:**
- Location: `src/app/sessions/[id]/page.tsx`
- Triggers: Navigation to `/sessions/{id}`
- Responsibilities: Fetch session detail with message replay, render conversation transcript, show session stats and tool usage

**Projects Grid:**
- Location: `src/app/projects/page.tsx`
- Triggers: Navigation to `/projects`
- Responsibilities: Fetch project list, render grid of project cards with stats

**Project Detail:**
- Location: `src/app/projects/[id]/page.tsx`
- Triggers: Navigation to `/projects/{id}`
- Responsibilities: Fetch project sessions, render sessions within project, show aggregate project stats

**Cost Analytics:**
- Location: `src/app/costs/page.tsx`
- Triggers: Navigation to `/costs`
- Responsibilities: Fetch stats, render cost breakdown by model, cost trends over time

**Data Management:**
- Location: `src/app/data/page.tsx`
- Triggers: Navigation to `/data`
- Responsibilities: Show data source status (live vs imported), handle ZIP import, handle data export, manage data-source toggle, clear imported data

## Error Handling

**Strategy:** Non-blocking errors with user feedback

**Patterns:**

- API routes catch errors and return `{ error: '...' }` with HTTP 500 status
- Fetcher in `src/lib/hooks.ts` throws on non-2xx responses, SWR surfaces via `error` property
- Pages check `isLoading`, `error`, and `!data` before rendering (show spinner or "not found" message)
- Missing JSONL files or directories are silently skipped (return empty arrays)
- Malformed JSONL lines are caught and skipped during parsing
- Missing fields in parsed data are guarded with defensive checks (`session.models || []`, `session.compaction || {...}`)

## Cross-Cutting Concerns

**Logging:**
- Errors logged to console only (development visibility)
- No persistent logging infrastructure

**Validation:**
- TypeScript types enforce structure at compile time
- Runtime validation via try-catch around JSON.parse and property access
- URL params validated and coerced to integers (limit, offset)

**Authentication:**
- None; local-first design means no auth needed
- Data source toggle (`/api/data-source`) is unprotected but requires pre-imported data to activate

**Pricing & Cost:**
- Centralized pricing table in `src/config/pricing.ts`
- Cost calculated at point of message processing, not cached
- Models mapped to pricing via family name (opus/sonnet/haiku)

**Formatting & Presentation:**
- Utilities in `src/lib/format.ts` handle token/cost/duration/time formatting
- UI uses Tailwind CSS variables for colors (--primary is Claude orange)
- Icons from Lucide React with consistent sizing (h-3 w-3 inline, h-4 w-4 buttons)

---

*Architecture analysis: 2025-03-17*
