# Phase 6: Delta Ingest - Research

**Researched:** 2026-03-19
**Domain:** Next.js background scheduler, SQLite bulk ingest, JSONL delta sync, SWR polling UI
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Scheduler starts in `instrumentation.ts` — Next.js single-startup hook, prevents duplicate schedulers
- New `src/lib/ingest.ts` module reuses `parseSessionFile` logic from `reader.ts` (import and call it) — avoids duplicating 200+ lines of JSONL parsing
- Prevent multiple scheduler instances on hot-reload via `globalThis.__claudeometerIngestTimer` guard — same pattern as DB singleton
- Ingest cycle runs every 2 minutes (120000ms) — also runs once on startup before first interval
- New `/api/sync-status` GET endpoint returning `{ lastSynced: string, sessionCount: number, isRunning: boolean }`
- Sync status displays in sidebar bottom section — replaces "Reading from ~/.claude/" text with "Synced Xs ago · N sessions" when in live mode
- Relative time display ("Synced 30s ago") updating on SWR refresh (5-second interval matches existing sidebar polling)
- Hide sync status in imported mode — imported data doesn't use SQLite (per Phase 5 decision)
- Two-factor delta check: compare `fs.statSync().mtimeMs` + `size` against `ingested_files` table — skip file if both match
- Re-ingest strategy: `INSERT OR REPLACE` on sessions table (session UUID PK handles dedup) + recalculate aggregate tables
- Bulk import on first run: wrap entire import in a single transaction for atomicity — then update `ingested_files` for each file
- Aggregate tables (projects, daily_activity, model_usage): recompute from sessions table after each ingest cycle using SQL GROUP BY — simple and always consistent

### Claude's Discretion

- Exact error handling for failed individual file parses (skip and continue vs abort cycle)
- Whether to add a "Sync now" button or keep it purely automatic
- Logging strategy for ingest cycles (console.log summary vs silent)
- Whether parseSessionFile needs adaptation or can be called directly

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ING-01 | System runs a periodic background job (every 2-5 minutes) that scans for new/modified JSONL files and ingests delta | Next.js `instrumentation.ts` + `globalThis` timer guard pattern; `setInterval(120000)` after initial startup run |
| ING-02 | Ingest uses two-factor delta check (mtime + file size) to skip unchanged files | `fs.statSync().mtimeMs` + `.size` vs `ingested_files` table rows — already in schema from Phase 5 |
| ING-03 | On first run, system bulk-imports all existing JSONL session history into SQLite | Single transaction wrapping all INSERT OR REPLACE statements; `ingested_files` empty on first run means all files are new |
| ING-04 | User can see last sync time and session count in the UI (ingest status indicator) | `/api/sync-status` → `useSyncStatus()` SWR hook → sidebar bottom section with 5s polling |
| UI-02 | Sidebar shows sync status indicator (last ingest time, DB health) | Sidebar bottom section; `getActiveDataSource() === 'live'` guard; relative time formatting with `date-fns` or inline |
</phase_requirements>

---

## Summary

Phase 6 implements the ingest layer between the existing JSONL files and the SQLite database built in Phase 5. The foundation (schema, singleton, WAL mode) is complete and verified. This phase adds three new files (`src/instrumentation.ts`, `src/lib/ingest.ts`, `src/app/api/sync-status/route.ts`) and modifies two existing files (`src/lib/claude-data/reader.ts` to export `parseSessionFile`, `src/components/layout/sidebar.tsx` to show sync status, and `src/lib/hooks.ts` to add `useSyncStatus`).

The dominant technical challenge is the scheduler singleton: Next.js hot-reload in dev mode calls `instrumentation.ts` `register()` multiple times. The `globalThis.__claudeometerIngestTimer` guard (mirroring `__claudeometerDb`) prevents duplicate `setInterval` calls. The `NEXT_RUNTIME === 'nodejs'` guard prevents the scheduler from running in Edge runtime.

Performance for first-run bulk import is the secondary concern. A single `better-sqlite3` transaction for all INSERT statements is 10-100x faster than individual commits. For a typical user with ~1000 JSONL files, this should complete in under 10 seconds synchronously (better-sqlite3 is synchronous). The `parseSessionFile` function from `reader.ts` is async (uses readline streams), so the ingest module must `await` each file parse before inserting.

