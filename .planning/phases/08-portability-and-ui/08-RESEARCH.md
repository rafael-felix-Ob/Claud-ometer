# Phase 8: Portability and UI - Research

**Researched:** 2026-03-19
**Domain:** SQLite file portability (export/import/merge via better-sqlite3 + ATTACH DATABASE), Recharts BarChart for per-project activity
**Confidence:** HIGH

## Summary

This phase adds three DB portability operations (export, replace-import, merge) on the existing `/data` page, plus a per-project activity chart on the project detail page. All foundational infrastructure (better-sqlite3 singleton, ingest engine, aggregate tables, test patterns) is already in place from Phases 5-7. No new packages are required.

The most technically nuanced piece is the merge operation. SQLite's `ATTACH DATABASE` lets two `.db` files be accessed in a single connection, enabling cross-database INSERT queries without writing an intermediate file. The deduplication rule is message-count-wins: an incoming session replaces an existing one only if its `message_count` is strictly greater. After merge, `recomputeAggregates()` is called (already exists in `ingest.ts`) to rebuild `projects`, `daily_activity`, and `model_usage` from the merged sessions table.

The DB export must copy the file before streaming it, because WAL mode keeps in-progress transactions in a `-wal` sidecar and streaming the live file risks a partial or corrupt read. A synchronous `better-sqlite3` backup call (or `fs.copyFileSync` after a checkpoint pragma) solves this cleanly. The replace-import must stop the ingest scheduler, close the singleton, swap the file on disk, and reinitialize — the existing `globalThis.__claudeometerDb` and `globalThis.__claudeometerIngestTimer` globals are the correct handles for this.

**Primary recommendation:** Implement the three API routes (`/api/db-export`, `/api/db-import`) plus the `getProjectActivityFromDb()` query function, wire them to the `/data` page and project detail page following the established Card/SWR patterns.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Extend existing `/data` page — add a "Database" section below the JSONL export/import section
- Export: API route streams the .db file as `application/octet-stream` download. Copy to temp file first to avoid locking the live DB.
- Import (replace): stop ingest scheduler, close DB connection, swap the .db file, reinitialize. Show confirmation dialog warning data will be replaced.
- Merge: `INSERT OR REPLACE` where incoming session `message_count > existing` — session with more messages wins dedup. Recompute all aggregate tables after merge. Idempotent — merging same file twice produces identical row count.
- Activity chart: Recharts BarChart showing daily message/session count for a specific project — similar to overview Usage Over Time but per-project
- Data source: query `daily_activity` table filtered by `project_id` — data already populated by Phase 6 ingest
- Placement: below project stats section on `/projects/[id]` page, before session list
- Time range: last 30 days by default
- After successful ZIP import, show "Also import to database?" button on the /data page
- When clicked, run `runIngestCycle()` with the imported data directory path to populate SQLite from the imported JSONL files
- Use ATTACH DATABASE for merge

### Claude's Discretion
- Exact UI layout of the Database section on /data page (card styling, button placement)
- Whether to show merge preview or just merge directly
- Activity chart toggle (messages vs sessions) or fixed to one metric
- Temp file cleanup timing for export

### Deferred Ideas (OUT OF SCOPE)
- Merge preview (PORT-04 in v2 requirements) — Show what will be added/updated before committing merge
- Selective merge (PORT-05 in v2 requirements) — Choose which projects/sessions to import
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PORT-01 | User can export the SQLite database as a standalone .db file download (separate from JSONL ZIP export) | `/api/db-export` GET route; better-sqlite3 `.backup()` or `fs.copyFileSync` after WAL checkpoint; stream via `NextResponse` with `application/octet-stream` |
| PORT-02 | User can import a .db file to replace the current database (separate from JSONL ZIP import) | `/api/db-import` POST replace path; stop scheduler via `globalThis.__claudeometerIngestTimer`, close `globalThis.__claudeometerDb`, swap file, call `createDb(DB_PATH)`, restart scheduler |
| PORT-03 | User can merge a .db file from another machine with deduplication by session ID | `/api/db-import` POST merge path; `ATTACH DATABASE ? AS src`; `INSERT OR REPLACE ... WHERE src.message_count > existing`; call `recomputeAggregates()` |
| UI-01 | Project detail page shows an activity chart (similar to overview heatmap) | New `ProjectActivityChart` component using Recharts `BarChart`; new `getProjectActivityFromDb(projectId)` query; new `/api/projects/[id]/activity` API route; `useProjectActivity(projectId)` SWR hook |
</phase_requirements>

