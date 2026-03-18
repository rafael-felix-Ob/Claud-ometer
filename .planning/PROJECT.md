# Claud-ometer — Active Sessions

## What This Is

A real-time active sessions view for the Claud-ometer dashboard. Shows currently running Claude Code sessions with live status (working, waiting for user input, idle), duration, consumed tokens, and GSD build progress — all updating every 5 seconds.

## Core Value

At a glance, know what every active Claude Code session is doing right now — no switching terminals or guessing.

## Requirements

### Validated

- ✓ Dashboard with overview stats, charts, recent sessions — existing
- ✓ Session list with search, pagination, detail view with conversation replay — existing
- ✓ Project grid with per-project stats and session drill-down — existing
- ✓ Cost analytics by model and over time — existing
- ✓ Data import/export (ZIP) with live/imported data source toggle — existing
- ✓ JSONL parsing, token counting, cost calculation from ~/.claude/ — existing
- ✓ Dark theme, sidebar navigation, SWR data fetching — existing

### Active

- [ ] Real-time active session detection via JSONL file modification timestamps
- [ ] Per-session status detection: working, waiting for user input, idle
- [ ] Per-session duration display (time since session started)
- [ ] Per-session consumed tokens display
- [ ] Per-session GSD build progress: current phase name, status, and next action
- [ ] Dedicated /active page with card grid layout
- [ ] Sidebar navigation entry with Activity/Radio icon
- [ ] 5-second auto-refresh polling

### Out of Scope

- Process-level detection (ps aux) — file watching is sufficient and more portable
- WebSocket/SSE push updates — polling at 5s is simple and adequate for this use case
- Notification system for session state changes — view-only for now
- Active session history/timeline — just current state

## Context

Claud-ometer is a local-first Next.js dashboard that reads Claude Code JSONL data from ~/.claude/. The existing architecture already has filesystem reading (reader.ts), SWR hooks for data fetching, and a consistent card-based UI pattern. This feature adds a new dimension: detecting and displaying sessions that are currently in progress rather than historical sessions.

Session state will be inferred from the JSONL data:
- **Working**: Last message is assistant with tool calls, or file modified very recently
- **Waiting for input**: Last message is assistant text without pending tool calls
- **Idle**: No file modification in the last few minutes but session was recently active

GSD progress is read from `.planning/STATE.md` and `.planning/ROADMAP.md` in the project directory associated with each session.

## Constraints

- **Tech stack**: Must use existing stack (Next.js 16, React 19, SWR, Tailwind, shadcn/ui, Recharts)
- **Local-first**: No new external dependencies or services — filesystem only
- **Performance**: 5-second polling must not degrade dashboard performance; avoid full re-parsing of large JSONL files
- **Compatibility**: Must work alongside existing data source toggle (live vs imported)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| File modification watching over process detection | Simpler, more portable, no OS-specific parsing | — Pending |
| 5-second polling over WebSocket/SSE | Matches SWR pattern already used; minimal complexity | — Pending |
| Dedicated /active page over tab/widget | Clean separation, dedicated space for real-time view | — Pending |
| Card grid layout over table | Matches existing dashboard aesthetic, better for status-at-a-glance | — Pending |
| Tail-reading JSONL for state detection | Only need last few messages, avoids full file parse | — Pending |

---
*Last updated: 2026-03-18 after initialization*