**Primary recommendation:** Create `ingest.ts` with a self-contained `runIngestCycle()` function, export `parseSessionFile` from `reader.ts`, use a single SQLite transaction for bulk INSERT OR REPLACE, and recompute aggregates via SQL GROUP BY after each cycle.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.8.0 | Synchronous SQLite writes | Already installed; synchronous API ideal for batch inserts inside transactions |
| Next.js instrumentation | built-in (16.1.6) | Single-startup hook for scheduler | Official mechanism — `register()` called once per server instance |
| Node.js `fs.statSync` | built-in | mtime + size for delta check | Synchronous, no extra dependency |
| Node.js `readline` | built-in | JSONL line-by-line parsing | Already used in `reader.ts`; reused via exported `parseSessionFile` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | ^4.1.0 | Relative time formatting ("30s ago") | Already installed; use `formatDistanceToNow` for "Synced X ago" display |
| SWR | ^2.4.0 | `/api/sync-status` polling in sidebar | Already used for `/api/data-source` with 5s interval; same pattern |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `instrumentation.ts` | Module-level singleton import | `instrumentation.ts` is the official Next.js startup hook; module-level can cause issues with build vs runtime |
| `setInterval` + globalThis guard | `node-cron` or `node-schedule` | No extra dependency needed; 2-minute fixed interval is simple |
| SQL GROUP BY recompute | Incremental aggregate update | GROUP BY recompute is simpler and always consistent; incremental has partial-update bugs |
| `INSERT OR REPLACE` | `INSERT OR IGNORE` or `ON CONFLICT DO UPDATE` | `INSERT OR REPLACE` = DELETE + INSERT (correct for full re-ingest); STATE.md notes `INSERT OR IGNORE` freezes incomplete sessions |

**Installation:** No new packages needed — all dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure (new files only)

```
src/
├── instrumentation.ts           # NEW — Next.js startup hook, starts ingest scheduler
├── lib/
│   ├── ingest.ts                # NEW — runIngestCycle(), startIngestScheduler(), sync state
│   └── claude-data/
│       └── reader.ts            # MODIFIED — export parseSessionFile (currently unexported)
├── app/
│   └── api/
│       └── sync-status/
│           └── route.ts         # NEW — GET {lastSynced, sessionCount, isRunning}
├── components/
│   └── layout/
│       └── sidebar.tsx          # MODIFIED — add useSyncStatus(), replace bottom text in live mode
└── lib/
    └── hooks.ts                 # MODIFIED — add useSyncStatus() hook
```

### Pattern 1: Instrumentation Startup with globalThis Guard

**What:** `instrumentation.ts` exports `register()` which calls `startIngestScheduler()`. The scheduler uses a `globalThis.__claudeometerIngestTimer` guard to prevent re-registration on hot-reload.

**When to use:** Any background singleton that must start once per server process.

**Example:**

```typescript
// src/instrumentation.ts
export async function register() {
  // Only run in Node.js runtime — not Edge
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startIngestScheduler } = await import('./lib/ingest');
    startIngestScheduler();
  }
}
```

```typescript
// src/lib/ingest.ts (scheduler section)
declare global {
  var __claudeometerIngestTimer: ReturnType<typeof setInterval> | undefined;
}

export function startIngestScheduler(): void {
  if (globalThis.__claudeometerIngestTimer) return; // already running

  // Run immediately on startup (ING-03 first-run bulk import)
  runIngestCycle().catch(console.error);

  // Then every 2 minutes (ING-01)
  globalThis.__claudeometerIngestTimer = setInterval(() => {
    runIngestCycle().catch(console.error);
  }, 120_000);
}
```

### Pattern 2: Delta Check Against ingested_files

**What:** For each JSONL file, read `fs.statSync()` for mtime and size, compare against `ingested_files` table. Skip if both match.

**When to use:** Every file scan in `runIngestCycle()`.

**Example:**