## Standard Stack

### Core (already installed — no new packages needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^9.x (existing) | SQLite access + ATTACH DATABASE for merge | Synchronous API; already the DB layer |
| recharts | ^3.x (existing) | BarChart for activity chart | Already used for all charts in the project |
| date-fns | ^4.x (existing) | Date formatting for chart axis labels | Already used in `usage-over-time.tsx` |
| Next.js App Router | 16 (existing) | API routes + page components | Project framework |
| SWR | existing | Data fetching hooks | Project-wide fetching pattern |

### No new dependencies required
All tools needed are already present. ATTACH DATABASE is a SQLite built-in, accessed through better-sqlite3's `.prepare()` and `.exec()` APIs.

**Installation:**
```bash
# No new installs needed
```

## Architecture Patterns

### Recommended New File Structure
```
src/
├── app/
│   └── api/
│       ├── db-export/
│       │   └── route.ts          # GET — copy DB to temp, stream as .db download
│       ├── db-import/
│       │   └── route.ts          # POST replace | POST merge — handles both operations
│       └── projects/
│           └── [id]/
│               └── activity/
│                   └── route.ts  # GET — daily_activity filtered by project_id, last 30 days
├── components/
│   └── charts/
│       └── project-activity-chart.tsx  # Recharts BarChart, per-project, mirrors usage-over-time
└── lib/
    └── db-queries.ts             # Add getProjectActivityFromDb(projectId, days?)
    hooks.ts                      # Add useProjectActivity(projectId) SWR hook
```

### Pattern 1: DB Export via WAL-safe Copy
**What:** Before streaming, checkpoint WAL then copy file to `/tmp`. Stream the copy. Clean up temp file.
**When to use:** Any time the live DB must be serialized while the ingest scheduler may be running.
**Example:**
```typescript
// src/app/api/db-export/route.ts
import Database from 'better-sqlite3';
import { getDb, DB_PATH } from '@/lib/db';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  // Checkpoint to flush WAL into main DB file before copy
  db.pragma('wal_checkpoint(TRUNCATE)');

  const tmpPath = path.join(os.tmpdir(), `claud-ometer-export-${Date.now()}.db`);
  try {
    fs.copyFileSync(DB_PATH, tmpPath);
    const buffer = fs.readFileSync(tmpPath);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="claud-ometer-${date}.db"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}
```
Note: better-sqlite3 also exposes `.backup(destPath)` as an alternative that handles WAL correctly. Either approach is valid. `wal_checkpoint(TRUNCATE)` + `fs.copyFileSync` is simpler and already consistent with the project's fs-first style.

### Pattern 2: DB Replace-Import
**What:** Stop ingest timer, close DB singleton, overwrite file, reinitialize singleton and restart timer.
**When to use:** PORT-02 replace operation.
**Example:**
```typescript
// src/app/api/db-import/route.ts (replace branch)
import { getDb, createDb, DB_PATH } from '@/lib/db';
import { startIngestScheduler } from '@/lib/ingest';
import fs from 'fs';

// Stop ingest timer
if (globalThis.__claudeometerIngestTimer) {
  clearInterval(globalThis.__claudeometerIngestTimer);
  globalThis.__claudeometerIngestTimer = undefined;
}

// Close the live DB connection
try { globalThis.__claudeometerDb?.close(); } catch { /* ignore */ }
globalThis.__claudeometerDb = undefined;

// Write uploaded file to DB_PATH
fs.writeFileSync(DB_PATH, Buffer.from(await file.arrayBuffer()));

// Reinitialize
createDb(DB_PATH);           // validates schema
startIngestScheduler();      // restarts timer + immediate ingest cycle
```
**Critical:** The ingest scheduler timer handle lives on `globalThis.__claudeometerIngestTimer` (declared in `ingest.ts`). The DB singleton lives on `globalThis.__claudeometerDb` (declared in `db.ts`). Both must be reset or the old handles leak.

