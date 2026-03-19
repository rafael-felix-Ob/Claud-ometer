# Pitfalls Research

**Domain:** SQLite persistence + background JSONL ingest + cross-machine DB merge on Next.js App Router (WSL2)
**Researched:** 2026-03-19
**Confidence:** HIGH (verified with official docs, GitHub issues, and community reports)

---

## Critical Pitfalls

### Pitfall 1: better-sqlite3 Native Module Bundled by Webpack/Turbopack

**What goes wrong:**
Next.js tries to bundle `better-sqlite3` as part of server-side code. Because it is a native Node.js addon (`.node` binary), it cannot be bundled — the build fails with errors like `Module not found: Can't resolve 'better-sqlite3'` or crashes at runtime with `Cannot find module`.

**Why it happens:**
Next.js App Router bundles all server-side code by default, including API routes and Server Components. Native addons with `.node` binaries are not bundleable — they must be loaded from the filesystem at runtime by Node.js directly, not via webpack/Turbopack's module resolution.

**How to avoid:**
Add `better-sqlite3` to `serverExternalPackages` in `next.config.ts` to opt it out of bundling:

```ts
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
}
```

Note: Next.js 16.1 with Turbopack auto-resolves transitive `serverExternalPackages` dependencies, but `better-sqlite3` still requires the explicit entry for direct use. Verify the config is present before the first build attempt — not after the first failure.

**Warning signs:**
- Build error: `Module not found: Can't resolve 'better-sqlite3'`
- Runtime error: `Error: Cannot find module 'better-sqlite3'`
- Build succeeds but first API route call throws `Invalid ELF header` (binary loaded through wrong path)
- Turbopack dev build succeeds but `next build` production build fails (different bundlers)

**Phase to address:** Phase 1 (SQLite schema and persistence layer) — must be the very first thing verified before any schema or query code is written.

---

### Pitfall 2: Multiple SQLite Connections from Hot Reload Creating "Database is Locked" Errors

**What goes wrong:**
In `next dev`, every saved file triggers a module hot-reload that re-executes the module that opens the SQLite connection. Without a singleton guard, each hot-reload creates a new `Database` instance while the previous one is not closed. When the background ingest job is running (writing to the DB), a second connection attempt hits `SQLITE_BUSY: database is locked`.

**Why it happens:**
Next.js Fast Refresh re-executes module-level code on every file save. A naive `const db = new Database(DB_PATH)` at module scope creates a new connection on every reload. better-sqlite3 uses synchronous locking — only one writer at a time — so the ingest job's write lock blocks the new connection's attempt to open.

**How to avoid:**
Use the `globalThis` singleton pattern specifically for the database connection:

```ts
// lib/db/connection.ts
import Database from 'better-sqlite3';

const DB_PATH = path.join(os.homedir(), '.claude', 'claud-ometer.db');

declare global {
  var __db: Database.Database | undefined;
}

function getDb(): Database.Database {
  if (!global.__db || !global.__db.open) {
    global.__db = new Database(DB_PATH);
    global.__db.pragma('journal_mode = WAL');
    global.__db.pragma('busy_timeout = 5000');
  }
  return global.__db;
}

export { getDb };
```

The `global.__db` persists across hot-reloads in development. In production, each process gets one connection. The `busy_timeout` pragma is also critical (see Pitfall 4).

**Warning signs:**
- `SqliteError: database is locked` in dev server console on file save
- Errors appear specifically after editing any file that imports from `lib/db/`
- Error goes away after restarting the dev server (confirming it is a stale-connection issue, not a logic bug)
- CPU spikes: multiple connections all trying to acquire the same write lock

**Phase to address:** Phase 1 (SQLite persistence layer) — the singleton must be established in the connection module before any other DB code is written.

---

### Pitfall 3: SQLite Database File Stored on NTFS via WSL2 Causes WAL Mode Failures

