# Stack Research

**Domain:** SQLite persistence, background JSONL ingest, and DB export/merge in Next.js 16 App Router
**Researched:** 2026-03-19
**Confidence:** HIGH

> This file supersedes the previous STACK.md (v1.0 Active Sessions milestone, 2026-03-18).
> The v1.0 stack (SWR polling, fs tail-read, module-scope cache) remains in place.
> This file covers **additive changes only** for the v1.1 History Database milestone.

---

## Recommended Stack (New Additions)

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| better-sqlite3 | 12.8.0 | SQLite driver for Node.js | Synchronous API matches the existing codebase style (no async/await chains needed in API routes). Fastest Node.js SQLite driver. 4,700+ dependent packages. Production-stable since 2017. On Next.js's built-in `serverExternalPackages` list — zero webpack config required. |
| drizzle-orm | latest (^0.44) | Type-safe query builder + schema for SQLite | Lightweight ORM with zero runtime overhead (generates SQL at build time). Works directly with better-sqlite3 via `drizzle-orm/better-sqlite3`. Schema-as-TypeScript lets us co-locate the DB shape with existing types. No class decorator magic, no reflection metadata. Fits the codebase's "no magic" style. |
| drizzle-kit | latest (^0.31) | Migration generation and push | `drizzle-kit push` applies schema to the DB in one command. `drizzle-kit generate` creates versioned SQL migration files. Used as a dev dependency — not bundled into the app. |
| node-cron | 3.x | In-process cron scheduler | Runs the JSONL→SQLite ingest job on a schedule (e.g. every 5 minutes) inside the Next.js Node.js server process. Pure JS, no native binary. On Next.js's built-in `serverExternalPackages` list. Simpler than worker threads for a single-machine local tool. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/better-sqlite3 | latest | TypeScript types for better-sqlite3 | Dev dependency. Required for type-safe DB access without drizzle. Needed even when using drizzle because drizzle accepts a typed `Database` instance. |
| archiver (already installed) | ^7.0.1 | ZIP the .db file for export | Already in package.json. Re-use for DB file export the same way it is used for the existing ZIP export feature. No new dependency. |
| jszip (already installed) | ^3.10.1 | Extract DB file from imported ZIP | Already in package.json. Re-use for the import side of DB file portability. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| drizzle-kit | Schema push and migration generation | `npx drizzle-kit push` to sync schema to DB. Run once on first start and after schema changes. Add `db:push` script to package.json. |
| drizzle-kit studio (optional) | Visual SQLite browser | `npx drizzle-kit studio` opens a local web UI to inspect DB content. Useful for debugging ingest output. Dev-only. |

---

## Installation

```bash
# Core runtime
npm install better-sqlite3 drizzle-orm node-cron

# Dev dependencies
npm install -D drizzle-kit @types/better-sqlite3
```

Add to `package.json` scripts:
```json
{
  "db:push": "drizzle-kit push",
  "db:generate": "drizzle-kit generate"
}
```

---

## next.config.js — No Changes Required

`better-sqlite3` and `node-cron` are both on Next.js's **built-in `serverExternalPackages` allowlist** (confirmed in Next.js 16.2.0 docs). This means Next.js automatically opts them out of Server Component bundling and uses native Node.js `require` at runtime.

**No webpack configuration changes needed.**

Verify at: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages

---

## Integration Points with Existing Code

### Database singleton (src/lib/claude-data/db.ts — new file)

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import os from 'os';
import * as schema from './schema'; // new schema file

const DB_PATH = path.join(os.homedir(), '.claude', 'claud-ometer.db');

// Module-scope singleton — Next.js module cache keeps this alive
// across API route invocations in the same server process
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL'); // critical for concurrent reads during ingest
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle(sqlite, { schema });
```

This follows the established module-scope singleton pattern already used in `reader.ts` (`supplementalCache`, `sessionCache`).

### Background ingest via instrumentation.ts (src/instrumentation.ts — new file)

`instrumentation.ts` at the project root is Next.js's official hook for "run once on server startup." Its `register()` function is called **once** when the Next.js server instance starts.

```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import ensures this only runs server-side
    const { startIngestScheduler } = await import('./lib/claude-data/ingest-scheduler');
    startIngestScheduler();
  }
}
```

The scheduler module uses node-cron to trigger JSONL→SQLite delta sync:

```typescript
// src/lib/claude-data/ingest-scheduler.ts
import cron from 'node-cron';