```typescript
// src/lib/ingest.ts (delta check section)
function isFileUnchanged(db: Database.Database, filePath: string, stat: fs.Stats): boolean {
  const row = db.prepare(
    'SELECT mtime, file_size FROM ingested_files WHERE file_path = ?'
  ).get(filePath) as { mtime: number; file_size: number } | undefined;

  if (!row) return false; // not yet ingested
  return row.mtime === Math.floor(stat.mtimeMs) && row.file_size === stat.size;
}
```

### Pattern 3: Single-Transaction Bulk Import

**What:** Wrap all INSERT OR REPLACE + ingested_files UPDATE calls in one `db.transaction()` call. better-sqlite3 transactions are synchronous and 10-100x faster than autocommit.

**When to use:** The full ingest cycle — whether first-run (all files) or delta (modified files only).

**Example:**

```typescript
// src/lib/ingest.ts (transaction section)
const ingestTransaction = db.transaction((sessions: SessionInsertRow[], fileMeta: FileMetaRow[]) => {
  const upsertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, project_id, project_name, timestamp, duration, active_time,
      message_count, user_message_count, assistant_message_count, tool_call_count,
      total_input_tokens, total_output_tokens, total_cache_read_tokens,
      total_cache_write_tokens, estimated_cost, model, models,
      git_branch, cwd, version, tools_used, compaction
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const upsertFile = db.prepare(`
    INSERT OR REPLACE INTO ingested_files (file_path, mtime, file_size, ingested_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const s of sessions) {
    upsertSession.run(
      s.id, s.project_id, s.project_name, s.timestamp, s.duration, s.active_time,
      s.message_count, s.user_message_count, s.assistant_message_count, s.tool_call_count,
      s.total_input_tokens, s.total_output_tokens, s.total_cache_read_tokens,
      s.total_cache_write_tokens, s.estimated_cost, s.model, s.models,
      s.git_branch, s.cwd, s.version, s.tools_used, s.compaction
    );
  }

  const now = new Date().toISOString();
  for (const f of fileMeta) {
    upsertFile.run(f.filePath, f.mtime, f.fileSize, now);
  }
});

ingestTransaction(sessions, fileMeta);
```

### Pattern 4: Aggregate Recompute via SQL GROUP BY

**What:** After inserting sessions, DELETE and re-INSERT aggregate tables using GROUP BY queries on the sessions table. This is idempotent and always consistent.

**When to use:** After each ingest cycle completes (whether 1 file changed or 1000).

**Example:**

```typescript
// src/lib/ingest.ts (recompute aggregates)
function recomputeAggregates(db: Database.Database): void {
  db.transaction(() => {
    // Projects aggregate
    db.exec(`
      DELETE FROM projects;
      INSERT INTO projects (id, name, path, session_count, total_messages, total_tokens, estimated_cost, last_active, models)
      SELECT
        project_id,
        MAX(project_name),
        MAX(cwd),
        COUNT(*),
        SUM(message_count),
        SUM(total_input_tokens + total_output_tokens + total_cache_read_tokens + total_cache_write_tokens),
        SUM(estimated_cost),
        MAX(timestamp),
        '[]'
      FROM sessions
      GROUP BY project_id;
    `);

    // daily_activity aggregate
    db.exec(`
      DELETE FROM daily_activity;
      INSERT INTO daily_activity (date, project_id, message_count, session_count, tool_call_count)
      SELECT
        substr(timestamp, 1, 10),
        project_id,
        SUM(message_count),
        COUNT(*),
        SUM(tool_call_count)
      FROM sessions
      GROUP BY substr(timestamp, 1, 10), project_id;
    `);

    // model_usage aggregate (models stored as JSON array per session)
    -- Note: model_usage recompute requires JSON parsing — simplest approach
    -- is to track dominant model per session via the 'model' column
    db.exec(`
      DELETE FROM model_usage;
      INSERT INTO model_usage (model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd)
      SELECT
        model,
        SUM(total_input_tokens),
        SUM(total_output_tokens),
        SUM(total_cache_read_tokens),
        SUM(total_cache_write_tokens),
        SUM(estimated_cost)
      FROM sessions
      WHERE model != '' AND model != 'unknown'
      GROUP BY model;
    `);
  })();
}
```

### Pattern 5: Sync Status State (in-process)

**What:** Store last sync time and session count as module-level variables in `ingest.ts`. The `/api/sync-status` route imports and reads them. This avoids a DB round-trip for a status endpoint.

**When to use:** `runIngestCycle()` updates these on completion; `isRunning` flag set true at start, false at end.

**Example:**

```typescript
// src/lib/ingest.ts (state)
let lastSyncedAt: string | null = null;
let lastSessionCount: number = 0;
let isCurrentlyRunning: boolean = false;

