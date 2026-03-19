# Phase 5: SQLite Foundation - Research

**Researched:** 2026-03-19
**Domain:** better-sqlite3 / Next.js native module integration / SQLite schema design
**Confidence:** HIGH

## Summary

Phase 5 establishes a SQLite persistence layer in an existing Next.js 16 App Router project running on WSL2. The core challenge is ensuring the database file lives on Linux ext4 (not NTFS) to avoid WAL mode locking failures, and that the singleton connection survives hot-reloads without producing "database is locked" errors.

All major architectural decisions are locked: `better-sqlite3` (synchronous API, no ORM), `globalThis.__claudeometerDb` singleton, `~/.claude/claud-ometer.db` path, WAL mode, five-table schema with JSON text columns for complex fields. Phase 5 adds only `src/lib/db.ts` and updates `next.config.ts` and `package.json`. No existing files are modified.

`better-sqlite3` is on Next.js's automatic `serverExternalPackages` opt-out list (confirmed in Next.js 16.2.0 docs), meaning `next.config.ts` does NOT need a manual `serverExternalPackages` entry — the bundler skips it automatically. This simplifies the build config change.

**Primary recommendation:** Use `better-sqlite3` v12.8.0 with the `globalThis` singleton pattern, WAL + PRAGMA setup on first connection open, `CREATE TABLE IF NOT EXISTS` for schema, and `os.homedir()` to derive the DB path. The `instrumentation.ts` hook is not needed for Phase 5 — lazy init on first `getDb()` call is sufficient.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use `better-sqlite3` directly — no ORM (not Drizzle, not Prisma)
- Synchronous API, already on Next.js `serverExternalPackages` allowlist
- DB-02 requirement in REQUIREMENTS.md must be updated to match (remove Drizzle reference)
- Reuse existing TypeScript types from `types.ts` (SessionInfo, ProjectInfo, etc.) — cast query results to these interfaces
- Thin wrapper in `src/lib/db.ts` with typed helper functions (getDb, ensureSchema, etc.)
- 5 tables: `sessions`, `projects`, `daily_activity`, `model_usage`, `ingested_files`
- `sessions` table: use session UUID (SessionInfo.id) as TEXT PRIMARY KEY — natural dedup key for Phase 8 merge
- `daily_activity` table: include `project_id` column — required by Phase 8 per-project activity chart. Rows are per-project-per-day.
- Complex fields (toolsUsed, models, compaction) stored as JSON text columns — use JSON.parse() on read
- `model_usage` table: one row per model globally (matches DashboardStats.modelUsage shape)
- `ingested_files` table: tracks mtime + file size for delta sync in Phase 6
- Lazy init on first query via `getDb()` function — creates connection on first call, caches in `globalThis.__claudeometerDb`
- No `instrumentation.ts` needed for Phase 5 — Phase 6 adds scheduler there later
- Schema creation via `CREATE TABLE IF NOT EXISTS` statements — no migration system
- DB file path: `~/.claude/claud-ometer.db` (Linux ext4, not NTFS via WSL)
- WAL mode enabled on connection open: `PRAGMA journal_mode=WAL`
- Phase 5 DB module ignores the data-source toggle entirely — no awareness of live vs imported mode

### Claude's Discretion
- Exact column types and indexes (researcher/planner can optimize)
- Error handling approach for DB connection failures
- Whether to add PRAGMA statements beyond WAL (e.g., foreign_keys, busy_timeout)
- Internal structure of db.ts (single file vs helper functions)