let started = false;

export function startIngestScheduler() {
  if (started) return; // guard against hot-reload double-start in dev
  started = true;

  // Run every 5 minutes; also run once immediately on start
  runIngest();
  cron.schedule('*/5 * * * *', runIngest);
}
```

### API route migration

Existing API routes in `src/app/api/` import from `reader.ts`. For the DB milestone, they will be migrated to import from a new `db-reader.ts` that queries the SQLite DB instead of parsing JSONL. The active sessions route (`/api/active`) is **excluded from migration** — it stays on JSONL tail-reads for real-time accuracy.

### DB export/import

Re-uses the existing `/api/export` and `/api/import` routes. The DB file (`~/.claude/claud-ometer.db`) is included in the ZIP alongside (or instead of) raw JSONL. The existing `archiver` and `jszip` packages handle this.

### DB merge

Implemented as a new `/api/db/merge` API route. Deduplication by `session_id` primary key using SQLite's `INSERT OR IGNORE` semantics. The merge is a pure SQL operation — no external library needed.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| better-sqlite3 (sync) | node:sqlite (built-in, async) | Once `node:sqlite` exits experimental status (currently Stability 1.1, requires no flag as of Node 22.5+, but still marked experimental). For this local tool, the stability advantage of better-sqlite3 outweighs the zero-dependency appeal of built-in. |
| better-sqlite3 (sync) | prisma + prisma-client | If the project ever needed multiple database backends, Prisma's abstraction layer would justify the setup overhead. For SQLite-only local-first apps, Prisma adds ~150ms cold-start and a separate shadow database for migrations. Not worth it here. |
| drizzle-orm | Raw better-sqlite3 SQL | Acceptable alternative. drizzle adds type-safety and migration tooling. Raw SQL is fine for this schema size but requires manually writing migration scripts. Drizzle's overhead is near-zero (compile-time query building). |
| drizzle-orm | Sequelize / TypeORM | Both are class-decorator ORM paradigms with heavyweight reflection metadata. Incompatible with Next.js App Router's tree-shaking expectations. Avoid. |
| node-cron in instrumentation.ts | Separate sidecar process | A standalone `node ingest.js` script run by the OS scheduler (cron, Task Scheduler) would be more robust in production but requires user setup. For a self-hosted local tool, in-process scheduling is simpler and requires zero user configuration beyond `npm run dev`. |
| node-cron in instrumentation.ts | setInterval in API route | `setInterval` in a route handler fires once per request, not once globally. Module-scope `setInterval` would work but is harder to reason about than an explicit scheduler with cron semantics. |
| instrumentation.ts for startup hook | globalThis singleton with lazy init | `globalThis` singleton works but fires on first request, not on startup. Ingest should run at startup to pre-warm the DB before the first page load. `instrumentation.ts` is the official Next.js hook for this. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node:sqlite` (built-in) | Still experimental as of Node 22/23. Production apps should not depend on experimental APIs. | `better-sqlite3` — stable, fast, same synchronous API shape |
| Prisma | 150ms+ cold start, requires shadow DB for migrations, excessive abstraction for a single-file SQLite app | `drizzle-orm` + `drizzle-kit` |
| `sqlite3` (npm, async) | Callback-based async API, ~3x slower than better-sqlite3, not actively maintained at the same level | `better-sqlite3` |
| Worker threads for ingest | Significant complexity (serialization, message passing, SharedArrayBuffer) for a background task that runs every 5 minutes and is not latency-sensitive | `node-cron` in `instrumentation.ts` on the main thread — ingest is I/O bound, not CPU bound |
| Cloud sync / SQLite extensions (CRDT-based) | SQLite Sync and similar tools target multi-master real-time sync. The requirement here is simple point-in-time merge of two machines' exports — no conflicts by design (session IDs are UUIDs) | `INSERT OR IGNORE` dedup by session_id primary key in a `/api/db/merge` route |

