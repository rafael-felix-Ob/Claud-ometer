# Project Research Summary

**Project:** Claud-ometer v1.1 — History Database
**Domain:** SQLite persistence layer + background JSONL ingest + cross-machine DB merge in Next.js 16 App Router (WSL2)
**Researched:** 2026-03-19
**Confidence:** HIGH

## Executive Summary

Claud-ometer v1.1 (History Database) is an additive performance milestone on an existing local-first analytics dashboard. The core problem is that every page request re-parses all JSONL files from scratch — acceptable at small history sizes, increasingly slow as sessions accumulate. The solution is a persistent SQLite cache populated by a background delta ingest job, so API routes query pre-parsed row data instead of scanning the filesystem on every request. The defining architectural principle is two-path data access: historical pages query SQLite, active sessions continue reading live JSONL directly (DB is intentionally 2 minutes stale by design).

The recommended stack is tight and well-proven: `better-sqlite3` (synchronous API, no webpack configuration needed) plus raw SQL with `CREATE TABLE IF NOT EXISTS` and `PRAGMA user_version` migration tracking, `node-cron` in `instrumentation.ts` for background scheduling. No ORM is needed — the schema is 4 stable tables. All new runtime packages are on Next.js's built-in `serverExternalPackages` allowlist, eliminating any webpack configuration. The existing stack (SWR, Recharts, shadcn/ui, Tailwind v4, the JSONL reader) requires zero changes — the DB layer slots in strictly below the existing API surface. UI components and SWR hooks are entirely unaffected because `db-reader.ts` returns the same TypeScript types as `reader.ts`.

Two risks dominate this milestone and must be resolved in Phase 1 before any other code is written. First, WSL2 filesystem placement: the DB file must live on the Linux ext4 VHD (`~/.claude/claud-ometer.db`), not on NTFS (`/mnt/c/...`), or WAL mode produces `SQLITE_IOERR_LOCK` errors that are difficult to diagnose after migration. Second, the `globalThis` singleton pattern: without it, Next.js hot-reload creates multiple DB connections and ingest scheduler instances that collide under write-lock contention. A third risk — using `INSERT OR IGNORE` semantics for DB merge — means sessions continued on machine B after a first merge are permanently frozen at their snapshot state; the correct merge strategy is `ON CONFLICT DO UPDATE WHERE excluded.message_count > sessions.message_count`.

## Key Findings

### Recommended Stack

The stack additions are minimal and deliberate. `better-sqlite3` is the correct SQLite driver: synchronous API matches the codebase style (no async/await chains in API routes), it is the fastest Node.js SQLite option, and it is on Next.js's built-in external packages allowlist (no webpack configuration required). `node-cron` handles periodic ingest scheduling inside `instrumentation.ts` (Next.js's official single-startup hook). Raw SQL with `PRAGMA user_version` is sufficient for migration tracking on a 4-table schema. Existing packages `archiver` and `jszip` cover DB file export and import without new dependencies.

**Core technologies:**
- `better-sqlite3 12.8.0`: SQLite driver — synchronous, on Next.js built-in allowlist, no native-module bundling issues
- `node-cron 3.x`: Ingest scheduler — runs via `instrumentation.ts`, fires every 2 minutes, pure JS (no native binaries)
- `instrumentation.ts` (Next.js built-in): Server-startup hook — `register()` called once per process; `NEXT_RUNTIME === 'nodejs'` guard required to exclude Edge runtime
- `globalThis` singleton pattern: DB connection + ingest scheduler guard — prevents hot-reload duplication in `next dev`
- WAL mode (`PRAGMA journal_mode = WAL`): Required for concurrent read/write safety during background ingest — only valid on Linux ext4, not NTFS via WSL2

**What not to use:** `node:sqlite` (still experimental), Prisma (150ms+ cold start, shadow DB requirement, overkill), `sqlite3` npm (callback-based, slower, less maintained), drizzle-orm (adds build-time compilation step with no meaningful benefit at this schema size), worker threads for ingest (I/O-bound task, unnecessary complexity).

### Expected Features

