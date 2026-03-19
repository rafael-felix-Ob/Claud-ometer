# Claud-ometer

## What This Is

A local-first Claude Code analytics dashboard with real-time active session monitoring. Shows currently running Claude Code sessions with live status (working, waiting, idle), duration, consumed tokens, and GSD build progress — all updating every 5 seconds. Also provides historical analytics: session list with search, project grid, cost analytics, and data import/export.

## Core Value

At a glance, know what every active Claude Code session is doing right now — no switching terminals or guessing.

## Current State

**Shipped:** v1.0 Active Sessions (2026-03-19)
**Codebase:** 5,914 LOC TypeScript/TSX
**Tech stack:** Next.js 16, React 19, SWR, Tailwind CSS v4, shadcn/ui, Recharts 3

v1.0 delivered real-time active session detection and display. All 22 requirements satisfied. 4 phases, 9 plans completed across 23 days.

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

## Current Milestone: v1.1 History Database

**Goal:** Persist parsed session data into a local SQLite database for faster queries, historical trends, and cross-machine portability.

**Target features:**
- SQLite local database as persistence layer for all historical session data
- Periodic background ingest job syncing JSONL → SQLite (delta only, new/modified files)
- All pages read from database except active sessions (still live JSONL)
- Activity chart on project detail page (similar to overview heatmap)
- Export/import .db file for cross-machine portability
- Merge databases from different machines (dedup by session ID)

### Active

- [ ] SQLite database schema and persistence layer
- [ ] Periodic background JSONL → SQLite ingest (delta sync)
- [ ] Migrate all API routes to read from database instead of JSONL
- [ ] Activity chart on project detail page
- [ ] Export/import database file
- [ ] Merge databases from different machines with deduplication

### Out of Scope

- Process-level detection (ps aux) — file watching is sufficient and more portable
- WebSocket/SSE push updates — polling at 5s is simple and adequate
- Notification system for session state changes — view-only for now
- Active session history/timeline — just current state

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| File modification watching over process detection | Simpler, more portable, no OS-specific parsing | ✓ Good |
| 5-second polling over WebSocket/SSE | Matches SWR pattern already used; minimal complexity | ✓ Good |
| Dedicated /active page over tab/widget | Clean separation, dedicated space for real-time view | ✓ Good |
| Card grid layout over table | Matches existing dashboard aesthetic, better for status-at-a-glance | ✓ Good |
| Tail-reading JSONL for state detection | Only need last few messages, avoids full file parse | ✓ Good |
| SQLite over cloud database | Local-first philosophy, zero config, portable .db file | — Pending |
| Background ingest over on-demand parsing | Pages load instantly from DB; active sessions stay real-time from JSONL | — Pending |
| DB merge over cloud sync | No accounts/auth needed; user controls when to merge | — Pending |

## Constraints

- **Tech stack**: Next.js 16, React 19, SWR, Tailwind CSS v4, shadcn/ui, Recharts 3
- **Local-first**: No external dependencies or cloud services — SQLite + filesystem only
- **Performance**: 5-second polling must not degrade dashboard; tail-read JSONL, not full re-parse
- **Compatibility**: Works alongside data source toggle (live vs imported)

---
*Last updated: 2026-03-19 after v1.1 milestone start*