### Deferred Ideas (OUT OF SCOPE)
- ZIP import → SQLite ingest option — When importing a ZIP with JSONL files, offer to also ingest them into the SQLite database. Belongs in Phase 8 (Portability).
- Per-model-per-day granularity — model_usage could be per-day for richer cost trend analytics. Could be added later (v2 ANAL-01/ANAL-02 requirements).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DB-01 | System stores session data in a local SQLite database with WAL mode enabled | WAL enabled via `db.pragma('journal_mode = WAL')` on connection open; persistent once set on db file |
| DB-02 | System uses better-sqlite3 for direct SQLite access with TypeScript types from types.ts | better-sqlite3 v12.8.0 + @types/better-sqlite3 v7.6.13; cast row results to existing SessionInfo/ProjectInfo interfaces |
| DB-03 | Database schema auto-applies on first startup via instrumentation.ts (zero manual setup) | Decided: lazy `getDb()` call (not instrumentation.ts) runs `CREATE TABLE IF NOT EXISTS` on first connection; zero manual setup satisfied |
| DB-04 | Database connection uses globalThis singleton pattern to prevent hot-reload duplication | `globalThis.__claudeometerDb` pattern confirmed by Next.js community and official patterns; guards against module re-evaluation on hot-reload |
| DB-05 | Database file lives on Linux ext4 filesystem (not NTFS via WSL) to avoid locking issues | `os.homedir()` in WSL2 resolves to Linux ext4 `/home/<user>` or `~/.claude` on Linux fs; confirmed WAL locking fails on NTFS/WSL2 cross-boundary |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Synchronous SQLite for Node.js | Fastest, simplest, synchronous API matches Next.js API routes; pre-listed in Next.js serverExternalPackages auto-opt-out |
| @types/better-sqlite3 | 7.6.13 | TypeScript types for better-sqlite3 | Official type definitions; devDependency only |

**Version verified:** `npm view better-sqlite3 version` → `12.8.0` (published 2026-03-14). `npm view @types/better-sqlite3 version` → `7.6.13`.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `os` module | built-in | `os.homedir()` for resolving `~` | Derive DB path to Linux home directory |
| Node.js `path` module | built-in | `path.join()` for DB file path | Already used in data-source.ts |
| Node.js `fs` module | built-in | `fs.mkdirSync` to ensure parent dir exists | If `~/.claude/` doesn't exist |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | Drizzle + better-sqlite3 | ORM adds migration complexity, typed query builder; unnecessary for Phase 5 foundation |
| better-sqlite3 | libsql | Turso cloud integration; defeats local-first constraint |
| globalThis singleton | Module-level `let db` variable | Module re-evaluated on hot-reload in dev; globalThis persists across reloads |

**Installation:**
```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

---

## Architecture Patterns

### Recommended Project Structure

Phase 5 adds one new file and modifies two existing files:

```
src/
└── lib/
    └── db.ts                    # NEW — DB singleton, schema creation, getDb() export

next.config.ts                   # MODIFY — confirm serverExternalPackages not needed (auto-listed)
package.json                     # MODIFY — add better-sqlite3 + @types/better-sqlite3
```

No new directories. No changes to `src/lib/claude-data/` (reader.ts, types.ts, data-source.ts must NOT be modified).

### Pattern 1: globalThis Singleton with Lazy Init

**What:** Store the `Database` instance on `globalThis` under a typed key. Check for existence before creating. This prevents multiple connections being opened during Next.js dev-mode hot-reloads when module code re-executes.

**When to use:** Always — this is the only safe pattern for native-module DB connections in Next.js dev mode.

```typescript
// Source: Next.js community pattern + better-sqlite3 docs
// src/lib/db.ts
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

// Typed global to prevent TypeScript "implicit any" error
declare global {
  // eslint-disable-next-line no-var
  var __claudeometerDb: Database.Database | undefined;
}

const DB_PATH = path.join(os.homedir(), '.claude', 'claud-ometer.db');

export function getDb(): Database.Database {
  if (!globalThis.__claudeometerDb) {
    globalThis.__claudeometerDb = openDatabase();
  }
  return globalThis.__claudeometerDb;
}