**Must have (P1 — milestone is incomplete without these):**
- SQLite schema: `sessions`, `projects`, `daily_activity` (with `project_id`), `model_usage`, `ingested_files` tables; WAL mode + `busy_timeout = 5000` enabled at init
- Delta ingest job: two-factor check (mtime + `file_size_bytes`); only re-parses changed or new JSONL files; upserts to DB; fires on startup and every 2 minutes; all upserts in a single transaction
- All read API routes query SQLite (`/api/stats`, `/api/projects`, `/api/sessions`) — active sessions and session detail remain JSONL
- Activity chart on project detail page — the only new user-visible feature in the milestone; uses existing Recharts `BarChart` pattern
- DB export (`.db` file download with WAL checkpoint before serving) and import (upload with size validation) routes
- DB merge by session ID with `ON CONFLICT DO UPDATE WHERE excluded.message_count > sessions.message_count`

**Should have (P2 — add once P1 is solid):**
- Ingest status indicator ("last synced X seconds ago") — addresses trust gap when transitioning from direct JSONL to DB-backed reads
- Merge preview (row count before committing) — safety gate for cross-machine merge
- Correctness validation pass: compare DB-backed API output to JSONL-backed output on same dataset before final cutover

**Defer (v2+):**
- Full-text search across message content (SQLite FTS5) — large scope; defer until DB layer is battle-tested
- Worker thread for ingest — only if ingest measurably degrades API latency at real-world data volumes
- Ingest interval as user setting — hard-code 2 minutes for now

**Anti-features (do not build):**
- Full message content in SQLite — bloats DB 10x; session detail page reads one JSONL file on demand and is fast
- Real-time file watcher (`fs.watch`/chokidar) — unreliable on WSL2; periodic polling is the correct strategy
- Replace ZIP export with DB-only export — ZIP is a full backup (raw JSONL + settings + plans); DB is an analytics cache only; both must coexist

### Architecture Approach

The milestone uses strict two-path data access. New files (`db.ts`, `schema.ts`, `ingest.ts`, `db-reader.ts`, `db-merge.ts`) are added under `src/lib/claude-data/` without modifying `reader.ts` or `active-sessions.ts`. API routes switch their import source from `reader.ts` to `db-reader.ts` — same function signatures, same TypeScript return types — so the UI layer and SWR hooks require zero changes. The session detail route (`/api/sessions/[id]`) uses a hybrid: aggregates from DB, messages from JSONL (full message content is excluded from the DB by design). `data-source.ts` receives a `getDbPath()` addition to respect the existing live/imported data toggle. Background ingest is initialized in `instrumentation.ts`, never in request handlers.

**Major components:**
1. `db.ts` — `better-sqlite3` singleton via `globalThis.__claud_ometer_db__`; opens DB at `~/.claude/claud-ometer.db`; applies schema migrations; WAL mode + foreign keys + `busy_timeout` on creation
2. `schema.ts` — DDL for all 4 tables; `PRAGMA user_version` migration tracking; `CREATE TABLE IF NOT EXISTS` semantics
3. `ingest.ts` — Two-factor delta check (mtime + `file_size_bytes`); reuses `parseSessionFile` from `reader.ts`; `rebuildProjectStats()` after each batch; all upserts in one transaction; `node-cron` scheduler via `globalThis.__ingestInterval__` guard
4. `db-reader.ts` — SQL equivalents of `getSessions()`, `getProjects()`, `getDashboardStats()`; same TypeScript return types as `reader.ts`; JSON column deserialization after retrieval
5. `db-merge.ts` — Opens two DB files; `ON CONFLICT DO UPDATE WHERE message_count` conflict resolution; `rebuildProjectStats()` after merge; readonly import DB
6. `instrumentation.ts` (project root) — `register()` imports and starts ingest scheduler once; `NEXT_RUNTIME === 'nodejs'` guard required

**Build order (strict dependency chain):**

`db.ts + schema.ts` → `data-source.ts getDbPath()` → `ingest.ts` → `db-reader.ts` → API route import swaps → `/api/ingest` status route → `db-merge.ts` → export/import route modifications → project activity chart

### Critical Pitfalls

