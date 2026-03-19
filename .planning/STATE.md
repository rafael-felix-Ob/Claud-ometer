---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: History Database
status: ready_to_plan
stopped_at: null
last_updated: "2026-03-19T12:00:00.000Z"
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** At a glance, know what every active Claude Code session is doing right now
**Current focus:** Phase 5 — SQLite Foundation (ready to plan)

## Current Position

Phase: 5 of 8 (SQLite Foundation)
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-03-19 — Roadmap created for v1.1 History Database

Progress: [░░░░░░░░░░] 0% (v1.1)

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 5]: Verify project_id column on daily_activity table — required by Phase 8 activity chart; schema decision must be correct before any data is written
- [Phase 5]: Confirm instrumentation.ts vs module-level import for scheduler init — decide once to avoid both approaches coexisting

## Session Continuity

Last session: 2026-03-19
Stopped at: Roadmap created — ready to plan Phase 5
Resume file: None
