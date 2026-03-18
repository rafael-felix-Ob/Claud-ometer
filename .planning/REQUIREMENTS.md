# Requirements: Claud-ometer — Active Sessions

**Defined:** 2026-03-18
**Core Value:** At a glance, know what every active Claude Code session is doing right now

## v1 Requirements

Requirements for the active sessions feature. Each maps to roadmap phases.

### Detection

- [x] **DETECT-01**: System detects active sessions by scanning JSONL files modified within the last 30 minutes (configurable via ACTIVE_WINDOW_MS)
- [x] **DETECT-02**: System infers session status as "working" when last message is assistant with tool calls or file was modified within last 10 seconds
- [x] **DETECT-03**: System infers session status as "waiting" when last message is assistant text without pending tool calls
- [x] **DETECT-04**: System infers session status as "idle" when no file modification in the last 5 minutes but session was recently active
- [x] **DETECT-05**: System uses tail-read (last 16KB) of JSONL files instead of full re-parse for performance
- [x] **DETECT-06**: System treats incomplete last-line parse as "working" (write in progress)

### Display

- [x] **DISP-01**: User can view active session duration (time since session started)
- [x] **DISP-02**: User can view consumed tokens per active session
- [x] **DISP-03**: User can view project name and path for each active session
- [x] **DISP-04**: User can view git branch for each active session
- [x] **DISP-05**: User can view which Claude model each active session is using
- [x] **DISP-06**: User can click through to full session detail at /sessions/[id]

### GSD Progress

- [x] **GSD-01**: User can view current GSD phase name and status for sessions with .planning/ directories
- [x] **GSD-02**: User can view the next GSD action for each active GSD session
- [x] **GSD-03**: GSD progress gracefully shows nothing when .planning/ directory is absent

### UI

- [x] **UI-01**: Dedicated /active page with card grid layout
- [x] **UI-02**: Sidebar navigation entry with Activity icon
- [x] **UI-03**: Cards auto-refresh every 5 seconds with last-updated indicator
- [x] **UI-04**: Animated pulse indicator on "working" status sessions
- [x] **UI-05**: Cards ordered by status: working first, waiting second, idle last
- [x] **UI-06**: Empty state displayed when no active sessions detected
- [x] **UI-07**: Banner displayed when using imported data mode (live monitoring unavailable)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Monitoring

- **ADV-01**: Token velocity indicator (tokens/minute for current session)
- **ADV-02**: Idle threshold customization via settings
- **ADV-03**: Active session count badge on sidebar nav icon

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| WebSocket/SSE push updates | Polling at 5s is simple and adequate; breaks stateless API pattern |
| Desktop/browser notifications | Significant scope increase for a view-only page |
| Session termination/kill controls | Dashboard is read-only; terminal is for process control |
| Historical active session timeline | Duplicates Overview/Costs pages |
| Embedded conversation replay in cards | Defeats at-a-glance card grid purpose |
| Per-session cost prediction | Unreliable future-state prediction; show cost-to-date instead |
| Configurable polling interval UI | 5 seconds is the right default; no user need for flexibility |
| Process-level detection (ps aux) | File watching is sufficient and more portable |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DETECT-01 | Phase 1 | Complete |
| DETECT-02 | Phase 1 | Complete |
| DETECT-03 | Phase 1 | Complete |
| DETECT-04 | Phase 1 | Complete |
| DETECT-05 | Phase 1 | Complete |
| DETECT-06 | Phase 1 | Complete |
| DISP-01 | Phase 2 | Complete |
| DISP-02 | Phase 2 | Complete |
| DISP-03 | Phase 2 | Complete |
| DISP-04 | Phase 2 | Complete |
| DISP-05 | Phase 2 | Complete |
| DISP-06 | Phase 2 | Complete |
| GSD-01 | Phase 3 | Complete |
| GSD-02 | Phase 3 | Complete |
| GSD-03 | Phase 3 | Complete |
| UI-01 | Phase 2 | Complete |
| UI-02 | Phase 2 | Complete |
| UI-03 | Phase 2 | Complete |
| UI-04 | Phase 2 | Complete |
| UI-05 | Phase 2 | Complete |
| UI-06 | Phase 2 | Complete |
| UI-07 | Phase 2 | Complete |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after 02-03 completion (DISP-06, UI-03 marked complete)*