### Pattern 3: DB Merge via ATTACH DATABASE
**What:** Attach the uploaded DB as a secondary connection, run cross-DB INSERT with message_count dedup, recompute aggregates.
**When to use:** PORT-03 merge operation.
**Example:**
```typescript
// src/app/api/db-import/route.ts (merge branch)
import { getDb } from '@/lib/db';
import { recomputeAggregates } from '@/lib/ingest';  // NOTE: must be exported

const db = getDb();
const srcPath = path.join(os.tmpdir(), `merge-src-${Date.now()}.db`);
fs.writeFileSync(srcPath, Buffer.from(await file.arrayBuffer()));

try {
  db.exec(`ATTACH DATABASE '${srcPath}' AS src`);

  db.transaction(() => {
    // Only replace if incoming session has more messages (or session doesn't exist yet)
    db.prepare(`
      INSERT OR REPLACE INTO sessions
      SELECT src.sessions.*
      FROM src.sessions
      LEFT JOIN sessions ON sessions.id = src.sessions.id
      WHERE sessions.id IS NULL
         OR src.sessions.message_count > sessions.message_count
    `).run();

    // Merge ingested_files tracking too (union — don't overwrite newer entries)
    db.prepare(`
      INSERT OR IGNORE INTO ingested_files
      SELECT * FROM src.ingested_files
    `).run();
  })();

  db.exec('DETACH DATABASE src');
  recomputeAggregates(db);  // rebuild projects, daily_activity, model_usage
} finally {
  db.exec('DETACH DATABASE src');  // ensure detach on error path too
  try { fs.unlinkSync(srcPath); } catch { /* ignore */ }
}
```

### Pattern 4: Project Activity Query
**What:** Query `daily_activity` filtered by `project_id`, last N days, return `DailyActivity[]`.
**When to use:** UI-01 chart data source.
**Example:**
```typescript
// src/lib/db-queries.ts — add this function
export function getProjectActivityFromDb(projectId: string, days = 30): DailyActivity[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const rows = db.prepare(`
    SELECT date, message_count as messageCount, session_count as sessionCount,
           tool_call_count as toolCallCount
    FROM daily_activity
    WHERE project_id = ? AND date >= ?
    ORDER BY date ASC
  `).all(projectId, since) as DailyActivity[];

  return rows;
}
```

### Pattern 5: ProjectActivityChart Component
**What:** Recharts BarChart (not AreaChart) for per-project daily activity. Mirrors `usage-over-time.tsx` structure.
**When to use:** UI-01 — inserted in project detail page between stats section and session list.
**Key differences from UsageOverTime:**
- `BarChart` + `Bar` (not `AreaChart` + `Area`) — bar chart is more readable for sparse data
- Title: "Activity (Last 30 Days)"
- Props: `{ data: DailyActivity[] }` — same type as UsageOverTime
- Colors: reuse `#D4764E` (messages), `#6B8AE6` (sessions) from the metrics array in usage-over-time
- Height: `h-[200px]` — shorter than overview chart (project page is denser)
- Toggle button: messages / sessions (two options, not three — tool calls are less relevant per-project)

### Anti-Patterns to Avoid
- **Streaming the live .db file directly:** WAL mode means the file on disk may be incomplete; always checkpoint+copy first.
- **Using `fs.copyFileSync` before checkpoint:** Checkpoint first (`wal_checkpoint(TRUNCATE)`), then copy. Otherwise WAL frames not yet flushed are missing from the copy.
- **Forgetting to DETACH on error:** `ATTACH DATABASE` must be paired with `DETACH` in a finally block; a leaked attachment holds a file lock on the temp path.
- **Calling `startIngestScheduler()` without clearing the timer first on replace:** The guard `if (globalThis.__claudeometerIngestTimer) return;` in `startIngestScheduler` will silently no-op if the old timer handle is still present — clear it first.
- **Making `recomputeAggregates` an export concern too early:** It is currently a module-private function in `ingest.ts`. The merge route needs it — either export it, or call `runIngestCycle()` with a flag. Exporting `recomputeAggregates` is simpler.
- **Querying `daily_activity` without a `project_id` filter for the project chart:** The table has a composite PK `(date, project_id)`, so a full table scan will return all projects' data mixed together.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-DB merge | Custom DB parsing in Node.js | `ATTACH DATABASE` SQL | SQLite native; type-safe through better-sqlite3 |
| WAL-safe DB copy | Read raw bytes while DB is live | `wal_checkpoint(TRUNCATE)` + `fs.copyFileSync` | Ensures WAL frames are flushed before copy |
| File download stream | Custom byte-range implementation | `NextResponse(buffer, headers)` | Same pattern as ZIP export already in the codebase |
| DB file upload | Multipart parsing from scratch | `FormData` + `file.arrayBuffer()` | Same pattern as ZIP import already in the codebase |
| Aggregate recompute after merge | Re-derive stats in JS | `recomputeAggregates(db)` (existing) | DELETE+INSERT transaction already handles full consistency |