1. **DB file on NTFS via WSL2 causes WAL mode failures** — Always store at `~/.claude/claud-ometer.db` (Linux ext4 VHD); never derive DB path from `process.cwd()` which resolves to `/mnt/c/...`. Verify by confirming a `-wal` file appears in `~/.claude/` after enabling WAL mode.

2. **Multiple DB connections from hot reload cause "database is locked"** — Use `globalThis.__claud_ometer_db__` singleton with `!global.__db || !global.__db.open` guard. Set `PRAGMA busy_timeout = 5000` on connection creation. Apply the same `globalThis` guard to the ingest scheduler to prevent duplicate `setInterval` stacking.

3. **`better-sqlite3` bundled by webpack/Turbopack causes build failure** — Add `serverExternalPackages: ['better-sqlite3']` to `next.config.ts` before writing any DB code. Verify `next build` (production build) succeeds — Turbopack and webpack have different bundling behavior and the dev build may pass while production fails.

4. **`INSERT OR IGNORE` for merge freezes incomplete sessions** — Use `ON CONFLICT (session_id) DO UPDATE SET ... WHERE excluded.message_count > sessions.message_count`. Plain `INSERT OR IGNORE` means a session continued on machine B after the first merge is permanently frozen at its snapshot state; the user sees truncated sessions indefinitely.

5. **Delta sync using only mtime misses files touched by Windows processes** — Store `file_size_bytes` in `ingested_files` table; use two-factor check: skip if mtime unchanged OR size unchanged; re-ingest if size changed. Antivirus scans and backup software update mtime without changing file content on WSL2 NTFS paths.

6. **Wrong dedup key (JSONL `sessionId` field vs filename)** — Use the JSONL filename (without `.jsonl` extension) as the canonical session ID primary key. This matches the existing `reader.ts` behavior where session `id` is derived from the filename. Using the content `sessionId` field can cause duplicates if files were renamed or created by different Claude Code versions.

7. **Exporting the live WAL-mode DB file directly produces a corrupt download** — Run `PRAGMA wal_checkpoint(FULL)` and `VACUUM INTO 'export.db'` before serving the export. Streaming the live `.db` file while a companion `-wal` file exists produces a file that cannot be opened on a machine without that same `-wal` file.

## Implications for Roadmap

The build order for this milestone is non-negotiable — each phase has hard dependencies on the previous one. No phases can be parallelized. Four phases, structured by dependency chain, with a fifth for user-visible features that are independent once the DB is populated.

### Phase 1: SQLite Foundation

**Rationale:** Every other component depends on a working DB connection, schema, and correct filesystem placement. WAL mode, the `globalThis` singleton, and the `next.config.ts` entry must be correct before any data is written. Schema decisions made here (including `project_id` on `daily_activity` and the `file_size_bytes` column on `ingested_files`) are expensive to change post-migration.

**Delivers:** `db.ts` singleton with `globalThis` guard, WAL mode, `busy_timeout`; `schema.ts` DDL with all 4 tables and `PRAGMA user_version` tracking; `data-source.ts` `getDbPath()` extension; `next.config.ts` `serverExternalPackages` entry; verified DB file at `~/.claude/` on Linux ext4

**Addresses:** SQLite schema + WAL mode (P1 feature)

**Avoids:** NTFS WAL failure (Pitfall 1), multiple connections from hot reload (Pitfall 2), native bundling failure (Pitfall 3), wrong dedup key (Pitfall 6)

### Phase 2: Delta Ingest Job

**Rationale:** Ingest must be proven correct — producing output that matches JSONL-based parsing — before any API routes switch to reading from DB. Validating ingest against the JSONL baseline is the quality gate for the entire milestone. The ingest scheduler singleton must be established here, not retrofitted later.

**Delivers:** `ingest.ts` with two-factor mtime + `file_size_bytes` delta check; `rebuildProjectStats()` aggregation; `instrumentation.ts` startup hook; `node-cron` scheduler via `globalThis` singleton guard; `/api/ingest/route.ts` status and manual-trigger endpoint

**Addresses:** Delta ingest job (P1), background ingest trigger (P1)