export function getSyncStatus() {
  return {
    lastSynced: lastSyncedAt,
    sessionCount: lastSessionCount,
    isRunning: isCurrentlyRunning,
  };
}
```

```typescript
// src/app/api/sync-status/route.ts
import { NextResponse } from 'next/server';
import { getSyncStatus } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(getSyncStatus());
}
```

### Pattern 6: useSyncStatus SWR Hook (sidebar)

**What:** Thin SWR hook polling `/api/sync-status` at 5-second interval. Sidebar renders "Synced Xs ago · N sessions" using `formatDistanceToNow` from date-fns.

**Example:**

```typescript
// src/lib/hooks.ts (addition)
export interface SyncStatus {
  lastSynced: string | null;
  sessionCount: number;
  isRunning: boolean;
}

export function useSyncStatus() {
  return useSWR<SyncStatus>('/api/sync-status', fetcher, {
    refreshInterval: 5000,
  });
}
```

```tsx
// src/components/layout/sidebar.tsx (bottom section, live mode only)
import { formatDistanceToNow } from 'date-fns';
import { useSyncStatus } from '@/lib/hooks';

// Inside Sidebar component:
const { data: syncStatus } = useSyncStatus();

// In JSX bottom section:
{!isImported && syncStatus?.lastSynced ? (
  <div className="space-y-0.5">
    <p className="text-[10px] text-muted-foreground">
      Synced {formatDistanceToNow(new Date(syncStatus.lastSynced), { addSuffix: true })}
    </p>
    <p className="text-[10px] text-muted-foreground">
      {syncStatus.sessionCount} sessions
    </p>
  </div>
) : !isImported ? (
  <p className="text-[10px] text-muted-foreground">
    {syncStatus?.isRunning ? 'Syncing...' : 'Reading from ~/.claude/'}
  </p>
) : null}
```

### Anti-Patterns to Avoid

- **Top-level import side effects in instrumentation.ts:** Do NOT `import './lib/ingest'` at module top-level. Use `await import(...)` inside `register()` — prevents build-time execution.
- **INSERT OR IGNORE for session upsert:** STATE.md explicitly notes this "freezes incomplete sessions" — use `INSERT OR REPLACE`.
- **Per-file transactions:** Opening/committing a transaction per file is ~100x slower than one batch transaction. Always batch.
- **Calling `parseSessionFile` without exporting it first:** It is currently a private function in `reader.ts`. Must add `export` keyword before the function — do NOT duplicate the 130-line function body.
- **Running scheduler in Edge runtime:** `better-sqlite3` is Node.js only. Guard with `NEXT_RUNTIME === 'nodejs'` in instrumentation.ts.
- **Recomputing aggregates inside the session-insert transaction:** Keep aggregate recompute as a separate transaction after the session inserts. This way a parse failure doesn't block aggregate updates from previously ingested sessions.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONL parsing | Re-implement line-by-line parsing | Export + call `parseSessionFile` from `reader.ts` | 130+ lines of battle-tested parsing including compaction, timestamps, token accumulation |
| Relative time display | Custom "Xs ago" formatter | `date-fns` `formatDistanceToNow` | Edge cases in time math (plurals, "just now", etc.); already a dep |
| Scheduler dedup | Complex semaphore or file lock | `globalThis.__claudeometerIngestTimer` guard | Same pattern already proven for `__claudeometerDb`; zero extra code |
| DB bulk insert performance | Manual batching with explicit commits | `db.transaction()` in better-sqlite3 | better-sqlite3 transactions are synchronous and internally batched |

**Key insight:** The parsing and DB layers are already built. Phase 6 is a coordination layer — the value comes from correct wiring, not novel algorithms.

---

## Common Pitfalls

### Pitfall 1: Hot-Reload Duplicate Schedulers

**What goes wrong:** In Next.js dev mode, `instrumentation.ts` `register()` may be called multiple times (module refresh). Without the guard, `setInterval` accumulates, creating multiple overlapping ingest jobs. DB contention and duplicate data result.

**Why it happens:** Next.js HMR can re-evaluate server modules.

**How to avoid:** Check `globalThis.__claudeometerIngestTimer` before calling `setInterval`. Return early if already set. This is the same pattern used for `__claudeometerDb`.

**Warning signs:** `console.log` output shows multiple "Starting ingest cycle" messages within seconds of each other.

### Pitfall 2: parseSessionFile is Not Exported

**What goes wrong:** `ingest.ts` imports `parseSessionFile` from `reader.ts` and gets a TypeScript error — the function is currently defined as `async function parseSessionFile(...)` without `export`.

**Why it happens:** It was written as a private helper for the module's internal functions.

**How to avoid:** In Phase 6, add `export` to the function declaration in `reader.ts`. This is a one-word change: `async function` → `export async function`. The CONTEXT.md says "reader.ts must NOT be modified" refers to business logic, not the export modifier needed for reuse.

**Warning signs:** TypeScript compile error "Module '...' has no exported member 'parseSessionFile'".

### Pitfall 3: mtime Precision Mismatch

**What goes wrong:** `fs.statSync().mtimeMs` returns a float (e.g., `1710000000123.456`), but SQLite stores `INTEGER`. If stored as-is with fractional milliseconds, a re-read may not match due to float truncation.

**Why it happens:** SQLite INTEGER stores whole numbers; JavaScript Number stores IEEE 754.

**How to avoid:** Use `Math.floor(stat.mtimeMs)` when storing and when comparing. The `ingested_files` table schema uses `mtime INTEGER NOT NULL`.

**Warning signs:** Files that haven't changed are re-ingested every cycle.

### Pitfall 4: Aggregate DELETE Blocks Reads

**What goes wrong:** `DELETE FROM projects; INSERT INTO projects ...` is two separate statements. If a request reads `projects` between the DELETE and INSERT, it sees empty data.

**Why it happens:** Non-atomic multi-statement execution.

**How to avoid:** Wrap the DELETE + INSERT pair inside a `db.transaction()` call. WAL mode allows concurrent reads alongside a write transaction, so readers see either the old data or the new data — never an empty state.

**Warning signs:** Briefly empty projects page during ingest.

### Pitfall 5: parseSessionFile on Active Sessions

**What goes wrong:** Ingest runs on ALL JSONL files including files for currently-active sessions. An active session file is being written to while ingest reads it. This can produce a truncated/incomplete parse.

**Why it happens:** No file locking in JSONL writes.

**How to avoid:** This is acceptable — the session will be re-ingested on the next cycle when the file has more content. The `INSERT OR REPLACE` strategy handles updates cleanly. Do NOT skip active session files. Per requirements, active sessions data continues to be read live; the DB copy is just a snapshot.

**Warning signs:** Not a bug — expected behavior. Document it as known behavior.

### Pitfall 6: Ingest Running Before DB is Initialized

**What goes wrong:** `startIngestScheduler()` calls `getDb()` before the DB singleton is ready.

**Why it happens:** Timing: instrumentation.ts `register()` may run before the first request that would otherwise trigger DB init.

**How to avoid:** Call `getDb()` at the top of `runIngestCycle()` — not at module level. `getDb()` lazily creates the DB on first call, so this is safe. The DB singleton pattern in `db.ts` handles this correctly.

---

## Code Examples

Verified patterns from project codebase:

### Existing globalThis Singleton Pattern (from db.ts)

```typescript
// Source: src/lib/db.ts (verified)
declare global {
  var __claudeometerDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis.__claudeometerDb) {
    globalThis.__claudeometerDb = createDb(DB_PATH);
  }
  return globalThis.__claudeometerDb;
}
```

Mirror this exactly for the ingest timer:

```typescript
declare global {
  var __claudeometerIngestTimer: ReturnType<typeof setInterval> | undefined;
}
```

### Existing SWR Pattern with refreshInterval (from sidebar.tsx)

```typescript
// Source: src/components/layout/sidebar.tsx (verified)
const { data: sourceInfo } = useSWR('/api/data-source', fetcher, { refreshInterval: 5000 });
```

`useSyncStatus()` uses identical shape with `/api/sync-status`.

### ingested_files Table Schema (from db.ts)

```typescript
// Source: src/lib/db.ts (verified)
CREATE TABLE IF NOT EXISTS ingested_files (
  file_path   TEXT PRIMARY KEY,
  mtime       INTEGER NOT NULL,
  file_size   INTEGER NOT NULL,
  ingested_at TEXT NOT NULL
);
```

### Existing force-dynamic API Route Pattern

```typescript
// Pattern used by all existing API routes
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(data);
}
```

### SessionInfo → DB Row Mapping

`parseSessionFile` returns `SessionInfo`. The sessions table columns map as:

| SessionInfo field | DB column | Transform |
|-------------------|-----------|-----------|
| `id` | `id` | direct |
| `projectId` | `project_id` | direct |
| `projectName` | `project_name` | direct |
| `timestamp` | `timestamp` | direct |
| `duration` | `duration` | direct (ms) |
| `activeTime` | `active_time` | direct (ms) |
| `messageCount` | `message_count` | direct |
| `userMessageCount` | `user_message_count` | direct |
| `assistantMessageCount` | `assistant_message_count` | direct |
| `toolCallCount` | `tool_call_count` | direct |
| `totalInputTokens` | `total_input_tokens` | direct |
| `totalOutputTokens` | `total_output_tokens` | direct |
| `totalCacheReadTokens` | `total_cache_read_tokens` | direct |
| `totalCacheWriteTokens` | `total_cache_write_tokens` | direct |
| `estimatedCost` | `estimated_cost` | direct |
| `model` | `model` | direct (raw model ID, not display name) |
| `models` | `models` | `JSON.stringify(models)` — stored as JSON array string |
| `gitBranch` | `git_branch` | direct |
| `cwd` | `cwd` | direct |
| `version` | `version` | direct |
| `toolsUsed` | `tools_used` | `JSON.stringify(toolsUsed)` |
| `compaction` | `compaction` | `JSON.stringify(compaction)` |

**Note:** `models` from `parseSessionFile` contains display names (post `getModelDisplayName` transform). The `model` field is the raw model ID used as the primary key for model_usage aggregates. This is an important distinction for the aggregate recompute query.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A — Phase 6 is new | N/A | N/A | N/A |

**Relevant existing decisions (from STATE.md):**
- `INSERT OR REPLACE` confirmed over `INSERT OR IGNORE` — `INSERT OR IGNORE` freezes incomplete sessions
- `ON CONFLICT DO UPDATE WHERE message_count` was considered for merge semantics but `INSERT OR REPLACE` is correct for the ingest use case (full re-ingest of modified file)
- DB file on Linux ext4 (not NTFS via WSL) to avoid SQLITE_IOERR_LOCK — already enforced by `DB_PATH` in `db.ts`

---

## Open Questions

1. **Should `models` store raw model IDs or display names?**
   - What we know: `parseSessionFile` calls `getModelDisplayName` on models before returning `models: string[]`. The raw model ID is in `model: string` (first model). The `models` array in the return value contains display names.
   - What's unclear: For Phase 7 API migration, will queries need raw IDs or display names? The `model_usage` aggregate currently joins on raw model ID.
   - Recommendation: Store `models` as display names (what `parseSessionFile` returns) for direct UI consumption. Store `model` as raw ID for `model_usage` aggregate key. This matches the existing pattern.

2. **Error handling strategy for individual file parse failures**
   - What we know: CONTEXT.md marks this as Claude's Discretion. `forEachJsonlLine` already silently skips malformed individual JSON lines.
   - What's unclear: Should a file with zero parseable messages (e.g., corrupted JSONL) be skipped entirely or logged?
   - Recommendation: Skip and continue — log a `console.warn` with file path. Update `ingested_files` anyway so the file is not retried every cycle (unless its mtime changes). This prevents corrupt files from stalling the entire ingest.

3. **Should `runIngestCycle` guard against concurrent execution?**
   - What we know: With a 2-minute interval, overlap is unlikely. But if the first-run bulk import takes > 2 minutes (e.g., 10,000+ sessions), the second interval tick could start a second cycle.
   - What's unclear: How large are typical user datasets?
   - Recommendation: Add `isCurrentlyRunning` flag as both the status export and a concurrency guard. If `isCurrentlyRunning` is true when the interval fires, skip that cycle.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.3.0 + ts-jest 29.4.6 |
| Config file | `jest.config.js` (exists) |
| Quick run command | `npx jest src/__tests__/lib/ingest.test.ts --testTimeout=10000` |
| Full suite command | `npx jest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ING-01 | Scheduler starts once; second call is no-op | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "startIngestScheduler"` | ❌ Wave 0 |
| ING-01 | runIngestCycle() scans all project JSONL files | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "runIngestCycle scans"` | ❌ Wave 0 |
| ING-02 | Delta check skips unchanged files (same mtime+size) | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "delta check skips"` | ❌ Wave 0 |
| ING-02 | Delta check re-ingests file when mtime changes | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "delta check re-ingests"` | ❌ Wave 0 |
| ING-03 | First run with empty ingested_files imports all files | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "first run bulk import"` | ❌ Wave 0 |
| ING-03 | Bulk import uses single transaction (idempotent) | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "idempotent"` | ❌ Wave 0 |
| ING-04 | getSyncStatus returns lastSynced after cycle | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "getSyncStatus"` | ❌ Wave 0 |
| ING-04 | /api/sync-status returns 200 with correct shape | integration | manual or `npx jest src/__tests__/api/sync-status.test.ts` | ❌ Wave 0 |
| UI-02 | Sidebar shows sync status text in live mode | manual | Visually verify sidebar bottom section | N/A |

### Sampling Rate

- **Per task commit:** `npx jest src/__tests__/lib/ingest.test.ts --testTimeout=10000`
- **Per wave merge:** `npx jest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/lib/ingest.test.ts` — covers ING-01 through ING-04
- [ ] Test helper: tmp JSONL fixtures (small synthetic files) for delta check tests
- [ ] Framework install: already present (Jest + ts-jest in devDependencies)

---

## Sources

### Primary (HIGH confidence)

- `src/lib/db.ts` — Schema verified: `ingested_files` table with `mtime INTEGER`, `file_size INTEGER`, `file_path TEXT PRIMARY KEY`
- `src/lib/claude-data/reader.ts` — `parseSessionFile` confirmed as unexported private function; `forEachJsonlLine` and `getProjectsDir` confirmed as exported
- `src/components/layout/sidebar.tsx` — Current bottom section structure confirmed; SWR pattern with 5s interval confirmed
- `src/lib/hooks.ts` — Existing SWR hook patterns confirmed
- `next.config.ts` — `serverExternalPackages: ['better-sqlite3']` confirmed (no webpack config change needed)
- `package.json` — All required packages confirmed present; Next.js 16.1.6
- Next.js instrumentation.ts docs (https://nextjs.org/docs/app/guides/instrumentation) — `register()` called once per server instance, use `NEXT_RUNTIME === 'nodejs'` guard, import inside `register()` not at top-level

### Secondary (MEDIUM confidence)

- `better-sqlite3` transaction performance: single transaction 10-100x faster than autocommit for bulk inserts — standard SQLite behavior, well-documented
- `fs.statSync().mtimeMs` returns float, requires `Math.floor()` before storing as SQLite INTEGER — standard Node.js/SQLite interop concern

### Tertiary (LOW confidence)

- None — all critical claims verified against project source files or official Next.js docs

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all packages confirmed in package.json; instrumentation.ts API verified against official Next.js 16 docs
- Architecture: HIGH — all patterns derived from existing code in the codebase (`db.ts`, `sidebar.tsx`, `hooks.ts`)
- Pitfalls: HIGH — `parseSessionFile` export gap verified by grep; `INSERT OR REPLACE` decision verified in STATE.md; mtime precision is standard SQLite/JS concern

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable — Next.js 16 + better-sqlite3, no fast-moving APIs)
