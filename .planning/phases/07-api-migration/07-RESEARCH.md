# Phase 7: API Migration - Research

**Researched:** 2026-03-19
**Domain:** SQLite query layer, Next.js API routes, TypeScript data mapping
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- New `src/lib/db-queries.ts` module with typed query functions matching existing reader.ts signatures (getDashboardStatsFromDb, getSessionsFromDb, getProjectsFromDb, etc.)
- No JSONL fallback on empty DB — if DB is empty, routes return empty/zero state. Ingest (Phase 6) handles population.
- Session detail hybrid: route reads aggregates (tokens, cost, duration, metadata) from `sessions` table, then reads messages from JSONL via existing `getSessionDetail()` in reader.ts
- Data-source toggle integration: when in imported mode, continue using JSONL reads (reader.ts). Only use SQLite queries when in live mode. Routes check `getActiveDataSource()` and branch accordingly.
- Remove stats-cache.json reading code from `/api/stats` route — DB replaces it entirely
- Remove the supplemental stats mechanism (StatsCache merging) — DB is always up to date via ingest
- Remove `StatsCache` type and related supplemental types from `types.ts` — clean up dead code
- Remove `getStatsCache()` function from reader.ts
- Automated test that calls both DB and JSONL paths and compares response shapes/totals at aggregate level
- Compare: session counts, total tokens, total cost, project counts. Accept small floating-point differences in cost calculations.
- Skip exact message content comparison — messages still come from JSONL in both paths

### Claude's Discretion
- Exact SQL query structure and optimization (indexes already exist from Phase 5)
- How to compute DashboardStats fields (dailyActivity, dailyModelTokens, hourCounts) from DB tables
- Whether to create a db-queries.test.ts for unit tests or rely on integration tests via API routes
- Order of route migration (can parallelize since routes are independent)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | Overview, sessions list, projects, and costs pages read from SQLite instead of JSONL | getDashboardStatsFromDb, getSessionsFromDb, getProjectsFromDb cover these. DB tables have all needed fields. |
| API-02 | Active sessions page continues reading from live JSONL files (not database) | active-sessions route not modified. Data-source branch only affects historical routes. |
| API-03 | Session detail page gets aggregates from DB and messages from JSONL (hybrid) | DB sessions row + existing getSessionDetail() messages-only extraction pattern. |
</phase_requirements>

---

## Summary

Phase 7 migrates four API routes (`/api/stats`, `/api/sessions`, `/api/projects`, `/api/sessions/[id]`) from JSONL-based reads to SQLite-based reads. The DB schema from Phase 5 stores all necessary fields. The primary work is writing `src/lib/db-queries.ts` — typed query functions that pull from the five DB tables and assemble the exact same TypeScript shapes that reader.ts currently returns.

The trickiest part is `DashboardStats`. The `daily_activity` table aggregates per `(date, project_id)` — not per model — so `dailyModelTokens` (tokens per day per model) does not exist in that table. It must be derived by querying the `sessions` table directly with `GROUP BY substr(timestamp, 1, 10), model`. Similarly, `hourCounts`, `firstSessionDate`, and `longestSession` come from the `sessions` table, not the aggregate tables. The `model_usage` table covers per-model token and cost totals directly.

Session detail uses a hybrid approach: DB row for aggregates (eliminates a full JSONL parse), plus the existing `getSessionDetail()` message extraction from reader.ts for the `messages` array. This avoids duplicating message-parsing logic. In imported mode, all routes fall back to the existing reader.ts functions unchanged.

**Primary recommendation:** Write db-queries.ts first with all query functions, then migrate routes one by one (stats → projects → sessions list → session detail). Remove stats-cache.json machinery last after verifying DB path works end-to-end.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | already installed (Phase 5) | Synchronous SQLite access | Already in use; synchronous API fits Next.js API routes cleanly |
| TypeScript | 5 | Type safety for DB row → interface mapping | Already used project-wide |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/lib/db` (getDb) | project | DB singleton access | All DB query functions import this |
| `@/lib/claude-data/data-source` (getActiveDataSource) | project | Live vs imported routing | All migrated routes branch on this |
| `@/lib/claude-data/reader` (getSessionDetail) | project | Messages extraction for hybrid session detail | Session detail route only |
| `@/config/pricing` (getModelDisplayName) | project | Convert raw model IDs to display names | DB stores raw model IDs in `models` JSON field |

**No new packages needed** — all dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure

No new directories. One new file:

```
src/lib/
├── db.ts               # Existing — SQLite singleton + schema
├── db-queries.ts       # NEW — typed query functions for all DB reads
├── ingest.ts           # Existing — unchanged
└── claude-data/
    ├── reader.ts       # Modified — remove getStatsCache(), supplemental stats code
    ├── types.ts        # Modified — remove StatsCache + supplemental types
    └── data-source.ts  # Unchanged