**Key insight:** Every hard problem in this phase is already solved by either SQLite built-ins (ATTACH DATABASE, WAL checkpoint) or existing project infrastructure (`recomputeAggregates`, the export/import FormData patterns). The phase is primarily wiring work.

## Common Pitfalls

### Pitfall 1: Ingest Running During Replace-Import
**What goes wrong:** Replace-import overwrites the DB file while the ingest scheduler is mid-cycle, causing a corrupted DB or a `SQLITE_BUSY` error.
**Why it happens:** The ingest scheduler runs every 2 minutes in the background; there is no external "is ingest running" lock on the file.
**How to avoid:** Stop the scheduler and wait for `isCurrentlyRunning` to be false before writing the new file. The `getIngestState()` function (private to `ingest.ts`) tracks `isCurrentlyRunning`. Expose a `stopIngestScheduler()` or check `getSyncStatus().isRunning` and poll briefly.
**Warning signs:** `SQLITE_BUSY` or `SQLITE_LOCKED` errors in the replace API response.

### Pitfall 2: Forgetting the WAL + SHM Files During Replace
**What goes wrong:** The user uploads a new `.db` file but the stale `claud-ometer.db-wal` and `claud-ometer.db-shm` sidecars from the previous DB remain on disk. SQLite tries to apply the old WAL to the new database and corrupts it.
**Why it happens:** WAL mode creates `-wal` and `-shm` files alongside the main `.db`. Replacing only the `.db` leaves orphaned sidecars.
**How to avoid:** After closing the DB connection and before writing the new file, delete any existing `-wal` and `-shm` files at `DB_PATH + '-wal'` and `DB_PATH + '-shm'`.
**Warning signs:** Database appears to open but contains wrong/mixed data, or `SQLITE_NOTADB` errors.

### Pitfall 3: ATTACH DATABASE Path Contains Spaces or Special Chars
**What goes wrong:** If the temp file path has spaces, the SQL string interpolation `ATTACH DATABASE '${srcPath}'` fails with a syntax error.
**Why it happens:** The tmpdir path is usually `/tmp/` on Linux (no spaces), but is not guaranteed.
**How to avoid:** Use a predictable path under `/tmp/claud-ometer-merge-<timestamp>.db` which is safe. Alternatively, use better-sqlite3's parameter binding for the ATTACH path: not possible (ATTACH does not accept `?` params in SQLite) — so construct the path deliberately.
**Warning signs:** `SqliteError: near "Documents": syntax error` if running on macOS where tmpdir may be `/var/folders/...`.

### Pitfall 4: Chart Renders Empty for Projects with No Recent Activity
**What goes wrong:** `getProjectActivityFromDb` returns an empty array, and the BarChart renders a blank area with no axis labels, looking broken.
**Why it happens:** The query filters to `date >= since` — a project with no sessions in the last 30 days returns nothing.
**How to avoid:** The component should handle `data.length === 0` with a friendly empty state ("No activity in the last 30 days") rather than rendering an empty chart frame. Show the Card with the title but replace the chart div with the empty state message.
**Warning signs:** Blank Card section on the project detail page for older/inactive projects.

### Pitfall 5: recomputeAggregates is Currently Not Exported
**What goes wrong:** The merge route needs to call `recomputeAggregates(db)` but it is a module-private function in `ingest.ts` — TypeScript will refuse to compile the import.
**Why it happens:** Phase 6 only needed it internally; there was no external caller at the time.
**How to avoid:** Export `recomputeAggregates` from `ingest.ts` as part of Phase 8 implementation. This is a one-line change (`export function recomputeAggregates`).
**Warning signs:** TypeScript compilation error on the merge route import.

