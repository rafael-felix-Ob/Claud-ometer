# Roadmap: Claud-ometer — Active Sessions

## Overview

This milestone adds a real-time /active page to the Claud-ometer dashboard. Phase 1 builds the detection engine — the filesystem reader that infers session status from JSONL file modification times and tail-reads. Phase 2 builds the full visible page — API route, SWR hook, card grid, and all display requirements. Phase 3 adds optional GSD build progress enrichment on top of the working page.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Detection Engine** - Filesystem reader that infers active session status from JSONL tail-reads and mtime analysis
- [ ] **Phase 2: Active Sessions Page** - API route, SWR hook, card grid UI, and all session display requirements
- [ ] **Phase 3: GSD Integration** - Optional GSD build progress enrichment on cards for sessions with .planning/ directories

## Phase Details

### Phase 1: Detection Engine
**Goal**: The system can accurately detect which Claude Code sessions are currently active and infer their status from filesystem data alone
**Depends on**: Nothing (first phase)
**Requirements**: DETECT-01, DETECT-02, DETECT-03, DETECT-04, DETECT-05, DETECT-06
**Success Criteria** (what must be TRUE):
  1. Given JSONL files in ~/.claude/, the system returns only sessions with files modified within the last 10 minutes
  2. A session whose last JSONL message is an assistant turn with tool calls is classified as "working"
  3. A session whose last JSONL message is an assistant turn without tool calls is classified as "waiting"
  4. A session with no file modification in the last 5 minutes is classified as "idle"
  5. A session with an incomplete (mid-write) final JSONL line is classified as "working" rather than erroring
**Plans:** 2/3 plans executed

Plans:
- [ ] 01-01-PLAN.md — Test infrastructure (Jest + ts-jest) and type contracts (ActiveSessionInfo, SessionStatus)
- [ ] 01-02-PLAN.md — Core detection functions (tailReadJsonl, inferSessionStatus, scanActiveFiles) via TDD
- [ ] 01-03-PLAN.md — getActiveSessions orchestrator with token cache, duration calculation, and cache eviction

### Phase 2: Active Sessions Page
**Goal**: Users can navigate to /active and see all currently running Claude Code sessions with live-updating status, duration, tokens, and project context
**Depends on**: Phase 1
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06, UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07
**Success Criteria** (what must be TRUE):
  1. User can navigate to /active from the sidebar and see a card grid of active sessions
  2. Each card shows session duration, consumed tokens, project name and path, git branch, and Claude model in use
  3. Clicking a card navigates to the full session detail at /sessions/[id]
  4. Cards refresh every 5 seconds and display a last-updated timestamp
  5. Working-status cards display an animated pulse indicator; cards are ordered working first, waiting second, idle last
  6. When no sessions are active, an explicit empty state is shown; when using imported data mode, a banner explains live monitoring is unavailable
**Plans**: TBD

### Phase 3: GSD Integration
**Goal**: Active session cards show current GSD build phase, status, and next action for sessions running inside GSD-managed projects
**Depends on**: Phase 2
**Requirements**: GSD-01, GSD-02, GSD-03
**Success Criteria** (what must be TRUE):
  1. A session running in a GSD project shows the current phase name, phase status, and next action on its card
  2. A session running in a non-GSD project shows no GSD section on its card (no errors, no empty placeholders)
  3. GSD progress data updates with each 5-second poll alongside the session status
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Detection Engine | 2/3 | In Progress|  |
| 2. Active Sessions Page | 0/TBD | Not started | - |
| 3. GSD Integration | 0/TBD | Not started | - |