src/app/api/
├── stats/route.ts      # Modified — branch live→DB, imported→JSONL
├── sessions/route.ts   # Modified — branch live→DB, imported→JSONL
├── sessions/[id]/route.ts  # Modified — hybrid (DB aggregates + JSONL messages in live mode)
└── projects/route.ts   # Modified — branch live→DB, imported→JSONL
src/__tests__/lib/
└── db-queries.test.ts  # NEW — unit tests for all query functions
```

### Pattern 1: Data Source Branch in API Routes

Every migrated route applies this pattern:

```typescript
// Source: CONTEXT.md locked decision + data-source.ts
import { getActiveDataSource } from '@/lib/claude-data/data-source';
import { getDashboardStatsFromDb } from '@/lib/db-queries';
import { getDashboardStats } from '@/lib/claude-data/reader';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dataSource = getActiveDataSource();
    const stats = dataSource === 'live'
      ? getDashboardStatsFromDb()
      : await getDashboardStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
```

Note: DB query functions are synchronous (better-sqlite3). The `await` wraps the JSONL path only.

### Pattern 2: DB Row to SessionInfo Mapping

DB stores JSON fields as strings. Parsing must happen at query boundary:

```typescript
// Source: db.ts schema inspection + types.ts SessionInfo interface
function rowToSessionInfo(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    timestamp: row.timestamp,
    duration: row.duration,
    activeTime: row.active_time,
    messageCount: row.message_count,
    userMessageCount: row.user_message_count,
    assistantMessageCount: row.assistant_message_count,
    toolCallCount: row.tool_call_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCacheReadTokens: row.total_cache_read_tokens,
    totalCacheWriteTokens: row.total_cache_write_tokens,
    estimatedCost: row.estimated_cost,
    model: row.model,
    models: JSON.parse(row.models || '[]'),
    gitBranch: row.git_branch,
    cwd: row.cwd,
    version: row.version,
    toolsUsed: JSON.parse(row.tools_used || '{}'),
    compaction: JSON.parse(row.compaction || '{}'),
  };
}
```

### Pattern 3: DashboardStats Assembly from Multiple Tables

`DashboardStats` requires data from four DB tables. Fields without a pre-aggregated table must be derived from `sessions`:

| DashboardStats field | Source table | SQL approach |
|----------------------|--------------|-------------|
| `totalSessions` | `sessions` | `SELECT COUNT(*)` |
| `totalMessages` | `sessions` | `SELECT SUM(message_count)` |
| `totalTokens` | `sessions` | SUM of all four token columns |
| `estimatedCost` | `sessions` or `projects` | `SELECT SUM(estimated_cost)` |
| `dailyActivity[]` | `daily_activity` | `SELECT date, SUM(...) GROUP BY date` (sum across project_ids per date) |
| `dailyModelTokens[]` | `sessions` | `SELECT substr(timestamp,1,10), model, SUM(tokens) GROUP BY date, model` |
| `modelUsage{}` | `model_usage` | Direct SELECT all rows |
| `hourCounts{}` | `sessions` | `SELECT substr(timestamp,11,2), COUNT(*) GROUP BY hour` |
| `firstSessionDate` | `sessions` | `SELECT MIN(timestamp)` |
| `longestSession` | `sessions` | `SELECT id, duration, message_count, timestamp ORDER BY duration DESC LIMIT 1` |
| `projectCount` | `projects` | `SELECT COUNT(*)` |
| `recentSessions[]` | `sessions` | `SELECT ... ORDER BY timestamp DESC LIMIT 10` |

**Critical insight:** `daily_activity` has `(date, project_id)` as composite PK — queries for `dailyActivity[]` must `GROUP BY date` and SUM across project_ids.

### Pattern 4: Session Detail Hybrid

```typescript
// Source: CONTEXT.md locked decision
// In session detail route (live mode only):
import { getDb } from '@/lib/db';
import { getSessionDetail } from '@/lib/claude-data/reader';