### Pitfall 6: ZIP Import → SQLite Bridge Directory Path
**What goes wrong:** After a ZIP import, `runIngestCycle()` is called with the imported data path. The ZIP contents land at `getImportDir()/claude-data/projects/` but `runIngestCycle` expects a `projectsDir` that directly contains project subdirectories.
**Why it happens:** The import route extracts to `{importDir}/claude-data/projects/<projectId>/<session>.jsonl`. The bridge call must pass the full `projects` subdirectory path, not just `importDir`.
**How to avoid:** Call `runIngestCycle(path.join(getImportDir(), 'claude-data', 'projects'))` — read `data-source.ts` to confirm `getImportDir()` returns the base import directory.
**Warning signs:** Ingest cycle runs but reports 0 files processed (wrong directory passed).

## Code Examples

Verified patterns from existing codebase:

### Existing Export Download Pattern (from `/api/export/route.ts`)
```typescript
// Source: src/app/api/export/route.ts
return new NextResponse(buffer, {
  headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length.toString(),
  },
});
```
Use the same pattern for DB export, changing `Content-Type` to `application/octet-stream` and extension to `.db`.

### Existing File Upload Pattern (from `/api/import/route.ts`)
```typescript
// Source: src/app/api/import/route.ts
const formData = await request.formData();
const file = formData.get('file') as File;
const arrayBuffer = await file.arrayBuffer();
```
Use the same pattern for DB import, writing `Buffer.from(arrayBuffer)` to `DB_PATH`.

### Existing DB Singleton Reset (from `db.ts` + `ingest.ts` test patterns)
```typescript
// Source: src/__tests__/lib/db.test.ts (established test pattern)
globalThis.__claudeometerDb = undefined;   // resets singleton
globalThis.__claudeometerIngestTimer = undefined;  // resets scheduler
```
The replace-import production code uses the same reset before reinitializing.

### DailyActivity Interface (from `types.ts`)
```typescript
// Source: src/lib/claude-data/types.ts
export interface DailyActivity {
  date: string;        // 'YYYY-MM-DD'
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}
```
`getProjectActivityFromDb()` returns `DailyActivity[]` — same type as `UsageOverTime` props.

### Recharts BarChart (pattern to follow from `usage-over-time.tsx`)
```typescript
// Source: src/components/charts/usage-over-time.tsx (pattern reference)
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
// Same Card wrapper, same axis styling, same metric toggle buttons
// Change: AreaChart → BarChart, Area → Bar, remove linearGradient defs
```

