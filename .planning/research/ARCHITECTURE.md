# Architecture Research

**Domain:** SQLite persistence + background JSONL ingest integrated into existing Next.js 16 App Router analytics dashboard
**Researched:** 2026-03-19
**Confidence:** HIGH — based on direct codebase analysis of existing architecture; SQLite integration patterns confirmed via official docs and community sources

---

## Context: What Already Exists

This is a subsequent-milestone document. v1.0 shipped a working analytics dashboard. The architecture below describes how v1.1 (History Database) integrates SQLite into the existing system without breaking or replacing what works.

**Existing stack (do not change):**
- Next.js 16 App Router, `force-dynamic` API routes
- `src/lib/claude-data/reader.ts` — JSONL parsing, stat aggregation, search
- `src/lib/claude-data/active-sessions.ts` — tail-read + mtime, real-time detection
- `src/lib/claude-data/data-source.ts` — live vs imported data toggle
- SWR hooks in `src/lib/hooks.ts`
- ZIP-based export/import in `/api/export` and `/api/import`

**The core problem with the current approach:**
Every API request re-parses JSONL files from scratch. `getProjects()` reads all JSONL in all project directories; `getDashboardStats()` iterates all recently-modified files line by line. This is acceptable at small scale but becomes slow as session history grows. SQLite provides a persistent parsed cache so pages load from a database query instead of a full filesystem scan.

---

## System Overview

### v1.1 Architecture: Two-Path Data Access

```
┌─────────────────────────────────────────────────────────────────────┐
│                         UI Layer (React / SWR)                       │
│                                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌─────────┐  │
│  │/overview │  │/sessions │  │/projects │  │/costs  │  │/active  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  └────┬────┘  │
│       └─────────────┴─────────────┴─────────────┴────────────┘      │
│                            │ SWR fetch (on-demand)                   │
│                            │ (active: 5s interval, rest: focus-reval)│
├────────────────────────────┼────────────────────────────────────────┤
│                     API Layer (Next.js route handlers)               │
│                            │                                         │
│  ┌─────────────────────────┼──────────────────────────────────────┐  │
│  │   /api/stats    /api/projects    /api/sessions    /api/sessions/[id] │
│  │           (MODIFIED — reads from SQLite via db-reader.ts)      │  │
│  └─────────────────────────┬──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │   /api/active-sessions  (UNCHANGED — still JSONL tail-read)  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │   /api/ingest   (NEW — trigger manual ingest or return status) │   │
│  └──────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │   /api/export   /api/import   (MODIFIED — .db file support)  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │   /api/db-merge  (NEW — merge two .db files by session ID)   │    │
│  └──────────────────────────────────────────────────────────────┘    │
├────────────────────────────────────────────────────────────────────┤
│                         Data Layer                                   │
│                                                                       │
│  ┌───────────────────────────┐   ┌─────────────────────────────┐     │
│  │  db.ts (singleton)        │   │  ingest.ts                  │     │
│  │  better-sqlite3 connection│   │  JSONL → SQLite delta sync   │     │
│  │  getDb() with globalThis  │   │  tracks ingested_files table │     │
│  │  cache                    │   │  + node-cron scheduler       │     │
│  └──────────────┬────────────┘   └──────────────┬──────────────┘     │
│                 │ SQL queries              │ writes to DB             │
│  ┌──────────────▼────────────────────────▼──────────────────────┐    │
│  │                  claud-ometer.db                              │    │
│  │  sessions, session_messages, projects, ingested_files tables  │    │
│  └──────────────────────────────────────────────────────────────┘    │
├────────────────────────────────────────────────────────────────────┤
│                       Filesystem                                     │
│                                                                       │
│  ┌──────────────────────────┐   ┌─────────────────────────────┐      │
│  │  ~/.claude/projects/     │   │  .dashboard-data/           │      │
│  │  <projectId>/            │   │  claud-ometer.db (live DB)  │      │
│  │  <sessionId>.jsonl       │   │  or imported .db file       │      │
│  └──────────────────────────┘   └─────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|---------------|--------|
| `src/lib/claude-data/db.ts` | better-sqlite3 singleton via globalThis; opens/creates DB; runs schema migrations | NEW |
| `src/lib/claude-data/schema.ts` | SQL DDL for all tables; versioned migration runner | NEW |
| `src/lib/claude-data/ingest.ts` | Reads JSONL delta (new/modified files), writes to DB; tracks ingested state | NEW |
| `src/lib/claude-data/db-reader.ts` | SQL queries that replace JSONL-based functions in `reader.ts` | NEW |
| `src/lib/claude-data/db-merge.ts` | Opens two DB files; deduplicates sessions by ID; writes merged output | NEW |
| `src/lib/claude-data/reader.ts` | UNCHANGED — still used by active-sessions.ts; JSONL path stays live | UNCHANGED |
| `src/lib/claude-data/active-sessions.ts` | UNCHANGED — tail-read JSONL forever; active sessions bypass DB | UNCHANGED |
| `src/lib/claude-data/data-source.ts` | EXTENDED — `getDbPath()` respects live vs imported toggle | MODIFIED |
| `src/app/api/stats/route.ts` | MODIFIED — delegates to `db-reader.ts` instead of `reader.ts` | MODIFIED |
| `src/app/api/projects/route.ts` | MODIFIED — delegates to `db-reader.ts` | MODIFIED |
| `src/app/api/sessions/route.ts` | MODIFIED — delegates to `db-reader.ts` | MODIFIED |
| `src/app/api/sessions/[id]/route.ts` | MODIFIED — delegates to `db-reader.ts` | MODIFIED |
| `src/app/api/ingest/route.ts` | NEW — POST triggers manual ingest; GET returns last-ingest timestamp | NEW |
| `src/app/api/export/route.ts` | MODIFIED — adds .db file export alongside or instead of ZIP | MODIFIED |
| `src/app/api/import/route.ts` | MODIFIED — accepts .db file upload; places in .dashboard-data/ | MODIFIED |
| `src/app/api/db-merge/route.ts` | NEW — POST accepts second .db file; runs merge; returns stats | NEW |
| `src/app/projects/[id]/page.tsx` | MODIFIED — adds activity heatmap chart (new component) | MODIFIED |

---

## Recommended Project Structure

New files only. Existing structure is unchanged.

```
src/
├── app/
│   └── api/
│       ├── ingest/
│       │   └── route.ts          # POST: run delta ingest, GET: ingest status
│       └── db-merge/
│           └── route.ts          # POST: merge uploaded .db file into live DB
├── components/
│   └── charts/
│       └── project-activity.tsx  # Activity heatmap for project detail page
└── lib/
    └── claude-data/
        ├── db.ts                 # better-sqlite3 singleton connection
        ├── schema.ts             # DDL + schema version migrations
        ├── ingest.ts             # JSONL → SQLite delta sync + node-cron
        ├── db-reader.ts          # SQL-based replacements for reader.ts functions
        └── db-merge.ts           # Cross-machine database merge with dedup