**What goes wrong:**
If the `.db` file is stored on a Windows NTFS path (e.g., `/mnt/c/SourceControl/...`) accessed from WSL2, SQLite's WAL (Write-Ahead Logging) mode fails or behaves incorrectly. Specifically: WAL mode relies on POSIX advisory locks, which are not correctly implemented for NTFS volumes accessed via WSL2's Plan 9 filesystem bridge. The result is `SqliteError: disk I/O error` or `SQLITE_IOERR_LOCK` errors during concurrent reads/writes.

**Why it happens:**
WSL2 accesses Windows NTFS through a `9p` (Plan 9) filesystem protocol driver. This driver does not faithfully implement POSIX file locking semantics that SQLite's WAL mode requires. SQLite documentation explicitly states: "WAL mode does not work on a network filesystem." The WSL2 9p bridge is effectively a network filesystem for this purpose. Microsoft's own WSL GitHub tracker documents this as a known issue (issue #4689).

**How to avoid:**
Store the database file on the WSL2 Linux filesystem, NOT on an NTFS/Windows path:
- Use `~/.claude/claud-ometer.db` — this resolves to `/home/<user>/.claude/` which is on the Linux ext4 VHD, not NTFS.
- The existing `reader.ts` already reads `~/.claude/projects/` from the Linux filesystem. The DB file should live in the same location.
- Never construct the DB path from `process.cwd()` — in this project, cwd is `/mnt/c/SourceControl/...` (NTFS). Always use `path.join(os.homedir(), '.claude', 'claud-ometer.db')`.

**Warning signs:**
- `SQLITE_IOERR` or `disk I/O error` when enabling WAL mode via `PRAGMA journal_mode = WAL`
- WAL pragma "succeeds" (returns `wal`) but WAL-mode performance characteristics are absent
- Database works fine in `DELETE` journal mode but breaks as soon as WAL is enabled
- Database works when opened by a Windows process (DBeaver on Windows) but locks when opened from WSL simultaneously

**Phase to address:** Phase 1 (SQLite schema and persistence layer) — the DB path must be set correctly from the start. Changing the path later requires a migration.

---

### Pitfall 4: Background Ingest Runs Inside Next.js API Route — Dies on Every Request Timeout

**What goes wrong:**
The background JSONL ingest job is implemented as a `setInterval` inside an API route handler or triggered by a special `/api/ingest` endpoint. In a local Next.js process, `setInterval` inside an API route handler creates an interval that survives across requests but accumulates on every route invocation — each new request to `/api/ingest` adds another interval. After 10 requests, 10 parallel ingest jobs run simultaneously, all trying to write to the same SQLite DB, causing constant lock contention.

Alternatively, if implemented as a fire-and-forget in a route handler, the Node.js process may garbage-collect the job when the request completes.

**Why it happens:**
Next.js API routes are designed to be stateless request handlers. Node.js does not guarantee that work started inside a route handler persists beyond the response being sent. In practice, `setInterval` at module scope in a Next.js server process does persist, but it re-registers on every hot-reload (the hot-reload pitfall from Pitfall 2 applies here too).

**How to avoid:**
Use a module-level singleton for the ingest scheduler, registered once and guarded with the same `globalThis` pattern used for the DB connection:

```ts
// lib/ingest/scheduler.ts
declare global {
  var __ingestInterval: NodeJS.Timeout | undefined;
}

export function startIngestScheduler() {
  if (global.__ingestInterval) return; // already running
  global.__ingestInterval = setInterval(runIngest, 30_000); // 30s
}
```

Call `startIngestScheduler()` from a single initialization point — the DB connection module's `getDb()` factory is a natural place (it runs once on first DB access). Never call it from a request handler body that executes per-request.

**Warning signs:**
- Server logs show ingest running 5-10 times simultaneously (overlapping log lines)
- `SQLITE_BUSY` errors increase over uptime (more intervals = more contention)
- Ingest progress appears duplicated (same session inserted N times)
- Memory usage grows linearly with number of dev server reloads

**Phase to address:** Phase 2 (background ingest job) — the scheduler singleton must be established at the same time as the ingest function itself, not added later.

---

### Pitfall 5: JSONL-to-SQLite Migration Drops Existing Sessions Due to Wrong Dedup Key

**What goes wrong:**
The initial migration from JSONL-only to database-backed reads the session ID from the JSONL file. But the session ID in the JSONL filename (e.g., `abc123.jsonl`) may differ from the session ID embedded in the JSONL content's `sessionId` field. Using the wrong one as the dedup key causes:
- Duplicate sessions in the DB (same session inserted twice with different IDs)
- Sessions missing from the DB (ID mismatch means delta-sync thinks a session is new when it was already ingested)

**Why it happens:**
Claude Code JSONL filenames use the session UUID as the filename. The content also contains a `sessionId` field. These should be identical, but edge cases exist: session files that were renamed, imported/exported, or created by different Claude Code versions may have discrepancies. Using the filename as the canonical ID (since that's what `reader.ts` currently uses) is the safest choice because all existing code already resolves sessions by filename.

**How to avoid:**
Use the JSONL filename (without `.jsonl` extension) as the canonical `session_id` primary key in the DB. This matches the existing `reader.ts` behavior where `id` is set from the filename. Do not use the `sessionId` field from the JSONL content as the primary key — it is redundant data that can drift. Add a UNIQUE constraint on `session_id` and use `INSERT OR REPLACE` for upserts, not plain `INSERT`.

**Warning signs:**
- Session count in DB is double the JSONL file count after initial migration
- Sessions appear with identical timestamps and token counts but different IDs
- Dashboard shows same project appearing twice with slight stat differences
- Delta-sync always re-processes all sessions (mtime check passes but ID lookup fails)

**Phase to address:** Phase 1 (schema design) and Phase 2 (initial migration) — the primary key strategy is a schema decision that is expensive to change later.

---

### Pitfall 6: Delta Sync Uses Only File mtime — Misses Modified Sessions

**What goes wrong:**
The ingest job checks `mtime > last_ingested_at` to decide which JSONL files are new or modified. But JSONL files in `~/.claude/projects/` can have their mtime reset when:
- The directory is accessed from Windows (Windows Explorer, antivirus scan, backup software) — NTFS access can update atime/mtime
- The user imports a backup ZIP and extracts files (extracted files get current timestamp regardless of content age)
- Filesystem sync tools (Dropbox, OneDrive, cloud backup) touch files on sync

When mtime is unreliable, the delta sync either re-ingests everything on every run (performance regression) or misses legitimately updated files.

**How to avoid:**
Use a two-factor delta check:
1. `mtime > last_ingested_at` (fast first filter)
2. Content hash or file size comparison against the stored `file_size_bytes` column

Store `file_size_bytes` in the sessions table. If `mtime` is newer but `file_size_bytes` is unchanged, skip re-ingest. If `file_size_bytes` changed, always re-ingest regardless of mtime. This handles antivirus mtime touch (size unchanged) and correctly catches appended sessions (size always grows).

For the initial migration, ingest everything regardless of mtime and record the `file_size_bytes` for all sessions.

**Warning signs:**
- Ingest job log shows 400+ sessions "updated" on every 30-second run even when no Claude Code sessions are active
- CPU usage spikes every 30 seconds even at rest
- Sessions on the dashboard appear to have their timestamps reset to the current day

**Phase to address:** Phase 2 (delta sync implementation) — the two-factor check must be designed before the first sync run, not retrofitted after observing mtime unreliability.

---

### Pitfall 7: Database Merge Creates "Phantom" Sessions from Different Machines

**What goes wrong:**
When merging databases from two machines, sessions from machine B are inserted into machine A's DB using `INSERT OR IGNORE ON CONFLICT (session_id)`. Both machines ran Claude Code and created sessions, but some sessions on machine B are work-in-progress (not yet complete JSONL files). The merge inserts a snapshot of those incomplete sessions. Later, when the user continues those sessions on machine B and merges again, the delta sync does not detect the update because the session ID already exists and `INSERT OR IGNORE` silently skips it — the session in the DB remains frozen at the snapshot state from the first merge.

**Why it happens:**
`INSERT OR IGNORE` only prevents duplicate-key errors. It does not update existing rows. For session merging, the correct semantics are: "insert if new, update if the source data is newer (more complete)." Using `INSERT OR REPLACE` fixes this but blindly overwrites newer local data with older imported data when merge direction is reversed.

**How to avoid:**
Use `INSERT INTO ... ON CONFLICT (session_id) DO UPDATE SET ... WHERE excluded.message_count > sessions.message_count` (partial update). The logic: accept the incoming row's data only if it has more messages than the existing row. `message_count` is a reliable proxy for "more complete" because JSONL files only grow — they are append-only.

Also track a `source_machine` column (e.g., hostname) and a `last_merged_at` timestamp per session to detect merge loops.

**Warning signs:**
- After a second merge, some sessions show token counts from weeks ago even though the user continued working on them
- Session detail page shows a conversation that appears truncated mid-way
- `message_count` in DB is lower than the number of lines in the corresponding JSONL file

**Phase to address:** Phase 4 (DB merge) — the `ON CONFLICT DO UPDATE` strategy must be specified in the merge implementation spec, not left as an implementation detail.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `INSERT OR IGNORE` for all session upserts | Simple, no conflict logic needed | Incomplete sessions from merge are never updated; data freezes at first-seen state | Never for merge target — use `ON CONFLICT DO UPDATE WHERE` |
| Store DB on `/mnt/c/` NTFS path (same as codebase) | Single location for all project files | WAL mode failures, file locking errors from Windows processes accessing same file | Never — always use `~/.claude/` (Linux fs) |
| Run ingest inside a request handler | Trivial to implement, no background infrastructure | Multiple simultaneous ingest runs from concurrent requests; connection lock contention | Never — always use module-level singleton scheduler |
| Skip schema migrations (run `CREATE TABLE IF NOT EXISTS` on every startup) | No migration infrastructure needed | Cannot add columns without breaking existing installs; no rollback path | Only for schema version 1 (initial creation). After first release: add proper migrations. |
| Use JSONL `sessionId` field as DB primary key instead of filename | "Canonical" session ID from source | Discrepancy between filename and content ID causes duplicates; breaks consistency with existing `reader.ts` | Never — use filename |
| Re-ingest all sessions on every delta sync | Correct results guaranteed | 400+ JSONL file reads every 30 seconds; defeats the purpose of having a DB | Only for the one-time initial migration run |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| better-sqlite3 + Next.js | Import at module scope without `serverExternalPackages` | Add `serverExternalPackages: ['better-sqlite3']` to `next.config.ts` before first build |
| better-sqlite3 + hot reload | `new Database()` at module scope without `globalThis` guard | Wrap in `globalThis.__db` singleton; check `!global.__db || !global.__db.open` before creating |
| WAL mode + WSL2 | Enable WAL on a `/mnt/c/` path | Store DB at `~/.claude/claud-ometer.db` (Linux ext4 fs, not NTFS) |
| Ingest scheduler + hot reload | `setInterval` at module scope without `globalThis` guard | Wrap in `globalThis.__ingestInterval` singleton; guard with `if (global.__ingestInterval) return` |
| JSONL reader + DB ingest | Call full `parseSessionFile()` (existing reader) for ingest | Use the existing reader as-is for initial migration; for delta re-ingest, only re-parse files whose `file_size_bytes` changed |
| DB merge + `INSERT OR IGNORE` | Assume existing sessions are skipped correctly | Use `ON CONFLICT DO UPDATE SET ... WHERE excluded.message_count > sessions.message_count` |
| Active sessions + DB reads | Route active sessions through DB | Active sessions must continue reading live JSONL directly (via existing `reader.ts`) — DB rows for in-progress sessions are stale by definition |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Ingest wraps each session in its own transaction | Ingest of 400 sessions takes 30+ seconds (30ms per fsync in DELETE journal mode) | Batch all upserts in a single transaction; WAL mode reduces overhead but batching is still 10-25x faster | Immediately with > 50 sessions |
| Full JSONL parse for delta-sync unchanged sessions | CPU spikes every 30 seconds even with no new sessions | Two-factor check: skip if `mtime` unchanged OR `file_size_bytes` unchanged | With > 200 sessions total |
| `SELECT *` in API routes that previously called `getSessions()` raw | Dashboard loads 2-5x slower than expected | Use indexes on `project_id`, `timestamp`, `mtime`; select only needed columns | With > 500 sessions in DB |
| WAL file grows unbounded during heavy ingest | DB directory balloons; reads slow down as WAL grows | Call `db.pragma('wal_checkpoint(PASSIVE)')` at end of each ingest batch | WAL file above ~10 MB (roughly 10,000 upserts without checkpoint) |
| DB opened with default `busy_timeout = 0` | First concurrent read/write throws `SQLITE_BUSY` immediately | Set `db.pragma('busy_timeout = 5000')` on connection creation | Any concurrent read during ingest |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| DB file stored in project directory (`/mnt/c/SourceControl/.../claud-ometer.db`) | Accidentally committed to git; leaks conversation history | Always store at `~/.claude/claud-ometer.db`; add `*.db` to `.gitignore` |
| DB path constructed from user-supplied `projectId` query param | Path traversal: `projectId=../../etc/passwd` causes DB open on wrong file | DB path is a fixed constant, never derived from request parameters |
| Imported `.db` file accepted without size check | Maliciously large file could fill disk | Validate file size before accepting import (e.g., reject if > 500 MB) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Dashboard shows stale DB data during ingest with no indicator | User sees stats that don't match what they just did; trust erodes | Show "Last synced: X seconds ago" indicator; SWR revalidation fires after ingest completes |
| Initial migration runs synchronously on first page load | Dashboard appears frozen for 10-60 seconds on first install | Run initial migration in background; show "Initializing database..." indicator; page renders with empty state, not spinner |
| DB merge progress is not visible | Merge of large DB from another machine appears to hang | Show progress during merge: "Importing N of M sessions..." with a cancel option |
| Active sessions page reads from DB | Active session cards show stale data (DB is 30 seconds behind JSONL) | Active sessions page must always read live JSONL; DB is only for historical pages |
| "Export DB" exports the working database directly | User receives a locked/WAL-split file that cannot be opened cleanly elsewhere | Run `PRAGMA wal_checkpoint(FULL)` and `VACUUM INTO 'export.db'` before serving the export — never stream the live DB file |

---

## "Looks Done But Isn't" Checklist

- [ ] **better-sqlite3 bundling**: Verify `next build` production build succeeds (not just `next dev`) — Turbopack and webpack have different bundling behavior
- [ ] **WAL mode**: After `PRAGMA journal_mode = WAL`, verify a `-wal` file appears next to the `.db` file in `~/.claude/` (confirms WAL is active, not silently falling back)
- [ ] **Hot reload singleton**: Trigger 10 consecutive file saves in dev mode and verify server logs show exactly ONE ingest run starting, not 10
- [ ] **Delta sync**: Modify one JSONL file (append a line manually) and verify the ingest job picks it up within 30 seconds without re-ingesting all other sessions
- [ ] **Dedup key**: Run initial migration, then run it again immediately — verify session count is unchanged (idempotent)
- [ ] **DB path on WSL**: Verify `~/.claude/claud-ometer.db` resolves to `/home/<user>/.claude/` (Linux fs), not `/mnt/c/...` (NTFS)
- [ ] **Active sessions**: Verify that with DB enabled, the `/active` page still reads live JSONL (not DB) — confirm by starting a new Claude Code session and seeing it appear without waiting for the 30-second ingest cycle
- [ ] **Export**: Verify the exported `.db` file opens in DBeaver/SQLiteViewer without errors on a fresh machine (WAL checkpoint and VACUUM must run before export)
- [ ] **Merge idempotency**: Run the same DB merge twice — verify session count and token counts are unchanged after the second merge
- [ ] **Data source toggle**: Verify that switching to "imported data" mode still works after DB is added (the data source toggle must route reads to imported data store, not the main DB)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Native module bundling error discovered after build | LOW | Add `serverExternalPackages: ['better-sqlite3']` to `next.config.ts`; rebuild |
| DB stored on NTFS, WAL failures in production | HIGH | Stop server; copy DB to `~/.claude/`; update DB_PATH constant; rebuild; restart |
| Multiple ingest intervals stacked from hot reload | LOW | Dev-only issue; stop dev server; restart — intervals are cleared on process exit |
| Wrong dedup key (sessionId field vs filename) | HIGH | Requires schema drop and full re-migration from JSONL; preserve JSONL files — they are the source of truth |
| Incomplete sessions frozen after merge | MEDIUM | Write a repair script: for each session in DB, compare `message_count` to actual JSONL line count; re-ingest any session where JSONL has more lines than DB row |
| Unbounded WAL file | LOW | Run `db.pragma('wal_checkpoint(TRUNCATE)')` manually via a `/api/admin/checkpoint` endpoint |
| DB accidentally committed to git | HIGH | `git rm --cached *.db`; add to `.gitignore`; rotate if conversation history is sensitive |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Native module bundling | Phase 1 (SQLite layer) | Run `next build` and confirm it succeeds before writing any query code |
| Hot-reload multiple connections | Phase 1 (connection module) | Save a file 10 times rapidly in dev; confirm one DB connection in `global.__db` |
| DB on NTFS path | Phase 1 (DB path constant) | `ls ~/.claude/` and confirm `.db` and `-wal` files appear there, not in `/mnt/c/` |
| Background ingest scheduler | Phase 2 (ingest job) | Verify `global.__ingestInterval` exists after first page load; confirm no duplication after reloads |
| Wrong dedup key | Phase 1 (schema design) | Schema review: confirm PK is filename-derived `session_id` before any data is inserted |
| Delta sync mtime unreliability | Phase 2 (delta sync) | Manually `touch` a JSONL file without changing content; confirm ingest skips it (size unchanged) |
| Incomplete merge sessions | Phase 4 (DB merge) | Merge a DB that contains in-progress sessions; continue those sessions; merge again; confirm `message_count` updates |
| Active sessions reading DB | Phase 3 (API route migration) | Start a new session; confirm it appears on `/active` immediately (not after 30s ingest delay) |
| Export with open WAL | Phase 4 (export/import) | Export DB; open the exported file in a SQLite viewer on a fresh machine with no `-wal` file present |

---

## Sources

- [microsoft/WSL issue #4689: \\wsl$ filesystem does not support file locking](https://github.com/microsoft/WSL/issues/4689) — HIGH confidence, official Microsoft tracker
- [microsoft/WSL issue #2395: SQLite write locks not respected in WSL](https://github.com/microsoft/WSL/issues/2395) — HIGH confidence, official Microsoft tracker
- [WiseLibs/better-sqlite3 issue #1155: SqliteError database is locked in Next.js + Docker](https://github.com/WiseLibs/better-sqlite3/issues/1155) — HIGH confidence, official issue tracker
- [Next.js docs: serverExternalPackages configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — HIGH confidence, official Next.js docs
- [Next.js 16.1 release notes: Turbopack transitive serverExternalPackages](https://nextjs.org/blog/next-16-1) — HIGH confidence, official Next.js blog
- [SQLite docs: Write-Ahead Logging](https://sqlite.org/wal.html) — HIGH confidence, official SQLite documentation
- [SQLite docs: WAL mode does not work on network filesystem](https://sqlite.org/wal.html) — HIGH confidence, official SQLite documentation
- [vercel/next.js issue #45483: Fast Refresh causes database connection exhaustion](https://github.com/vercel/next.js/issues/45483) — HIGH confidence, official Next.js issue tracker
- [SQLite concurrent writes and "database is locked" errors — Ten Thousand Meters](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — MEDIUM confidence, verified against SQLite docs
- [How to access SQLite file in WSL2 — CODEMONDAY](https://medium.com/codemonday/how-to-access-sqlite-file-in-wsl2-dd9dc28ceead) — MEDIUM confidence, community source aligned with official WSL tracker
- [SQLite performance tuning (busy_timeout, WAL, batch transactions) — phiresky gist](https://gist.github.com/phiresky/978d8e204f77feaa0ab5cca08d2d5b27) — MEDIUM confidence, widely cited community reference

---
*Pitfalls research for: SQLite persistence + background ingest + DB merge — Next.js App Router on WSL2*
*Researched: 2026-03-19*
