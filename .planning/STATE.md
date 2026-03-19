---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: History Database
status: unknown
stopped_at: Completed 08-02-PLAN.md (all 3 tasks complete, Task 3 human-verify approved). Milestone v1.1 History Database complete.
last_updated: "2026-03-19T20:29:48.789Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 7
  completed_plans: 7
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** At a glance, know what every active Claude Code session is doing right now
**Current focus:** Phase 08 — Portability and UI

## Current Position

Phase: 08 (Portability and UI) — COMPLETE
Plan: 2 of 2 — all plans done. Milestone v1.1 History Database COMPLETE.

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.1 arch]: better-sqlite3 over drizzle/Prisma — synchronous API, on Next.js serverExternalPackages allowlist, no webpack config needed
- [v1.1 arch]: DB file at ~/.claude/claud-ometer.db (Linux ext4) — NTFS WAL mode produces SQLITE_IOERR_LOCK, confirmed WSL2 known issue
- [v1.1 arch]: globalThis singleton for DB connection and ingest scheduler — prevents hot-reload duplication
- [v1.1 arch]: instrumentation.ts for scheduler startup — Next.js official single-startup hook
- [v1.1 arch]: Two-path data access — historical pages use SQLite, active sessions stay on live JSONL
- [v1.1 arch]: reader.ts must NOT be modified — active sessions depend on it
- [v1.1 arch]: ON CONFLICT DO UPDATE WHERE message_count for merge — INSERT OR IGNORE freezes incomplete sessions
- [Phase 06-delta-ingest]: runIngestCycle always reads live ~/.claude/projects, not getProjectsDir() — ingest operates on live data regardless of UI data source toggle
- [Phase 06-delta-ingest]: recomputeAggregates uses DELETE+INSERT per cycle for full consistency over UPSERT approach
- [Phase 06-delta-ingest]: SyncStatus interface defined in hooks.ts (not imported from ingest.ts) to keep client/server boundary clean
- [Phase 06-delta-ingest]: ingest sync state moved to globalThis to survive Next.js module isolation between instrumentation.ts and API route handlers
- [Phase 07-api-migration]: getProjectsFromDb() reads sessions.model (raw IDs) and applies getModelDisplayName() — projects.models column is always '[]' from ingest
- [Phase 07-api-migration]: dailyActivity in getDashboardStatsFromDb uses GROUP BY date (not date+project_id) for one entry per calendar date
- [Phase 07-api-migration]: getSessionDetailFromDb returns DB aggregates with empty messages[] when JSONL missing (null only when session row absent from DB)
- [Phase 07-02]: getDashboardStats() in reader.ts rewritten for imported mode — full JSONL scan, no stats-cache dependency; StatsCache type and supplemental stats machinery removed
- [Phase 08-01]: ATTACH DATABASE merge SQL qualifies JOIN with main.sessions to avoid "ambiguous column name" SQLite error
- [Phase 08-01]: DB replace order: stopIngestScheduler -> close DB -> delete WAL/SHM -> write file -> createDb -> startIngestScheduler
- [Phase 08-01]: getProjectActivityFromDb is synchronous (better-sqlite3 synchronous API); test dates use Date.now() offsets to survive 30-day window filter
- [Phase 08-02]: ZIP-to-SQLite bridge uses /api/ingest POST route (new) — client component boundary requires server route
- [Phase 08-02]: Ingest route passes path.join(getImportDir(), 'claude-data', 'projects') per Pitfall 6 — not getImportDir() directly

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 5 RESOLVED]: daily_activity table includes project_id as part of composite PK — confirmed correct for Phase 8 activity chart
- [Phase 5 RESOLVED]: instrumentation.ts confirmed as the startup hook — module-level import approach not used

## Session Continuity

Last session: 2026-03-19T20:10:00Z
Stopped at: Completed 08-02-PLAN.md (all 3 tasks complete, Task 3 human-verify approved). Milestone v1.1 History Database complete.
Resume file: None