```

### Structure Rationale

- **`db.ts` separate from `schema.ts`:** The singleton connection is a runtime concern; schema DDL is a definition concern. Separating them allows schema tests to run without a live DB connection, and makes migrations easier to reason about independently.
- **`db-reader.ts` does NOT replace `reader.ts`:** `active-sessions.ts` still imports from `reader.ts`. Replacing reader would break the active sessions feature. The two coexist: `reader.ts` is JSONL-only, `db-reader.ts` is SQL-only. API routes switch which one they call.
- **`ingest.ts` owns the cron scheduler:** The scheduler is instantiated in a module-level side effect inside `ingest.ts`. Next.js loads this module when any route imports it (e.g., `/api/ingest/route.ts`), which starts the scheduler on server startup. This works in the local serverful context (not Vercel/serverless).
- **`db-merge.ts` as pure function:** No side effects beyond opening files and writing the output. Can be called from the API route or from a CLI script if needed.

---

## Database Schema

### Tables

```sql
-- Tracks which JSONL files have been ingested and their last-known mtime
CREATE TABLE ingested_files (
  file_path   TEXT PRIMARY KEY,
  mtime_ms    INTEGER NOT NULL,
  ingested_at TEXT NOT NULL   -- ISO timestamp
);

-- One row per session (fully parsed aggregates)
CREATE TABLE sessions (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  project_name          TEXT NOT NULL,
  project_path          TEXT NOT NULL,
  timestamp             TEXT NOT NULL,    -- first message ISO timestamp
  duration_ms           INTEGER NOT NULL,
  active_time_ms        INTEGER NOT NULL,
  message_count         INTEGER NOT NULL,
  user_message_count    INTEGER NOT NULL,
  assistant_message_count INTEGER NOT NULL,
  tool_call_count       INTEGER NOT NULL,
  total_input_tokens    INTEGER NOT NULL,
  total_output_tokens   INTEGER NOT NULL,
  total_cache_read_tokens   INTEGER NOT NULL,
  total_cache_write_tokens  INTEGER NOT NULL,
  estimated_cost        REAL NOT NULL,
  model                 TEXT NOT NULL,
  models_json           TEXT NOT NULL,    -- JSON array of model names
  git_branch            TEXT,
  cwd                   TEXT,
  version               TEXT,
  tools_used_json       TEXT NOT NULL,    -- JSON object {toolName: count}
  compaction_json       TEXT NOT NULL,    -- JSON CompactionInfo
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Aggregated project stats (computed on ingest, not queried live)
CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  path            TEXT NOT NULL,
  session_count   INTEGER NOT NULL DEFAULT 0,
  total_messages  INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  estimated_cost  REAL NOT NULL DEFAULT 0,
  last_active     TEXT NOT NULL,
  models_json     TEXT NOT NULL    -- JSON array
);