### SWR Hook Pattern (from `hooks.ts`)
```typescript
// Source: src/lib/hooks.ts
export function useProjectActivity(projectId: string) {
  return useSWR<DailyActivity[]>(
    `/api/projects/${encodeURIComponent(projectId)}/activity`,
    fetcher
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Streaming live SQLite file | Checkpoint WAL + copy temp file | Phase 8 (new) | Prevents corrupt exports under concurrent ingest |
| Manual aggregate SQL in merge | Call existing `recomputeAggregates()` | Phase 8 (reuse Phase 6 work) | Consistent with ingest pipeline; no new SQL needed |

**Key constraint from prior phases:**
- `reader.ts` must NOT be modified (active sessions depend on it) — confirmed from STATE.md
- DB file must stay at `~/.claude/claud-ometer.db` (Linux ext4, not NTFS) — DB-05

## Open Questions

1. **Is `recomputeAggregates` safe to export?**
   - What we know: It is a pure DB transform with no side effects; used internally after every ingest cycle.
   - What's unclear: Whether any caller outside `ingest.ts` would cause double-execution issues.
   - Recommendation: Export it. The function is idempotent (DELETE+INSERT) so calling it twice is harmless.

2. **Confirmation dialog for replace: native `window.confirm` or shadcn `AlertDialog`?**
   - What we know: The project uses shadcn/ui New York style; no `AlertDialog` is currently installed.
   - What's unclear: Whether shadcn `AlertDialog` has already been installed (not visible in the file listing).
   - Recommendation: Use `window.confirm()` for simplicity — matches the spirit of "Claude's Discretion" on UI layout, avoids adding a new shadcn component.

3. **Polling for `isCurrentlyRunning` during replace?**
   - What we know: `getSyncStatus().isRunning` is exposed from `ingest.ts`. An ingest cycle takes <1 second for most users.
   - What's unclear: How long to wait before proceeding — what if ingest is stuck?
   - Recommendation: Check `getSyncStatus().isRunning` once; if true, return a 409 with "Ingest in progress, try again in a moment." Don't poll from the API route.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30 + ts-jest 29 |
| Config file | `jest.config.js` (project root) |
| Quick run command | `npm test -- --testPathPattern="db-import\|db-export\|db-queries"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PORT-01 | Export: DB checkpointed and readable after copy | unit | `npm test -- --testPathPattern="db-export"` | ❌ Wave 0 |
| PORT-02 | Replace: old singleton closed, new DB initialized with correct schema | unit | `npm test -- --testPathPattern="db-import"` | ❌ Wave 0 |
| PORT-03 | Merge: session dedup by message_count; idempotent second merge | unit | `npm test -- --testPathPattern="db-import"` | ❌ Wave 0 |
| PORT-03 | Merge: aggregates recomputed after merge | unit | `npm test -- --testPathPattern="db-import"` | ❌ Wave 0 |
| UI-01 | getProjectActivityFromDb filters by project_id, respects 30-day window | unit | `npm test -- --testPathPattern="db-queries"` | ❌ Wave 0 (extend existing file) |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern="db-import\|db-export\|db-queries"`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/lib/db-export.test.ts` — covers PORT-01 (WAL checkpoint + copy produces valid readable DB)
- [ ] `src/__tests__/lib/db-import.test.ts` — covers PORT-02 (replace: schema intact after swap) and PORT-03 (merge: dedup by message_count, idempotent)
- [ ] `src/__tests__/lib/db-queries.test.ts` — extend existing file with `getProjectActivityFromDb` tests covering UI-01 (date filter, project_id filter, empty result)

Test pattern to follow: `src/__tests__/lib/db-queries.test.ts` — uses `createDb(tmpPath)` + `globalThis.__claudeometerDb = db` override, seeds sessions with `insertSession`, then calls query functions.

## Sources

### Primary (HIGH confidence)
- Codebase direct reads — `src/lib/db.ts`, `src/lib/ingest.ts`, `src/lib/db-queries.ts`, `src/lib/hooks.ts`, `src/lib/claude-data/types.ts`
- Codebase direct reads — `src/app/api/export/route.ts`, `src/app/api/import/route.ts` (export/import patterns)
- Codebase direct reads — `src/components/charts/usage-over-time.tsx`, `src/components/charts/activity-heatmap.tsx` (chart patterns)
- Codebase direct reads — `src/app/data/page.tsx`, `src/app/projects/[id]/page.tsx` (pages to extend)
- Codebase direct reads — `src/__tests__/lib/db.test.ts`, `src/__tests__/lib/db-queries.test.ts` (test patterns)
- `.planning/phases/08-portability-and-ui/08-CONTEXT.md` — all locked decisions
- `.planning/REQUIREMENTS.md` — PORT-01 through PORT-03, UI-01
- `.planning/STATE.md` — accumulated architectural decisions from Phases 5-7
- `jest.config.js` — test framework confirmed as Jest + ts-jest

### Secondary (MEDIUM confidence)
- SQLite ATTACH DATABASE documentation — standard SQLite feature, well-established; behavior verified through understanding of better-sqlite3 `.exec()` and `.prepare()` which pass SQL directly to SQLite engine
- WAL checkpoint pragma behavior — `wal_checkpoint(TRUNCATE)` is standard SQLite documented behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new dependencies
- Architecture: HIGH — all patterns derived directly from existing codebase; no external research needed
- Pitfalls: HIGH — derived from actual code inspection of globalThis handles, WAL file behavior, and directory structure of ZIP import

**Research date:** 2026-03-19
**Valid until:** 2026-06-19 (stable — no fast-moving dependencies; better-sqlite3 and Recharts APIs are stable)