function openDatabase(): Database.Database {
  const db = new Database(DB_PATH);
  applyPragmas(db);
  ensureSchema(db);
  return db;
}
```

**Why `declare global` with `var`:** TypeScript requires `var` (not `let`/`const`) for augmenting the global type. The ESLint rule `no-var` should be suppressed for this declaration only.

### Pattern 2: PRAGMA Setup on Connection Open

**What:** Run performance/safety PRAGMAs immediately after opening the connection. WAL mode is persistent once set on the db file, but all other PRAGMAs reset per connection and must be re-applied.

**When to use:** In `openDatabase()`, before any queries.

```typescript
// Source: SQLite official docs + highperformancesqlite.com recommendations
function applyPragmas(db: Database.Database): void {
  // WAL mode: persistent, enables concurrent readers + 1 writer
  db.pragma('journal_mode = WAL');
  // Reduce sync calls; safe with WAL mode (no durability loss for local analytics)
  db.pragma('synchronous = NORMAL');
  // Wait up to 5s when DB is locked (hot-reload race condition safety net)
  db.pragma('busy_timeout = 5000');
  // Enforce FK constraints (not default in SQLite)
  db.pragma('foreign_keys = ON');
  // 64MB page cache (reduces disk I/O for repeated queries)
  db.pragma('cache_size = -65536');
  // Memory temp tables (faster GROUP BY / ORDER BY)
  db.pragma('temp_store = MEMORY');
}
```

**WAL persistence note:** `journal_mode = WAL` only needs to be set once in the lifetime of the db file, but calling it on every connection open is safe and idempotent — SQLite returns `wal` when already in WAL mode.

### Pattern 3: Schema Creation with CREATE TABLE IF NOT EXISTS

**What:** Run all DDL in a single `db.exec()` call wrapped in a transaction. `IF NOT EXISTS` makes it safe to call on every startup.

**When to use:** In `openDatabase()`, after PRAGMAs.

```typescript
// Source: SQLite docs + better-sqlite3 API (db.exec for DDL)
function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                     TEXT PRIMARY KEY,
      project_id             TEXT NOT NULL,
      project_name           TEXT NOT NULL,
      timestamp              TEXT NOT NULL,
      duration               INTEGER NOT NULL DEFAULT 0,
      active_time            INTEGER NOT NULL DEFAULT 0,
      message_count          INTEGER NOT NULL DEFAULT 0,
      user_message_count     INTEGER NOT NULL DEFAULT 0,
      assistant_message_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count        INTEGER NOT NULL DEFAULT 0,
      total_input_tokens     INTEGER NOT NULL DEFAULT 0,
      total_output_tokens    INTEGER NOT NULL DEFAULT 0,
      total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      total_cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost         REAL NOT NULL DEFAULT 0,
      model                  TEXT NOT NULL DEFAULT '',
      models                 TEXT NOT NULL DEFAULT '[]',
      git_branch             TEXT NOT NULL DEFAULT '',
      cwd                    TEXT NOT NULL DEFAULT '',
      version                TEXT NOT NULL DEFAULT '',
      tools_used             TEXT NOT NULL DEFAULT '{}',
      compaction             TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      path           TEXT NOT NULL,
      session_count  INTEGER NOT NULL DEFAULT 0,
      total_messages INTEGER NOT NULL DEFAULT 0,
      total_tokens   INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      last_active    TEXT NOT NULL DEFAULT '',
      models         TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS daily_activity (
      date          TEXT NOT NULL,
      project_id    TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      session_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, project_id)
    );

    CREATE TABLE IF NOT EXISTS model_usage (
      model                       TEXT PRIMARY KEY,
      input_tokens                INTEGER NOT NULL DEFAULT 0,
      output_tokens               INTEGER NOT NULL DEFAULT 0,
      cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
      cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd                    REAL NOT NULL DEFAULT 0,
      context_window              INTEGER NOT NULL DEFAULT 0,
      max_output_tokens           INTEGER NOT NULL DEFAULT 0,
      web_search_requests         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ingested_files (
      file_path  TEXT PRIMARY KEY,
      mtime      INTEGER NOT NULL,
      file_size  INTEGER NOT NULL,
      ingested_at TEXT NOT NULL
    );
  `);
}
```

**Schema design notes (Claude's Discretion research):**

- `sessions.models` and `sessions.tools_used` and `sessions.compaction` are JSON text — matches the locked decision. Parse with `JSON.parse()` when reading.
- `daily_activity` composite PK on `(date, project_id)` is the correct enforcement of the "one row per project per day" rule.
- `model_usage` has one row per model name (globally) — matches `DashboardStats.modelUsage` shape (Record<string, ModelUsage>).
- `ingested_files.mtime` stored as INTEGER (Unix timestamp ms) — enables numeric comparison for Phase 6 delta check.

**Recommended indexes (Claude's Discretion):**

```typescript
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_timestamp   ON sessions(timestamp);
  CREATE INDEX IF NOT EXISTS idx_daily_activity_date  ON daily_activity(date);
`);
```

These support Phase 7's most common queries: sessions by project, sessions by date range, activity chart data.

### Pattern 4: Row Casting to TypeScript Types

**What:** Cast `db.prepare(...).all()` results to existing interfaces. better-sqlite3 returns plain objects; no runtime transformation beyond JSON.parse for JSON columns.

```typescript
// Source: better-sqlite3 API docs
import type { SessionInfo } from '@/lib/claude-data/types';

export function getSessionById(id: string): SessionInfo | null {
  const row = getDb()
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    ...(row as SessionInfo),
    models: JSON.parse(row.models as string) as string[],
    toolsUsed: JSON.parse(row.tools_used as string) as Record<string, number>,
    compaction: JSON.parse(row.compaction as string),
  };
}
```

### Pattern 5: DB Path Resolution

**What:** Derive the DB path from `os.homedir()`. In WSL2, `os.homedir()` returns the Linux home (`/home/<user>`), so `~/.claude/claud-ometer.db` resolves to Linux ext4 — not NTFS.

```typescript
// Confirmed: in WSL2 Node.js process, os.homedir() returns Linux path /home/<user>
// NOT the Windows path /mnt/c/Users/<user>
const DB_PATH = path.join(os.homedir(), '.claude', 'claud-ometer.db');
```

**DB-05 verification:** The `getLiveClaudeDir()` function in `data-source.ts` already uses `os.homedir()` for the same reason — this is an established project pattern.

### Anti-Patterns to Avoid

- **Module-level `let db: Database.Database`:** Module re-evaluates on hot-reload, creating a new connection that races the old one. Use `globalThis.__claudeometerDb` instead.
- **Storing DB on NTFS (`/mnt/c/...`):** WAL mode locking fails on NTFS via WSL2. Never pass a `/mnt/c/` path to the Database constructor.
- **Calling `db.close()` in API routes:** better-sqlite3 connections are long-lived. Closing per-request destroys the singleton.
- **Running DDL in API routes:** Call `ensureSchema()` once in `openDatabase()`, not on each request.
- **Not guarding JSON columns on read:** `JSON.parse(null)` throws. Always default: `JSON.parse(row.models as string || '[]')`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native SQLite access | Custom C++ binding or `sqlite3` npm package | `better-sqlite3` | Synchronous API, pre-listed in Next.js, 3x faster than `sqlite3` async |
| Connection pooling | Multiple `Database()` instances | `globalThis` singleton | SQLite is single-writer; one connection is correct architecture |
| Schema migrations | Custom migration runner with version table | `CREATE TABLE IF NOT EXISTS` (Phase 5) + future `ALTER TABLE` guarded by version check | Migrations are Phase 5+ scope; IF NOT EXISTS handles safe reruns |
| Row-to-type mapping | Custom mapper classes | Direct cast + JSON.parse for JSON columns | TypeScript interfaces already exist in types.ts; no mapper needed |

**Key insight:** SQLite's synchronous, single-connection model means the complexity normally handled by connection pools and ORMs simply doesn't exist here. The "thin wrapper" approach in `db.ts` is the correct level of abstraction.

---

## Common Pitfalls

### Pitfall 1: "Database is locked" on Hot Reload

**What goes wrong:** Dev server reloads a module that creates a new `Database()` instance while the previous one's WAL is still active.

**Why it happens:** Next.js Fast Refresh re-evaluates module-level code on every save. Without `globalThis`, each re-evaluation opens a new connection.

**How to avoid:** Always check `globalThis.__claudeometerDb` before constructing. Set `busy_timeout = 5000` as a fallback safety net for the race window.

**Warning signs:** `SqliteError: database is locked` in Next.js dev server terminal on file save.

### Pitfall 2: DB File on NTFS via WSL2

**What goes wrong:** `SQLITE_IOERR_LOCK` or WAL file creation failures when DB path resolves to `/mnt/c/...`.

**Why it happens:** NTFS file locking semantics differ from POSIX. SQLite WAL mode requires POSIX-compliant file locking to coordinate the -wal and -shm companion files.

**How to avoid:** Confirm `DB_PATH` starts with `/home/` or equivalent Linux path, never `/mnt/`. Use `os.homedir()` — confirmed to return Linux path in WSL2 Node.js context (same pattern as existing `getLiveClaudeDir()`).

**Warning signs:** DB file created at `/mnt/c/Users/<user>/.claude/claud-ometer.db` instead of `/home/<user>/.claude/claud-ometer.db`.

### Pitfall 3: `next build` Fails for Native Module

**What goes wrong:** Webpack/Turbopack tries to bundle `better_sqlite3.node` (compiled C++ binary) and fails.

**Why it happens:** Native `.node` addons cannot be bundled — they must be loaded by Node.js require() at runtime.

**How to avoid:** `better-sqlite3` is already on Next.js's automatic opt-out list (`serverExternalPackages`) as of Next.js 15. No manual config change needed in `next.config.ts`. However, explicitly adding it does no harm if extra certainty is needed.

**Warning signs:** `Module not found: Can't resolve 'better_sqlite3.node'` in `npm run build` output.

### Pitfall 4: WAL Companion Files Confusing Dev

**What goes wrong:** Developer sees `claud-ometer.db-wal` and `claud-ometer.db-shm` files and thinks the DB is corrupt or considers deleting them.

**Why it happens:** WAL mode creates these as normal operation. They persist while any connection is open and are deleted on clean close.

**How to avoid:** Document this in a comment in `db.ts`. The `-wal` file appearing is specifically listed as DB-01 success criteria.

**Warning signs:** None — this is expected behavior. Only a concern if the `.db` file is separated from its `-wal` file (would cause data loss).

### Pitfall 5: TypeScript Global Augmentation Error

**What goes wrong:** TypeScript error: "Property '__claudeometerDb' does not exist on type 'typeof globalThis'".

**Why it happens:** TypeScript's strict checking of `globalThis` requires explicit type augmentation.

**How to avoid:** Use `declare global { var __claudeometerDb: Database.Database | undefined; }` in `db.ts`. The `var` keyword is required (not `let`/`const`) for global augmentation. Suppress the `no-var` ESLint rule on that line only.

**Warning signs:** TypeScript compile error on `globalThis.__claudeometerDb`.

### Pitfall 6: `@types/better-sqlite3` Version Mismatch

**What goes wrong:** Type errors because `@types/better-sqlite3` types don't match the installed `better-sqlite3` version.

**Why it happens:** Major API changes between versions.

**How to avoid:** Install `@types/better-sqlite3@^7.6.13` alongside `better-sqlite3@^12.8.0`. These are compatible.

---

## Code Examples

### Complete db.ts Template

```typescript
// Source: better-sqlite3 API docs + Next.js globalThis singleton pattern
// src/lib/db.ts
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

declare global {
  // eslint-disable-next-line no-var
  var __claudeometerDb: Database.Database | undefined;
}

const DB_PATH = path.join(os.homedir(), '.claude', 'claud-ometer.db');

export function getDb(): Database.Database {
  if (!globalThis.__claudeometerDb) {
    globalThis.__claudeometerDb = openDatabase();
  }
  return globalThis.__claudeometerDb;
}

function openDatabase(): Database.Database {
  const db = new Database(DB_PATH);
  applyPragmas(db);
  ensureSchema(db);
  return db;
}

function applyPragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -65536');
  db.pragma('temp_store = MEMORY');
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions ( ... );
    CREATE TABLE IF NOT EXISTS projects ( ... );
    CREATE TABLE IF NOT EXISTS daily_activity ( ... );
    CREATE TABLE IF NOT EXISTS model_usage ( ... );
    CREATE TABLE IF NOT EXISTS ingested_files ( ... );
    CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_timestamp   ON sessions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_daily_activity_date  ON daily_activity(date);
  `);
}
```

### Verifying WAL Mode is Active

```typescript
// Source: better-sqlite3 .pragma() API
const mode = db.pragma('journal_mode', { simple: true });
// Returns 'wal' if WAL mode is active
console.assert(mode === 'wal', 'WAL mode not active');
```

### Verifying DB File is on Linux ext4

```typescript
// Source: Node.js os module
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.claude', 'claud-ometer.db');
// In WSL2: /home/<user>/.claude/claud-ometer.db  ← correct (Linux ext4)
// NOT:    /mnt/c/Users/<user>/.claude/claud-ometer.db  ← wrong (NTFS)
console.assert(!dbPath.startsWith('/mnt/'), 'DB path is on NTFS — WAL will fail');
```

### next.config.ts — No Change Required

```typescript
// better-sqlite3 is on Next.js's automatic serverExternalPackages opt-out list.
// Confirmed in Next.js 16 docs: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
// No manual entry needed. Current next.config.ts requires no change for this phase.
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `serverComponentsExternalPackages` in next.config | `serverExternalPackages` (stable) | Next.js v15.0.0 | Rename only; same behavior. `better-sqlite3` auto-listed since v14+ |
| Manual `serverExternalPackages: ['better-sqlite3']` | Auto-listed — no config needed | Next.js ~v14 | Removes the config step entirely |
| `sqlite3` async package | `better-sqlite3` synchronous | Ecosystem shift ~2021 | Synchronous fits Next.js API route pattern; no callback/Promise overhead |
| instrumentation.ts for DB init | Lazy `getDb()` via globalThis | Architecture decision 2026-03 | Simpler; instrumentation.ts needed in Phase 6 for scheduler, not Phase 5 |