---

## Stack Patterns by Variant

**For WAL mode (required for ingest + concurrent reads):**
- Set `sqlite.pragma('journal_mode = WAL')` once on DB open
- WAL allows reads and the ingest write to proceed concurrently — critical when an API route is reading while a background sync is writing
- WAL reduces per-transaction overhead from 30ms+ to under 1ms (confirmed by community benchmarks)

**For delta ingest (avoid re-parsing unchanged files):**
- Track `last_modified_at` (mtime) per session in the DB
- On each ingest run: `WHERE last_modified_at > stored_mtime OR session_id NOT IN sessions`
- This is the same mtime pattern used by the existing active-session detection in `reader.ts`

**For DB merge (cross-machine dedup):**
- Attach the imported DB: `ATTACH DATABASE 'import.db' AS imported`
- `INSERT OR IGNORE INTO sessions SELECT * FROM imported.sessions`
- `DETACH DATABASE imported`
- No external library needed — this is a native SQLite SQL pattern

**For schema migrations on startup:**
- Use `drizzle-kit push` (dev) or `migrate()` from `drizzle-orm/migrator` (prod) in `instrumentation.ts` before starting the cron scheduler
- This ensures the DB schema is always up to date on server start without user intervention

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| better-sqlite3 12.8.0 | Node.js 20/22, Next.js 16.1.6 | HIGH confidence — actively maintained, supports all current Node LTS versions. On Next.js built-in external packages list. |
| drizzle-orm ^0.44 | better-sqlite3 12.x, TypeScript 5 | HIGH confidence — `drizzle-orm/better-sqlite3` entry point is the official integration path. No version conflicts with existing stack. |
| drizzle-kit ^0.31 | drizzle-orm ^0.44 | MEDIUM confidence — drizzle-kit minor versions must stay in sync with drizzle-orm minor versions. Pin both together. |
| node-cron 3.x | Node.js 20/22, Next.js 16.1.6 | HIGH confidence — pure JS, no native binaries. On Next.js built-in `serverExternalPackages` list. `register()` is the correct init point in App Router. |
| instrumentation.ts | Next.js 13+ (stable in 15+) | HIGH confidence — stable API (not experimental) as of Next.js 15. Available in Next.js 16.1.6. Called once per server instance. `NEXT_RUNTIME === 'nodejs'` guard required to exclude Edge runtime. |

---

## Sources

- [Next.js serverExternalPackages docs (v16.2.0)](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — Confirmed `better-sqlite3` and `node-cron` are on the built-in allowlist. HIGH confidence.
- [Next.js instrumentation docs (v16.2.0)](https://nextjs.org/docs/app/guides/instrumentation) — Confirmed `register()` runs once on server start; `NEXT_RUNTIME` guard pattern. HIGH confidence.
- [Drizzle ORM SQLite getting started](https://orm.drizzle.team/docs/get-started-sqlite) — Package names, driver import path, config shape confirmed. HIGH confidence.
- [better-sqlite3 GitHub discussions #1245](https://github.com/WiseLibs/better-sqlite3/discussions/1245) — better-sqlite3 vs node:sqlite comparison; consensus: better-sqlite3 is production choice until built-in exits experimental. MEDIUM confidence.
- [better-sqlite3 npm page](https://www.npmjs.com/package/better-sqlite3) — Version 12.8.0 confirmed (released 2026-03-13). HIGH confidence.
- [SQLite WAL mode merge performance](https://copyprogramming.com/howto/fastest-way-merge-two-sqlite-databases) — WAL mode, INSERT OR IGNORE, ATTACH DATABASE merge pattern. MEDIUM confidence (community source, but widely corroborated).
- Existing codebase (`src/lib/claude-data/reader.ts`) — Module-scope singleton pattern (`supplementalCache`), mtime delta detection, force-dynamic API routes — confirmed in source. HIGH confidence.

---

*Stack research for: SQLite persistence, background JSONL ingest, cross-machine DB merge in Next.js 16 App Router*
*Researched: 2026-03-19*