**Avoids:** Ingest scheduler duplication from hot reload (Pitfall 2/4), mtime unreliability on WSL2 (Pitfall 5), per-transaction fsync overhead (all upserts in one transaction — 25x faster than individual transactions)

### Phase 3: API Route Migration

**Rationale:** `db-reader.ts` functions must return identical TypeScript types to their `reader.ts` counterparts. Validate output against the JSONL baseline (from Phase 2) before switching routes. This is the most impactful change in the milestone — it touches all primary API routes — and must be done with a side-by-side correctness check.

**Delivers:** `db-reader.ts` with `getSessions()`, `getProjects()`, `getDashboardStats()` equivalents; API routes `/api/stats`, `/api/projects`, `/api/sessions` switched to `db-reader.ts`; session detail hybrid (DB aggregates + JSONL messages for conversation replay); correctness validation pass comparing DB vs JSONL output on same dataset

**Addresses:** All read API routes query DB (P1), correctness validation (P2)

**Avoids:** Breaking active sessions (reader.ts left completely untouched), silent data corruption (same return types enforced), UI breakage (zero changes to hooks or components required)

### Phase 4: DB Export / Import / Merge

**Rationale:** These features touch existing working routes (`/api/export`, `/api/import`) and add new behavior (`/api/db-merge`). Safest to add after the DB is proven stable and accurate. Export must checkpoint before serving; merge must use `ON CONFLICT DO UPDATE WHERE` not `INSERT OR IGNORE`.

**Delivers:** DB export route with `PRAGMA wal_checkpoint(FULL)` + `VACUUM INTO` before serving; DB import route with file size validation; `db-merge.ts` with `message_count`-based conflict resolution; merge preview (P2); UI additions on `/data` page

**Addresses:** DB export (P1), DB import (P1), DB merge (P1), merge preview (P2)

**Avoids:** Corrupt export download (Pitfall 7), frozen sessions from incorrect merge semantics (Pitfall 4)

### Phase 5: Project Activity Chart and Polish

**Rationale:** The only new user-visible feature in the milestone. Fully independent of all other new components once the DB is populated and API routes are migrated. Uses the existing Recharts `BarChart` pattern — no new chart library or component type needed. The `project_id` column dependency must be confirmed as present in the Phase 1 schema before Phase 5 begins.

**Delivers:** Activity bar chart on project detail page using `daily_activity` rows filtered by `project_id`; new `/api/projects/[id]/activity` route; ingest status indicator ("last synced X seconds ago") in sidebar or `/data` page

**Addresses:** Activity chart (P1), ingest status indicator (P2)

**Avoids:** Missing `project_id` column — this is a Phase 1 schema decision that must be verified before Phase 5 implementation begins; the chart cannot be added without a schema migration if it was omitted

### Phase Ordering Rationale

- Phase 1 precedes everything: the `globalThis` singleton, filesystem path, `next.config.ts` entry, and dedup key are schema-level decisions that are expensive to change after any data is written.
- Phase 2 before Phase 3: ingest correctness must be validated against the JSONL baseline before routes are switched. Running both in parallel risks shipping pages backed by corrupted data silently.
- Phase 4 after Phase 3: export/import/merge touch existing working routes; adding them after the DB is stable avoids compounding risk on multiple surfaces simultaneously.
- Phase 5 last: the chart data is already in the DB after Phase 2; the only blocker is confirming the `project_id` schema decision (Phase 1) and having the API routes migrated (Phase 3).

### Research Flags

Phases with well-documented patterns (skip `/gsd:research-phase`):
- **Phase 1:** `globalThis` singleton, WAL mode, `serverExternalPackages` — all patterns confirmed with working code examples in ARCHITECTURE.md; filesystem placement verified via official WSL2 and SQLite docs
- **Phase 3:** API route import swaps — mechanical change; same TypeScript types enforced; correctness validation approach is straightforward comparison
- **Phase 5:** Recharts `BarChart` — existing pattern in codebase; no new chart library; `project_id` column in `daily_activity` is the only dependency