// 1. Get aggregates from DB (synchronous, fast)
const row = getDb()
  .prepare('SELECT * FROM sessions WHERE id = ?')
  .get(sessionId) as SessionRow | undefined;

if (!row) {
  return NextResponse.json({ error: 'Session not found' }, { status: 404 });
}

// 2. Get messages from JSONL (async, existing logic)
const detail = await getSessionDetail(sessionId);
if (!detail) {
  return NextResponse.json({ error: 'Session not found' }, { status: 404 });
}

// 3. Combine: use DB aggregates, JSONL messages
return NextResponse.json({ ...rowToSessionInfo(row), messages: detail.messages });
```

**Reasoning:** The DB row has precise aggregates (tokens, cost, duration) already computed by ingest. Using them avoids a redundant JSONL parse just for the header fields.

### Pattern 5: Session Search in DB

```typescript
// LIKE-based search on project_name, git_branch, cwd
// Source: CONTEXT.md specific ideas section
function searchSessionsFromDb(query: string, limit = 50): SessionInfo[] {
  const db = getDb();
  const like = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE project_name LIKE ?
       OR git_branch LIKE ?
       OR cwd LIKE ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(like, like, like, limit) as SessionRow[];
  return rows.map(rowToSessionInfo);
}
```

Note: DB search only matches session metadata fields. JSONL search matched message content. This is a known capability reduction for the live mode — acceptable per decisions (no full-text store in DB).

### Pattern 6: Projects Table — models Field Gap

`recomputeAggregates` in ingest.ts inserts `'[]'` for `models` in the projects table:

```sql
INSERT INTO projects (..., models) SELECT ..., '[]' FROM sessions GROUP BY project_id
```

This means `projects.models` is always empty in the DB. For `ProjectInfo.models`, query the sessions table instead:

```typescript
// Collect distinct models across all sessions for each project
// Option A: second query per project (N+1 risk for many projects)
// Option B: subquery or JSON aggregation
// Recommended: single query joining sessions to get distinct models per project
```

The simplest correct approach: after fetching all projects, do one additional query `SELECT project_id, GROUP_CONCAT(DISTINCT model) FROM sessions GROUP BY project_id` and merge. Or accept `[]` and add a TODO for Phase 8 if models-in-projects is needed for the UI.

**Check the UI:** The projects page displays `models` badges per project. If this is important, the query must be correct. Research shows the models field is displayed in `src/app/projects/page.tsx` — it is shown. Therefore models must be populated correctly.

### Anti-Patterns to Avoid

- **Querying daily_activity without GROUP BY date:** The table has one row per `(date, project_id)`. Forgetting to aggregate gives inflated counts when multiple projects exist.
- **Treating DB query functions as async:** better-sqlite3 is synchronous. Do not `await` DB calls. Only the JSONL reader path uses `await`.
- **Modifying reader.ts functions that active sessions depends on:** `getActiveDataSource()`, `getProjectsDir()`, `forEachJsonlLine()`, `parseSessionFile()`, `getSessionDetail()` — these stay intact. Only remove the stats-cache machinery.
- **Using `INSERT OR IGNORE` for model_usage during recompute:** Already decided in Phase 6 to use DELETE+INSERT per cycle. Don't change ingest behavior from this phase.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type-safe DB row access | Custom row validator | TypeScript `as RowType` + defensive parsing at boundary | Already established pattern in ingest.ts |
| Model display names | Re-implement name mapping | `getModelDisplayName()` from `@/config/pricing` | Already handles all Claude model families |
| Cost recalculation from tokens | Recompute cost in query layer | Use `estimated_cost` stored in sessions table | Ingest already computed it at parse time |
| Session search full-text | SQLite FTS5 extension | LIKE query on metadata fields | Scope is metadata-only search; full-text was a JSONL-specific capability |

---

## Common Pitfalls

### Pitfall 1: daily_activity Composite PK Means One Row per (date, project_id)

**What goes wrong:** `SELECT date, SUM(message_count) FROM daily_activity` without `GROUP BY date` returns one row per project-day combination. The consumer (`dailyActivity[]` in DashboardStats) expects one entry per date.

**Why it happens:** The table design deliberately splits by project_id for the Phase 8 activity chart. Phase 7 usage needs re-aggregation.

**How to avoid:** Always `GROUP BY date` when building the `dailyActivity[]` array for DashboardStats. Only skip the GROUP BY for Phase 8 per-project queries.

**Warning signs:** `dailyActivity` array has more entries than calendar days, or counts are off by a factor matching project count.

### Pitfall 2: JSON String Fields Need Parsing

**What goes wrong:** `row.models` is the string `'["claude-opus-4-6"]'`, not an array. Passing it directly to `SessionInfo.models` produces a string where an array is expected.

**Why it happens:** better-sqlite3 returns column values exactly as stored. JSON columns stored as TEXT come back as strings.

**How to avoid:** Parse all four JSON columns (`models`, `tools_used`, `compaction`, and the `models` column in projects) with `JSON.parse(row.X || '[]')` / `JSON.parse(row.X || '{}')`. Use defensive fallback for NULL/empty.

**Warning signs:** TypeScript won't catch this at compile time since `as SessionRow` casts bypass type checking.

### Pitfall 3: models Field in projects Table is Always '[]'

**What goes wrong:** `getProjectsFromDb()` returns `ProjectInfo[]` with `models: []` for every project, even when sessions have models.

**Why it happens:** `recomputeAggregates` in ingest.ts writes `'[]'` for the models column in the projects INSERT. This was not corrected in Phase 6.

**How to avoid:** After fetching projects from DB, run a second query: `SELECT project_id, model FROM sessions WHERE model != '' GROUP BY project_id, model` — then build the models array per project from that result. Apply `getModelDisplayName()` to each model ID.

**Warning signs:** Projects page shows no model badges for any project.

### Pitfall 4: hourCounts Key Format

**What goes wrong:** `getDashboardStats()` in reader.ts builds `hourCounts` as `{ "10": 5, "14": 3 }` — two-digit string keys from `msg.timestamp.slice(11, 13)`. DB query must match this format.

**Why it happens:** The UI chart consumes keys as strings and expects exactly two characters ("00"–"23").

**How to avoid:** In the SQL query: `SELECT substr(timestamp, 12, 2) as hour, COUNT(*) FROM sessions GROUP BY hour`. Verify `substr` is 1-indexed in SQLite (`substr(timestamp, 12, 2)` gives chars 12-13 of the ISO timestamp `2024-03-01T10:00:00.000Z`).

**Warning signs:** Hour chart shows all zeros or wrong distribution.

### Pitfall 5: dailyModelTokens Requires sessions Table, Not model_usage

**What goes wrong:** Using `model_usage` table for `dailyModelTokens` returns total model tokens across all time — not per day.

**Why it happens:** `model_usage` has no date column. It's a lifetime aggregate.

**How to avoid:** Query `sessions` table: `SELECT substr(timestamp,1,10) as date, model, SUM(total_input_tokens + total_output_tokens + total_cache_read_tokens + total_cache_write_tokens) as tokens FROM sessions WHERE model != '' GROUP BY date, model`. Transform into `DailyModelTokens[]` in TypeScript.

### Pitfall 6: StatsCache Removal Touches Three Files

**What goes wrong:** Only removing `getStatsCache()` from reader.ts but leaving `StatsCache` import in route.ts, or leaving `SupplementalStats` interface in reader.ts.

**Why it happens:** The supplemental stats machinery spans: the `StatsCache` and supplemental interfaces in `types.ts`, the `getStatsCache()` + `computeSupplementalStats()` + `supplementalCache` + `getRecentSessionFiles()` functions in `reader.ts`, and the `getDashboardStats()` function which orchestrates them all.

**How to avoid:** In reader.ts, the functions to remove are:
- `getStatsCache()` (lines 53–57)
- `getRecentSessionFiles()` (lines 500–520)
- `computeSupplementalStats()` (lines 522–657)
- `SupplementalStats` interface definition (lines 486–495)
- The `supplementalCache` module-level variable (line 497)
- The entire `getDashboardStats()` body (lines 659–776) can be simplified or removed once DB path handles it

In `types.ts`, remove `StatsCache` interface (lines 31–43) and `LongestSession` is still needed (used by `DashboardStats`).

**Warning signs:** TypeScript compilation errors referencing `StatsCache` after removal.

---

## Code Examples

### getDashboardStatsFromDb — Core Query Pattern

```typescript
// Source: db.ts schema + types.ts DashboardStats interface
import { getDb } from '@/lib/db';
import type { DashboardStats, DailyActivity, DailyModelTokens, ModelUsage, SessionInfo } from '@/lib/claude-data/types';

