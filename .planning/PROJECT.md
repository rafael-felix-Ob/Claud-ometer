# Claud-ometer

## What This Is

A local-first Claude Code analytics dashboard with real-time active session monitoring and persistent SQLite history. Shows currently running Claude Code sessions with live status (working, waiting, idle), duration, consumed tokens, and GSD build progress — all updating every 5 seconds. Historical analytics powered by SQLite: session list with search, project grid with activity charts, cost analytics, and cross-machine portability via .db file export/import/merge.

## Core Value

At a glance, know what every active Claude Code session is doing right now — no switching terminals or guessing.

## Current State

**Shipped:** v1.1 History Database (2026-03-19)
**Codebase:** 8,892 LOC TypeScript/TSX across 58 files
**Tech stack:** Next.js 16, React 19, SWR, Tailwind CSS v4, shadcn/ui, Recharts 3, better-sqlite3
**Test suite:** 101 tests across 7 suites

v1.0 delivered real-time active session detection and display. v1.1 added SQLite persistence layer with background ingest, API migration from JSONL to DB, and cross-machine portability.

## Requirements

### Validated

- ✓ Dashboard with overview stats, charts, recent sessions — pre-existing
- ✓ Session list with search, pagination, detail view with conversation replay — pre-existing
- ✓ Project grid with per-project stats and session drill-down — pre-existing
- ✓ Cost analytics by model and over time — pre-existing
- ✓ Data import/export (ZIP) with live/imported data source toggle — pre-existing
- ✓ JSONL parsing, token counting, cost calculation from ~/.claude/ — pre-existing
- ✓ Dark theme, sidebar navigation, SWR data fetching — pre-existing
- ✓ Real-time active session detection via JSONL file modification timestamps — v1.0
- ✓ Per-session status detection: working, waiting for user input, idle — v1.0
- ✓ Per-session duration and active work time display — v1.0
- ✓ Per-session consumed tokens display — v1.0
- ✓ Per-session GSD build progress: current phase name, status, and next action — v1.0
- ✓ Dedicated /active page with card grid layout — v1.0
- ✓ Sidebar navigation entry with Activity icon — v1.0
- ✓ 5-second auto-refresh polling — v1.0
- ✓ Project path display on active session cards — v1.0
- ✓ SQLite database with WAL mode, auto-apply schema, globalThis singleton — v1.1
- ✓ Periodic background ingest (2-min cycle, two-factor delta check, idempotent) — v1.1
- ✓ Sidebar sync status indicator (last ingest time, session count) — v1.1
- ✓ All historical API routes read from SQLite (live mode) with JSONL fallback (imported mode) — v1.1
- ✓ Active sessions page stays on live JSONL — v1.1
- ✓ Session detail hybrid: DB aggregates + JSONL messages — v1.1
- ✓ Export .db file for cross-machine portability — v1.1
- ✓ Import/replace .db file — v1.1
- ✓ Merge .db files with session deduplication by message count — v1.1
- ✓ Project detail activity bar chart (last 30 days) — v1.1
- ✓ ZIP import → SQLite bridge option — v1.1

### Out of Scope

- Process-level detection (ps aux) — file watching is sufficient and more portable
- WebSocket/SSE push updates — polling at 5s is simple and adequate
- Notification system for session state changes — view-only for now
- Active session history/timeline — just current state
- Cloud database (Supabase/Postgres) — local-first philosophy; SQLite is zero-config and portable
- Database encryption — local-first tool; filesystem permissions are sufficient
- Automatic cloud sync between machines — user-controlled export/merge is simpler

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| File modification watching over process detection | Simpler, more portable, no OS-specific parsing | ✓ Good |
| 5-second polling over WebSocket/SSE | Matches SWR pattern already used; minimal complexity | ✓ Good |
| Dedicated /active page over tab/widget | Clean separation, dedicated space for real-time view | ✓ Good |
| Card grid layout over table | Matches existing dashboard aesthetic, better for status-at-a-glance | ✓ Good |
| Tail-reading JSONL for state detection | Only need last few messages, avoids full file parse | ✓ Good |
| SQLite over cloud database | Local-first philosophy, zero config, portable .db file | ✓ Good |
| better-sqlite3 over Drizzle/Prisma | Synchronous API, on Next.js serverExternalPackages allowlist, no webpack config | ✓ Good |
| globalThis singleton for DB connection | Prevents hot-reload duplication in Next.js dev mode | ✓ Good |
| globalThis for ingest state | Module isolation in Next.js requires shared state on globalThis, not module vars | ✓ Good |
| Background ingest over on-demand parsing | Pages load instantly from DB; active sessions stay real-time from JSONL | ✓ Good |
| DB merge over cloud sync | No accounts/auth needed; user controls when to merge | ✓ Good |
| ATTACH DATABASE for merge | Native SQLite cross-database queries, no temp tables needed | ✓ Good |
| Two-path data access | Live mode uses SQLite, imported mode uses JSONL — clean separation | ✓ Good |

## Constraints

- **Tech stack**: Next.js 16, React 19, SWR, Tailwind CSS v4, shadcn/ui, Recharts 3, better-sqlite3
- **Local-first**: No external dependencies or cloud services — SQLite + filesystem only
- **Performance**: 5-second polling must not degrade dashboard; tail-read JSONL, not full re-parse
- **Compatibility**: Works alongside data source toggle (live vs imported)

---
*Last updated: 2026-03-19 after v1.1 milestone completion*