-- Schema version for migrations
CREATE TABLE schema_version (
  version  INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

### Design Decisions

- **JSON columns for arrays/objects** (`models_json`, `tools_used_json`, `compaction_json`): SQLite doesn't have array types. JSON serialization keeps the schema flat and maps cleanly to/from existing TypeScript types without complex join tables. These columns are not filtered on in SQL — they are deserialized in TypeScript after retrieval.
- **`ingested_files` tracks mtime not content hash**: mtime comparison is O(1) filesystem stat; hashing JSONL files requires reading them. For delta detection, mtime is sufficient and matches the existing `supplementalStats` approach in `reader.ts`.
- **`projects` table is denormalized**: Project stats are a sum of session stats. Computing them at query time via SQL aggregations would work but adds latency. Recomputing on ingest and caching in the `projects` table keeps API routes simple.
- **No `session_messages` table for v1.1**: Full conversation replay (`SessionDetail.messages`) still reads directly from JSONL. Storing every message in SQLite would increase DB size substantially without a clear benefit — the session detail page is infrequently loaded and parsing one JSONL file is fast. This is a deliberate scope exclusion.

---

## Architectural Patterns

### Pattern 1: Singleton DB Connection via globalThis

**What:** A module-level singleton that caches the `better-sqlite3` connection on `global` to survive Next.js hot-reload in development without creating multiple connections.

**When to use:** Any time a server-side resource (DB connection, file handle, long-lived object) needs to persist across Next.js module re-evaluations in `next dev`.

**Trade-offs:**
- Pro: Prevents "database is locked" errors from concurrent open connections during hot reload
- Pro: Production behaviour is unaffected — the process starts once, the module loads once
- Con: globalThis is shared across all modules — use a namespaced key to avoid collisions

**Example:**
```typescript
// src/lib/claude-data/db.ts
import Database from 'better-sqlite3';
import path from 'path';
import { getDbPath } from './data-source';

const GLOBAL_KEY = '__claud_ometer_db__';

type Global = typeof globalThis & { [GLOBAL_KEY]?: Database.Database };

export function getDb(): Database.Database {
  const g = globalThis as Global;
  if (!g[GLOBAL_KEY] || !g[GLOBAL_KEY]!.open) {
    g[GLOBAL_KEY] = new Database(getDbPath());
    g[GLOBAL_KEY]!.pragma('journal_mode = WAL');
    g[GLOBAL_KEY]!.pragma('foreign_keys = ON');
    runMigrations(g[GLOBAL_KEY]!);
  }
  return g[GLOBAL_KEY]!;
}
```

WAL mode is essential: it allows concurrent readers without blocking the ingest writer.

### Pattern 2: Delta Ingest via mtime Comparison

**What:** Before parsing a JSONL file, check its current mtime against the value stored in `ingested_files`. Skip if mtime is unchanged; re-parse and upsert if mtime is newer or file is not yet in the table.

**When to use:** Periodic background sync where the source data grows but is rarely modified after the fact (JSONL files are append-only in normal Claude Code operation).

**Trade-offs:**
- Pro: O(1) check per file — stat() is very fast; avoids re-parsing files that haven't changed
- Pro: Handles new sessions (new files) and extended sessions (mtime changed on existing file) correctly
- Con: If a JSONL file is backdated (unusual), the delta check misses it — acceptable for this use case
- Con: First ingest of a large history collection will be slow (parse everything) — mitigated by running it as a background job, not blocking the request

**Example:**
```typescript
// src/lib/claude-data/ingest.ts
export async function runDeltaIngest(): Promise<IngestResult> {
  const db = getDb();
  const projectsDir = getProjectsDir();
  let ingested = 0, skipped = 0;

  for (const projectId of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, projectId);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    for (const file of fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))) {
      const filePath = path.join(projectPath, file);
      const { mtimeMs } = fs.statSync(filePath);

      const existing = db.prepare(
        'SELECT mtime_ms FROM ingested_files WHERE file_path = ?'
      ).get(filePath) as { mtime_ms: number } | undefined;

      if (existing && existing.mtime_ms === mtimeMs) {
        skipped++;
        continue;
      }

      // Parse and upsert
      const session = await parseSessionFile(filePath, projectId, projectName);
      upsertSession(db, session);

      db.prepare(`
        INSERT OR REPLACE INTO ingested_files (file_path, mtime_ms, ingested_at)
        VALUES (?, ?, ?)
      `).run(filePath, mtimeMs, new Date().toISOString());

      ingested++;
    }
  }

  rebuildProjectStats(db);  // recompute project aggregates after session upserts
  return { ingested, skipped };
}
```

### Pattern 3: Background Ingest with node-cron

**What:** Schedule `runDeltaIngest()` to run every N minutes using `node-cron`. The scheduler is started when `ingest.ts` is first imported (module-level side effect).

**When to use:** Local-first serverful Next.js deployment where the process stays alive indefinitely. This is the Claud-ometer use case (local `npm start`).

**Trade-offs:**
- Pro: Zero user interaction required; DB stays current automatically
- Pro: node-cron is lightweight and has no external dependencies
- Con: Does not work on serverless (Vercel, etc.) — not a concern for this local-first app
- Con: Module-level side effects can be surprising in tests — export a `startScheduler()` function and call it explicitly from `ingest.ts` module initialization, making it easy to suppress in tests

**Recommended schedule:** Every 2 minutes. This is fast enough that the DB is never more than 2 minutes stale, but not so frequent that it adds continuous I/O load.

```typescript
// Module-level initialization in ingest.ts
import cron from 'node-cron';

// Run ingest every 2 minutes
cron.schedule('*/2 * * * *', () => {
  runDeltaIngest().catch(err => console.error('[ingest] delta ingest failed:', err));
});
```

### Pattern 4: API Routes Switch from reader.ts to db-reader.ts

**What:** The historical API routes (`/api/stats`, `/api/projects`, `/api/sessions`, `/api/sessions/[id]`) currently call functions from `reader.ts`. In v1.1, they instead call equivalent functions from `db-reader.ts`. The function signatures return the same TypeScript types (`DashboardStats`, `ProjectInfo[]`, etc.) so the routes themselves change minimally.

**When to use:** When replacing a data source without changing the contract. The API response shape stays identical so all SWR hooks and UI components require zero changes.

**Trade-offs:**
- Pro: UI layer is entirely unaffected — same types, same API contract
- Pro: reader.ts remains intact for active-sessions.ts — no regression risk
- Con: Two parallel implementations of "how to get sessions" — this is intentional and the JSONL path will eventually be deprecated once DB is proven stable

**Migration approach:**
```typescript
// src/app/api/sessions/route.ts — BEFORE
import { getSessions, getProjectSessions, searchSessions } from '@/lib/claude-data/reader';

// src/app/api/sessions/route.ts — AFTER
import { getSessions, getProjectSessions, searchSessions } from '@/lib/claude-data/db-reader';
// Function signatures are identical; response shape is identical
```

### Pattern 5: DB Merge by Session ID Deduplication

**What:** Open two DB files (live and imported), iterate sessions from the imported DB, and INSERT OR IGNORE into the live DB based on the primary key `id`. Projects table is then rebuilt from session aggregates.

**When to use:** Cross-machine portability where sessions are uniquely identified by their UUID-based filename (session ID is already globally unique from Claude Code's JSONL naming convention).

**Trade-offs:**
- Pro: Session IDs are UUIDs from Claude Code — collision probability is negligible
- Pro: INSERT OR IGNORE means re-merging an already-merged DB is idempotent
- Con: If the same session was extended on two machines (unusual but possible in theory), the first-written version wins — acceptable

```typescript
// src/lib/claude-data/db-merge.ts
export function mergeDatabases(liveDbPath: string, importedDbPath: string): MergeResult {
  const liveDb = new Database(liveDbPath);
  const importedDb = new Database(importedDbPath, { readonly: true });

  liveDb.pragma('journal_mode = WAL');

  const importedSessions = importedDb.prepare('SELECT * FROM sessions').all();
  const insertSession = liveDb.prepare(`INSERT OR IGNORE INTO sessions VALUES (${placeholders})`);

  const merge = liveDb.transaction(() => {
    let added = 0, skipped = 0;
    for (const session of importedSessions) {
      const result = insertSession.run(...Object.values(session));
      result.changes > 0 ? added++ : skipped++;
    }
    return { added, skipped };
  });

  const result = merge();
  rebuildProjectStats(liveDb);
  importedDb.close();
  liveDb.close();
  return result;
}
```

---

## Data Flow

### Ingest Flow (Background, Every 2 Minutes)

```
[node-cron fires every 2 min]
    ↓
runDeltaIngest()
    ↓
1. fs.readdirSync(projectsDir) — list all project directories
2. For each project: fs.readdirSync(projectPath) — list JSONL files
3. fs.statSync(filePath).mtimeMs — get current mtime
4. DB query: SELECT mtime_ms FROM ingested_files WHERE file_path = ?
5. If mtime unchanged → skip (no parse)
6. If new or mtime changed → parseSessionFile() from reader.ts (full JSONL parse)
7. upsertSession(db, session) — INSERT OR REPLACE into sessions table
8. UPDATE ingested_files SET mtime_ms = current, ingested_at = now
9. After all files: rebuildProjectStats(db) — recompute projects table aggregates
```

### Historical Query Flow (After v1.1)

```
[User navigates to /sessions]
    ↓
useSessionsHook() → GET /api/sessions?limit=50
    ↓
Route handler → getSessions() from db-reader.ts
    ↓
db.prepare('SELECT * FROM sessions ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(50, 0)
    ↓
Map DB rows → SessionInfo[] (deserialize JSON columns: models_json, tools_used_json, etc.)
    ↓
NextResponse.json(sessions) → SWR cache update → React re-render
```

### Active Session Flow (Unchanged from v1.0)

```
[5s SWR interval]
    ↓
useActiveSessions() → GET /api/active-sessions
    ↓
getActiveSessions() in active-sessions.ts (JSONL tail-read — no DB involved)
    ↓
Returns ActiveSessionInfo[] directly from filesystem
```

### DB Export Flow

```
[User clicks "Export Database"]
    ↓
GET /api/export?format=db
    ↓
fs.copyFileSync(getDbPath(), tempFile)   -- safe copy while WAL mode allows concurrent reads
    ↓
Stream tempFile as application/octet-stream download
    ↓
Cleanup tempFile
```

### DB Import + Merge Flow

```
[User uploads second-machine .db file]
    ↓
POST /api/db-merge with multipart .db file
    ↓
Save uploaded file to temp path
    ↓
mergeDatabases(liveDbPath, uploadedPath)
    ↓
Returns { added, skipped } counts
    ↓
Client refreshes SWR caches
```

---

## Integration Points with Existing Code

### Boundaries: What Changes vs What Stays

| Existing Module | Change | Reason |
|-----------------|--------|--------|
| `reader.ts` | UNCHANGED — no modifications | Still used by `active-sessions.ts`; breaking it breaks real-time monitoring |
| `active-sessions.ts` | UNCHANGED | Active sessions bypass DB; JSONL tail-read is the correct strategy |
| `data-source.ts` | ADD `getDbPath()` function | Returns path to live DB or imported DB depending on current source toggle |
| `types.ts` | UNCHANGED | DB reader maps to same types; no new types needed for this milestone |
| `hooks.ts` | UNCHANGED | SWR hooks call same API URLs; API routes return same shapes |
| `/api/stats/route.ts` | Change import source | `reader.ts` → `db-reader.ts` |
| `/api/projects/route.ts` | Change import source | `reader.ts` → `db-reader.ts` |
| `/api/sessions/route.ts` | Change import source | `reader.ts` → `db-reader.ts` |
| `/api/sessions/[id]/route.ts` | Change import source | `reader.ts` → `db-reader.ts`; JSONL fallback for session messages (no DB for full conversation) |
| `/api/export/route.ts` | Add .db export path | Keep ZIP export working; add DB file download |
| `/api/import/route.ts` | Accept .db file | Route to merge flow instead of ZIP extract |

### Integration: data-source.ts Extension

`getDbPath()` must respect the existing live/imported toggle:

```typescript
// Addition to src/lib/claude-data/data-source.ts
export function getDbPath(): string {
  const source = getActiveDataSource();
  if (source === 'imported') {
    return path.join(getImportDir(), 'claud-ometer.db');
  }
  return path.join(process.cwd(), '.dashboard-data', 'claud-ometer.db');
}
```

The live DB lives in `.dashboard-data/` alongside the existing imported data flag file. This directory is already in use by `data-source.ts` for the ZIP import feature. No new directory conventions needed.

### Integration: Session Detail — Hybrid Approach

`/api/sessions/[id]` needs full conversation messages (`SessionDetail.messages`). These are not stored in SQLite (scope exclusion). The hybrid approach:

1. Get `SessionInfo` aggregates from DB (`db-reader.ts`)
2. Get `messages` by reading the JSONL file directly (`reader.ts` parse path)
3. Combine into `SessionDetail`

This is the one route that intentionally stays hybrid. It's low-traffic (only loads when user opens a session detail page) so the JSONL read cost is acceptable.

```typescript
// Conceptual in /api/sessions/[id]/route.ts
const sessionInfo = await getSessionFromDb(sessionId);  // db-reader.ts
const messages = await getSessionMessages(sessionId);   // reader.ts JSONL parse
return NextResponse.json({ ...sessionInfo, messages });
```

---

## Scaling Considerations

This is a local-first app — one user, one machine. Scaling concerns are about historical data volume, not concurrent users.

| Data Volume | Architecture Adjustments |
|-------------|--------------------------|
| 1-100 sessions | Current JSONL approach is fine; SQLite is strictly a latency improvement |
| 100-1,000 sessions | SQLite queries become meaningfully faster than full JSONL scan; first ingest takes seconds |
| 1,000-10,000 sessions | First ingest takes minutes (run once on migration); subsequent delta ingests are fast; add index on `sessions.timestamp` and `sessions.project_id` |
| 10,000+ sessions | Add index on `sessions.estimated_cost` for costs page; consider pagination in DB queries (already in the API via limit/offset) |

### Indexes to Add

```sql
CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_sessions_timestamp ON sessions(timestamp);
```

These two indexes cover all current query patterns: list by project, list chronologically, filter recent sessions for stats.

### First Bottleneck

Initial full ingest of a large existing history. Mitigate by running it as a background job that reports progress via `/api/ingest` status endpoint. The UI can show "Syncing history..." during first startup.

---

## Anti-Patterns

### Anti-Pattern 1: Replacing reader.ts

**What people do:** Delete or refactor `reader.ts` when adding SQLite, since it "does the same thing now."

**Why it's wrong:** `active-sessions.ts` imports five functions from `reader.ts` (`getProjectsDir`, `extractCwdFromSession`, `projectIdToName`, `projectIdToFullPath`, and `forEachJsonlLine` implicitly). The active session feature must continue reading live JSONL files — the DB is 2 minutes stale by design. Breaking `reader.ts` breaks real-time monitoring.

**Do this instead:** Leave `reader.ts` entirely alone. Create `db-reader.ts` as an additive parallel implementation. API routes switch their import source.

### Anti-Pattern 2: Opening a New DB Connection per Request

**What people do:** `new Database(dbPath)` inside the API route handler function.

**Why it's wrong:** In Next.js dev mode with hot reload, each module re-evaluation creates a new connection. better-sqlite3 uses the OS file lock — multiple connections to the same file in the same process can cause "database is locked" errors, especially when the background ingest is writing concurrently.

**Do this instead:** The `getDb()` singleton via `globalThis` (Pattern 1 above). One connection, WAL mode, shared across all routes.

### Anti-Pattern 3: Blocking the Request Thread with Ingest

**What people do:** Run `runDeltaIngest()` inside an API route handler to ensure fresh data before returning.

**Why it's wrong:** Delta ingest can take seconds for large history collections. Blocking the HTTP handler delays the response and makes the UI feel slow. It also runs synchronously in the same event loop thread as the response.

**Do this instead:** The background cron handles ingest. The `/api/ingest` route is for manual triggers only, and should respond immediately with `{ status: 'triggered' }` then run the ingest asynchronously (fire-and-forget with error logging).

### Anti-Pattern 4: Storing Full JSONL Content in SQLite

**What people do:** Store the raw JSON of each JSONL line in a `messages` table to enable full-text search and replay from DB.

**Why it's wrong:** Doubles storage (JSONL files already exist). Makes the DB file potentially gigabytes in size. Full-text search on message content is a separate feature concern. Session messages for the detail view load fine from direct JSONL parse (one file, on demand).

**Do this instead:** Store only aggregated session stats in the DB. Keep JSONL files as the source of truth for message content. The hybrid approach in the session detail route is the right boundary.

### Anti-Pattern 5: Replacing the ZIP Export with DB-Only Export

**What people do:** Remove the existing ZIP export now that a .db file export exists.

**Why it's wrong:** The ZIP export includes the raw JSONL files, which are the canonical source. The DB file is a derived cache. If someone imports a .db file on another machine that has no JSONL files, active sessions will always show empty (no JSONL to tail-read) and session detail will have no messages. Keep both export formats.

**Do this instead:** Add .db export as a new option on the `/data` page. Document that .db files are for analytics only; ZIP files are for full portability.

---

## Build Order (Dependency Chain)

The strict dependency order for this milestone:

1. **`db.ts` + `schema.ts`** — All other new modules depend on the DB connection and schema.

2. **`data-source.ts` extension** — Add `getDbPath()`. Required by `db.ts` to know where to open the file.

3. **`ingest.ts`** — Depends on `db.ts`, `schema.ts`, and `reader.ts` (reuses `parseSessionFile`). Can be built and tested without touching any API routes.

4. **`db-reader.ts`** — Depends on `db.ts` and existing types. Implement `getSessions()`, `getProjects()`, `getDashboardStats()` as SQL equivalents of their `reader.ts` counterparts. Test by comparing output against JSONL baseline.

5. **API route migrations** — Swap import sources in stats, projects, sessions routes. Zero logic changes. Run side-by-side comparison tests before removing JSONL fallback.

6. **`/api/ingest/route.ts`** — New route for status and manual trigger. Simple wrapper around `ingest.ts`.

7. **`db-merge.ts` + `/api/db-merge/route.ts`** — Depends on schema only (no reader.ts). Independently testable.

8. **Export/import modifications** — `/api/export` and `/api/import` changes. Last because they touch existing working functionality — safest to do after DB is proven stable.

9. **Activity chart on project detail page** — New UI component. Depends on data being in DB (queries daily activity grouped by project_id). No dependencies on any of the other new components.

---

## Sources

- Direct codebase analysis: `src/lib/claude-data/reader.ts`, `active-sessions.ts`, `data-source.ts`, `types.ts`
- Direct codebase analysis: All API routes in `src/app/api/`
- [better-sqlite3 npm package](https://www.npmjs.com/package/better-sqlite3) — synchronous SQLite API for Node.js
- [Next.js GitHub discussion: DB connection singleton pattern](https://github.com/vercel/next.js/discussions/16271)
- [better-sqlite3 GitHub: database is locked in Next.js](https://github.com/WiseLibs/better-sqlite3/issues/1155)
- [Next.js cron jobs (serverful approach)](https://yagyaraj234.medium.com/running-cron-jobs-in-nextjs-guide-for-serverful-and-stateless-server-542dd0db0c4c)
- [node-cron scheduled tasks](https://betterstack.com/community/guides/scaling-nodejs/node-cron-scheduled-tasks/)

---
*Architecture research for: Claud-ometer v1.1 — SQLite persistence, background ingest, DB merge*
*Researched: 2026-03-19*