export function getDashboardStatsFromDb(): DashboardStats {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as totalSessions,
      SUM(message_count) as totalMessages,
      SUM(total_input_tokens + total_output_tokens + total_cache_read_tokens + total_cache_write_tokens) as totalTokens,
      SUM(estimated_cost) as estimatedCost,
      MIN(timestamp) as firstSessionDate
    FROM sessions
  `).get() as { totalSessions: number; totalMessages: number; totalTokens: number; estimatedCost: number; firstSessionDate: string };

  // ... (see full pattern details in Architecture Patterns section)
}
```

### dailyActivity Query — GROUP BY date Across All Projects

```typescript
// Source: db.ts daily_activity schema (composite PK date+project_id)
const dailyActivityRows = db.prepare(`
  SELECT
    date,
    SUM(message_count) as messageCount,
    SUM(session_count) as sessionCount,
    SUM(tool_call_count) as toolCallCount
  FROM daily_activity
  GROUP BY date
  ORDER BY date ASC
`).all() as DailyActivity[];
```

### Session Search with LIKE

```typescript
// Source: CONTEXT.md specifics section
export function searchSessionsFromDb(query: string, limit = 50): SessionInfo[] {
  const db = getDb();
  const like = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE project_name LIKE ?
       OR git_branch LIKE ?
       OR cwd LIKE ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(like, like, like, limit) as SessionRow[];
  return rows.map(rowToSessionInfo);
}
```

### Models per Project Repair Query

```typescript
// Source: Pitfall 3 analysis — projects.models is always '[]' from ingest
export function getProjectsFromDb(): ProjectInfo[] {
  const db = getDb();

  // Get base project data
  const projectRows = db.prepare(
    'SELECT * FROM projects ORDER BY last_active DESC'
  ).all() as ProjectRow[];

  // Get distinct models per project from sessions (projects table has '[]' placeholder)
  const modelsPerProject = new Map<string, string[]>();
  const modelRows = db.prepare(`
    SELECT DISTINCT project_id, model
    FROM sessions
    WHERE model != '' AND model != 'unknown'
    ORDER BY project_id, model
  `).all() as { project_id: string; model: string }[];

  for (const { project_id, model } of modelRows) {
    if (!modelsPerProject.has(project_id)) modelsPerProject.set(project_id, []);
    modelsPerProject.get(project_id)!.push(getModelDisplayName(model));
  }

  return projectRows.map(row => ({
    id: row.id,
    name: row.name,
    path: row.path,
    sessionCount: row.session_count,
    totalMessages: row.total_messages,
    totalTokens: row.total_tokens,
    estimatedCost: row.estimated_cost,
    lastActive: row.last_active,
    models: modelsPerProject.get(row.id) || [],
  }));
}
```

### Test Pattern — db-queries.test.ts with Temp DB

```typescript
// Source: ingest.test.ts — established test pattern in this project
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createDb } from '@/lib/db';
import { getDashboardStatsFromDb, getSessionsFromDb } from '@/lib/db-queries';

let tmpDbPath: string;

beforeEach(() => {
  tmpDbPath = path.join(os.tmpdir(), `test-dbqueries-${process.pid}-${Date.now()}.db`);
  const db = createDb(tmpDbPath);
  globalThis.__claudeometerDb = db;
  // Seed test data...
});

afterEach(() => {
  try { (globalThis.__claudeometerDb as import('better-sqlite3').Database)?.close(); } catch { /* ignore */ }
  globalThis.__claudeometerDb = undefined;
  for (const ext of ['', '-wal', '-shm']) {
    const f = tmpDbPath + ext;
    if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| stats-cache.json + supplemental JSONL scan | SQLite DB queries only | Phase 7 | Eliminates O(n files) scan on every stats request |
| Full JSONL parse for session aggregates in detail route | DB row lookup for aggregates, JSONL for messages | Phase 7 | Detail page header loads from indexed lookup |
| JSONL full-text search for `?q=` | LIKE query on session metadata fields | Phase 7 | Faster but narrower scope (no message content matching) |

**Deprecated/outdated after this phase:**
- `StatsCache` type: replaced by DB-computed aggregates
- `getStatsCache()` function: no consumer after route migration
- `supplementalCache`, `computeSupplementalStats()`, `getRecentSessionFiles()`: entire supplemental machinery retired
- `SupplementalStats` interface: internal only, can be removed with its functions

---

## Open Questions

1. **Should getDashboardStats() in reader.ts be kept or removed?**
   - What we know: It is the JSONL path that imported-mode routes will use. The `getDashboardStats()` function currently calls `getStatsCache()` (to be removed) and `computeSupplementalStats()` (to be removed). After removing the stats-cache machinery, it needs rewriting for imported mode.
   - What's unclear: Is imported mode stats still needed? The data-source toggle and import routes are explicitly unchanged. The imported JSONL path must still work.
   - Recommendation: Rewrite `getDashboardStats()` in reader.ts to do a pure JSONL scan (without stats-cache dependencies) for imported mode. This is the correct path — the old supplemental approach was a workaround for the missing DB, which is now the live path.

2. **dailyModelTokens display names — raw model IDs vs display names**
   - What we know: `DailyModelTokens.tokensByModel` is `Record<string, number>` where keys are model identifiers. reader.ts stores raw model IDs (e.g., `claude-opus-4-5`). The chart code uses these as keys.
   - What's unclear: Does the chart expect raw IDs or display names ("Opus", "Sonnet")?
   - Recommendation: Match existing reader.ts behavior — store raw model IDs as keys in `tokensByModel`. Check `src/components/charts/` to verify.

3. **longestSession — is this field displayed in the UI?**
   - What we know: `DashboardStats.longestSession` exists as a type. The old reader.ts falls back to `{ sessionId: '', duration: 0, messageCount: 0, timestamp: '' }` if stats-cache is absent.
   - What's unclear: Whether any UI component currently renders it.
   - Recommendation: Implement it correctly (`ORDER BY duration DESC LIMIT 1`) — it's cheap and keeps the interface complete.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30 + ts-jest 29 |
| Config file | `jest.config.js` (project root) |
| Quick run command | `npm test -- --testPathPattern=db-queries` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | getDashboardStatsFromDb returns correct totals | unit | `npm test -- --testPathPattern=db-queries` | ❌ Wave 0 |
| API-01 | getSessionsFromDb returns SessionInfo[] with correct shape | unit | `npm test -- --testPathPattern=db-queries` | ❌ Wave 0 |
| API-01 | getProjectsFromDb returns ProjectInfo[] with models populated | unit | `npm test -- --testPathPattern=db-queries` | ❌ Wave 0 |
| API-01 | DB path and JSONL path produce matching aggregate totals | unit | `npm test -- --testPathPattern=db-queries` | ❌ Wave 0 |
| API-02 | Active sessions route unchanged (smoke check — existing tests) | — | `npm test -- --testPathPattern=active-sessions` | ✅ exists |
| API-03 | Session detail hybrid: DB aggregates match JSONL aggregates | unit | `npm test -- --testPathPattern=db-queries` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern=db-queries`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/lib/db-queries.test.ts` — covers API-01 (stats, sessions, projects) and API-03 (session detail aggregates)
- [ ] Seed helper (`createTestSession`) in db-queries test for inserting minimal session rows (similar to `createTestJsonl` in ingest.test.ts)

*(Existing test infrastructure: Jest + ts-jest fully configured. Pattern established in db.test.ts and ingest.test.ts. Only new test file needed.)*

---

## Sources

### Primary (HIGH confidence)
- `src/lib/db.ts` — exact schema, all column names, JSON storage format
- `src/lib/ingest.ts` — `recomputeAggregates()` reveals exact aggregate logic and the `models: '[]'` gap in projects
- `src/lib/claude-data/reader.ts` — full reader implementation including supplemental stats machinery to be removed
- `src/lib/claude-data/types.ts` — exact TypeScript interfaces that DB queries must satisfy
- `src/app/api/stats/route.ts`, `sessions/route.ts`, `projects/route.ts`, `sessions/[id]/route.ts` — current route implementations
- `src/__tests__/lib/ingest.test.ts` — established test patterns for this codebase

### Secondary (MEDIUM confidence)
- better-sqlite3 synchronous API behavior — confirmed by existing usage in db.ts and ingest.ts
- SQLite `substr()` 1-indexed behavior — standard SQLite behavior, consistent with ISO timestamp format

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use, no new dependencies
- Architecture: HIGH — DB schema fully known, type interfaces fully known, query logic derivable from existing reader.ts behavior
- Pitfalls: HIGH — derived from direct code inspection of schema, ingest logic, and type definitions
- Test patterns: HIGH — established patterns in existing test files

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable domain — SQLite schema and TypeScript interfaces won't change without a new phase)