**Deprecated/outdated:**
- `serverComponentsExternalPackages` config key: renamed to `serverExternalPackages` in Next.js 15; old name may still work but is deprecated
- `sqlite3` npm package: async API creates unnecessary complexity in synchronous API route context

---

## Open Questions

1. **Does `next.config.ts` need any change at all for Phase 5?**
   - What we know: `better-sqlite3` is on Next.js's automatic opt-out list (confirmed in official docs for Next.js 16.2.0)
   - What's unclear: Whether the auto-listing applies to Turbopack (dev) vs Webpack (production build) equally
   - Recommendation: Add explicit `serverExternalPackages: ['better-sqlite3']` as belt-and-suspenders; if build fails without it, the answer is clear

2. **DB-03 requirement says "via instrumentation.ts" but CONTEXT.md says lazy getDb() instead**
   - What we know: CONTEXT.md locked decision overrides the requirement text; DB-02 note says REQUIREMENTS.md needs updating
   - What's unclear: Whether the REQUIREMENTS.md text update is part of Phase 5 scope or handled separately
   - Recommendation: Planner should include a task to update DB-03 requirement text to match the lazy-init decision; it is a documentation fix, not a behavior change

3. **`~/.claude/` directory existence**
   - What we know: The directory exists if Claude Code is installed; `getLiveClaudeDir()` already points there
   - What's unclear: Whether the app should `fs.mkdirSync` the directory if it doesn't exist (edge case: fresh machine with app installed before Claude Code)
   - Recommendation: Add `fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })` before opening the Database; harmless no-op if it exists

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30 + ts-jest 29.4.6 |
| Config file | `jest.config.js` (root) |
| Quick run command | `npm test -- --testPathPattern="db" --no-coverage` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | WAL mode active after connection open | unit | `npm test -- --testPathPattern="db" -t "WAL mode"` | ❌ Wave 0 |
| DB-02 | better-sqlite3 connected, types assignable | unit | `npm test -- --testPathPattern="db" -t "getDb"` | ❌ Wave 0 |
| DB-03 | All 5 tables exist after first getDb() call | unit | `npm test -- --testPathPattern="db" -t "schema"` | ❌ Wave 0 |
| DB-04 | Multiple getDb() calls return same instance | unit | `npm test -- --testPathPattern="db" -t "singleton"` | ❌ Wave 0 |
| DB-05 | DB_PATH does not start with /mnt/ | unit | `npm test -- --testPathPattern="db" -t "DB_PATH"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern="db" --no-coverage`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/lib/db.test.ts` — covers DB-01 through DB-05
- [ ] Test must use a temp DB path (not `~/.claude/`) to avoid polluting dev data

**Note on test isolation:** The `getDb()` function uses `globalThis.__claudeometerDb`. Tests must reset `globalThis.__claudeometerDb = undefined` in `beforeEach` and use a temp file path (e.g., `os.tmpdir() + '/test-claud-ometer.db'`) via environment variable or dependency injection. Consider exporting a `createDb(path: string)` helper for testability.

---

## Sources

### Primary (HIGH confidence)

- Next.js official docs (16.2.0, fetched 2026-03-19) — serverExternalPackages auto-list confirms better-sqlite3 is pre-listed
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
- Next.js instrumentation guide (fetched 2026-03-19) — confirms `register()` called once per server instance; `NEXT_RUNTIME` guard pattern
  - https://nextjs.org/docs/app/guides/instrumentation
- better-sqlite3 API reference (GitHub, fetched 2026-03-19) — Database constructor, pragma(), exec(), prepare()/run()/all()/get()
  - https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- SQLite WAL documentation (official, fetched 2026-03-19) — WAL persistence behavior, companion files lifecycle
  - https://sqlite.org/wal.html
- npm registry (verified 2026-03-19) — better-sqlite3@12.8.0 (published 2026-03-14), @types/better-sqlite3@7.6.13

### Secondary (MEDIUM confidence)

- SQLite recommended pragmas — highperformancesqlite.com/articles/sqlite-recommended-pragmas — synchronous=NORMAL + WAL + cache_size + temp_store combination
- WSL SQLite locking issue — github.com/microsoft/WSL/issues/2395 — confirms SQLite write locks not respected on NTFS in WSL
- better-sqlite3 + Next.js hot-reload — github.com/WiseLibs/better-sqlite3/issues/1155 — confirms "database is locked" from multiple instances without singleton

### Tertiary (LOW confidence)

- None — all critical claims verified against primary sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — better-sqlite3 v12.8.0 verified via npm registry; @types version confirmed
- Architecture: HIGH — globalThis pattern confirmed against official Next.js issue discussions; WAL behavior confirmed from sqlite.org official docs; serverExternalPackages auto-listing confirmed from Next.js 16 official docs
- Pitfalls: HIGH — WSL/NTFS locking confirmed via GitHub issue; hot-reload issue confirmed via Next.js and better-sqlite3 issue trackers; TypeScript global augmentation is well-documented pattern

**Research date:** 2026-03-19
**Valid until:** 2026-06-19 (stable ecosystem — Next.js major version would invalidate serverExternalPackages finding)