Phases that would benefit from implementation spike before full phase spec:
- **Phase 2:** The two-factor delta check (mtime + `file_size_bytes`), batched transaction pattern, and `rebuildProjectStats()` aggregation logic are well-specified in research but have enough implementation surface that a working spike against real data before the full phase is written will reduce rework. PITFALLS.md "Looks Done But Isn't" checklist is the verification target.
- **Phase 4:** `VACUUM INTO` behavior under concurrent reads and `ON CONFLICT DO UPDATE WHERE` merge semantics both have subtle edge cases confirmed in research. Implementation should reference PITFALLS.md merge section explicitly and run the merge-idempotency check (same DB merged twice, session count unchanged) before shipping.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages confirmed against official docs; version compatibility verified; no experimental dependencies; `serverExternalPackages` allowlist membership confirmed |
| Features | HIGH | Derived from direct codebase analysis; all integration points identified with specific file paths; P1/P2/P3 prioritization is unambiguous |
| Architecture | HIGH | Build order and component boundaries confirmed against current codebase; two-path data access pattern verified against existing `reader.ts` / `active-sessions.ts` boundary; all patterns have working code examples |
| Pitfalls | HIGH | WSL2 WAL failure confirmed via official Microsoft WSL issue tracker; hot-reload singleton pattern confirmed via official Next.js GitHub issues; merge semantics validated against SQLite official docs |

**Overall confidence:** HIGH

### Gaps to Address

- **`project_id` on `daily_activity` schema**: Research flags this as a Phase 1 schema decision that enables the Phase 5 chart. The exact column list for `daily_activity` was inferred from `DashboardStats.dailyActivity` type in `types.ts` but not confirmed by reading the type definition directly. Verify against `src/lib/claude-data/types.ts` during Phase 1 schema design.

- **`instrumentation.ts` vs module-level import for scheduler init**: STACK.md recommends `instrumentation.ts` with `node-cron`; FEATURES.md describes a module-level `globalThis` singleton with `setInterval`. These are compatible (instrumentation calls the scheduler module) but the exact integration point should be decided once in the Phase 1 spec to avoid both approaches being implemented inconsistently.

- **`PRAGMA user_version` vs drizzle-kit for schema migrations**: Research conclusion is raw SQL with `PRAGMA user_version` is correct for this schema size. If the schema changes more frequently than anticipated after v1.1 ships, the manual migration function approach in `schema.ts` will need to be evaluated against `drizzle-kit push`. This is a post-v1.1 concern, not a blocker.

## Sources

### Primary (HIGH confidence)
- Next.js 16.2.0 docs: `serverExternalPackages`, `instrumentation.ts` — confirmed package allowlist membership and startup hook behavior
- `better-sqlite3` npm and GitHub — version 12.8.0 release confirmed; WAL mode, synchronous API, `globalThis` singleton patterns verified
- SQLite official docs: WAL mode, `VACUUM INTO`, `ON CONFLICT DO UPDATE WHERE` — semantics confirmed against official documentation
- Microsoft WSL GitHub issues #4689, #2395 — NTFS WAL locking failure confirmed as known tracked issue
- Next.js GitHub issue #45483 — Fast Refresh DB connection exhaustion pattern confirmed in official issue tracker
- Existing codebase (`src/lib/claude-data/reader.ts`, `active-sessions.ts`, `data-source.ts`, all API routes) — integration points confirmed by direct codebase analysis

### Secondary (MEDIUM confidence)
- Community benchmarks: WAL mode per-transaction overhead vs DELETE journal mode; batched transaction speedup
- `drizzle-orm` docs: `drizzle-orm/better-sqlite3` integration path (researched as alternative, not selected)
- node-cron documentation: schedule syntax and compatibility with Next.js App Router serverful deployment

### Tertiary (LOW confidence — validate during implementation)
- Two-factor delta check (mtime + `file_size_bytes`): behavior pattern inferred from WSL2 antivirus/backup software mtime-touch behavior; not directly benchmarked against real WSL2 environment
- `VACUUM INTO 'export.db'` safety under concurrent reads at DB sizes above 500MB: confirmed as correct SQLite pattern but large-DB behavior not tested against real data volumes

---
*Research completed: 2026-03-19*
*Ready for roadmap: yes*
