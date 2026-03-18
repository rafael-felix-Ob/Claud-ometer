# Feature Research

**Domain:** Real-time active session monitoring dashboard (local-first, file-based)
**Researched:** 2026-03-18
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = the /active page feels broken or useless.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Active session list | Core purpose of the page — without it there is nothing to show | LOW | Filter sessions by file modification recency; already have reader.ts and `fs.stat()` |
| Per-session status indicator | Users need to know at-a-glance what each session is doing (working/waiting/idle) | MEDIUM | Inferred from last JSONL message type and file mtime; three states sufficient |
| Session duration display | How long has this been running? First question a user asks | LOW | `Date.now() - session.startTime`; already have formatDuration() |
| Token consumption display | How much has this session used so far? Critical for cost awareness | LOW | Read from existing token aggregation in reader.ts; tail-read for perf |
| Auto-refresh / polling | Without live updates the page is just a stale snapshot | LOW | SWR `refreshInterval: 5000` is one line; already the established pattern |
| Empty state when no active sessions | If nothing is running, the page must say so clearly — not just show empty space | LOW | Simple conditional render; "No active sessions" message |
| Visual distinction from historical sessions | Users must not confuse active/live cards with historical session cards | LOW | Animated status dot, "LIVE" badge, or pulsing indicator |
| Last-updated timestamp | Users need to trust the data is fresh; shows when last polled | LOW | SWR provides `isValidating`; display "updated X seconds ago" |
| Link to session detail | Users expect to click through to the full conversation replay | LOW | Already exists at `/sessions/[id]` — just link |
| Project name / path label | Which project is this session in? | LOW | Already in SessionInfo from reader.ts |

### Differentiators (Competitive Advantage)

Features that set this monitoring view apart. Not required for the page to function, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| GSD build progress display | Shows current phase + status + next action from `.planning/STATE.md` — unique to Claude Code + GSD workflows | MEDIUM | Read `.planning/STATE.md` and `.planning/ROADMAP.md` from project directory; parse markdown; gracefully absent if no GSD setup |
| Animated pulse on "working" state | Reinforces liveness without requiring manual refresh; removes doubt about whether status is stale | LOW | Tailwind `animate-pulse` on status dot; zero cost to implement |
| Status-based card ordering | Working sessions first, waiting second, idle last — highest-attention items surface automatically | LOW | Sort array before render; single comparator function |
| Token velocity indicator | Tokens/minute for the current session — tells you if Claude is blazing or stalled | MEDIUM | Requires tracking tokens at two points in time; adds complexity but high signal value |
| Git branch display | Shows what branch the session is operating on — helps identify which work item is active | LOW | Already in SessionInfo.gitBranch; just surface it |
| Idle threshold customization | Let user define what "idle" means (e.g., 2 min vs 10 min) | MEDIUM | Would need localStorage or settings page; defer unless requested |
| Model indicator per session | Which Claude model is running? Opus vs Sonnet vs Haiku has cost implications | LOW | Already in SessionInfo.models[]; just display last model used |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in this context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| WebSocket / SSE push updates | "Real-time" sounds better than polling | Requires stateful server infrastructure; breaks the local-first, stateless API route model; adds connection management complexity for minimal gain at 5-second granularity | SWR `refreshInterval: 5000` — 5-second polling is imperceptible to the user and matches the existing data pattern |
| Desktop / browser notifications | "Alert me when a session finishes" sounds useful | Requires Notification API permissions, background tab awareness, and event diffing between polls — this is a significant scope increase for a view-only page | Show visual state change on next poll; badge on sidebar nav item when attention needed |
| Session termination / kill control | "Kill idle sessions from the dashboard" | Requires process-level access (SIGTERM), OS-specific handling, and elevates the dashboard from read-only to control plane — major security/reliability surface | Keep dashboard read-only; terminal is the right tool for process control |
| Historical active session timeline | "Show me how many sessions were active over the past hour" | This is historical analytics, not real-time monitoring; duplicates the Overview and Costs pages; creates scope overlap | Link to existing Sessions page filtered by time range |
| Full conversation replay in cards | Embed message transcript directly in the active card | Cards would become enormous; defeats the purpose of the at-a-glance grid layout | Keep cards compact; link to `/sessions/[id]` for detail |
| Per-session cost prediction | "Estimate how much this session will cost when done" | Requires future-state prediction from current rate — unreliable, misleading, complex | Show current cost-to-date; sufficient for awareness without false precision |
| Configurable polling interval via UI | Slider to set "refresh every N seconds" | Adds UI complexity for a setting that serves almost no use case — 5 seconds is the right default | Hard-code 5 seconds; if edge cases arise, add to config later |

## Feature Dependencies

```
Active Session Detection (file mtime filtering)
    └──requires──> Filesystem reader with mtime access (fs.stat)
                       └──exists──> reader.ts already has this

Per-Session Status Indicator
    └──requires──> Active Session Detection
    └──requires──> Tail-read of last N JSONL messages (for last message type)

Token Display
    └──requires──> Active Session Detection
    └──can reuse──> Existing token aggregation in reader.ts (parseSessionFile)

Duration Display
    └──requires──> Active Session Detection (session start time from first JSONL message)

GSD Progress Display
    └──requires──> Active Session Detection (to know which project directory to check)
    └──requires──> .planning/STATE.md parser (new, simple markdown read)
    └──optional──> .planning/ROADMAP.md for phase count context
    └──degrades gracefully when absent──> Show nothing if no .planning/ directory

Auto-Refresh (SWR polling)
    └──requires──> /api/active-sessions route (new)
    └──enables──> All live features

Status-Based Card Ordering
    └──requires──> Per-Session Status Indicator
    └──enhances──> Active Session List (better scannability)

Animated Status Pulse
    └──requires──> Per-Session Status Indicator
    └──enhances──> Visual distinction from historical sessions

Token Velocity Indicator
    └──requires──> Token Display
    └──requires──> Timestamp of previous poll result (client-side diff)
    └──conflicts with──> Simple stateless SWR hook (needs previous data reference)
```

### Dependency Notes

- **Active Session Detection requires tail-reading:** Full JSONL re-parse on every 5-second poll would be expensive for large sessions. Detection only needs file mtime and last ~10 lines. Use `fs.stat()` for mtime and read file in reverse or seek to end for status inference.
- **GSD Progress Display has no hard dependency:** It enhances the feature but is fully optional. Cards render fine without it. Treat as additive layer, not prerequisite.
- **Token Velocity conflicts with stateless pattern:** Calculating tokens/minute requires comparing current token count to previous token count. SWR discards previous data on revalidation unless explicitly retained. This is the reason Token Velocity is listed as a differentiator rather than table stakes — it requires non-trivial client state management.
- **All new features share a single new API route:** `/api/active-sessions` should return all data needed for the page (status, duration, tokens, GSD progress) in one call to avoid multiple round-trips per poll cycle.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed for the /active page to be useful from day one.

- [ ] Active session detection via file mtime (files modified within last N minutes) — without this nothing works
- [ ] Per-session status indicator (working / waiting / idle) inferred from last JSONL message type — core differentiator of this page vs sessions list
- [ ] Session duration display — answers "how long has this been running?"
- [ ] Token consumption display — answers "how much has this cost so far?"
- [ ] 5-second SWR polling with last-updated indicator — makes it feel live
- [ ] Card grid layout with project name, git branch, link to detail — consistent with existing dashboard aesthetics
- [ ] Empty state when no active sessions — required for correctness
- [ ] Sidebar nav entry with activity icon — page must be discoverable

### Add After Validation (v1.x)

Features to add once the core page is working and used.

- [ ] GSD progress display — high value for GSD users but requires STATE.md parser; add once base page is stable
- [ ] Status-based card ordering (working first, then waiting, then idle) — trivial to add, wait to validate the status detection is reliable first
- [ ] Animated pulse on "working" status dot — polish; add in same pass as ordering

### Future Consideration (v2+)

Features to defer until usage patterns are understood.

- [ ] Token velocity indicator — interesting but adds client state complexity; defer until users ask for it
- [ ] Idle threshold as a user setting — defer until someone actually needs a different threshold
- [ ] Model indicator prominence — already have the data; include if card layout has space, otherwise defer

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Active session detection (mtime filter) | HIGH | LOW | P1 |
| Status indicator (working/waiting/idle) | HIGH | MEDIUM | P1 |
| Duration display | HIGH | LOW | P1 |
| Token consumption display | HIGH | LOW | P1 |
| 5-second SWR polling | HIGH | LOW | P1 |
| Empty state | HIGH | LOW | P1 |
| Card grid layout | HIGH | LOW | P1 |
| Sidebar nav entry | HIGH | LOW | P1 |
| Last-updated timestamp | MEDIUM | LOW | P1 |
| Project name / path on card | MEDIUM | LOW | P1 |
| Link to session detail | MEDIUM | LOW | P1 |
| Git branch display | MEDIUM | LOW | P2 |
| GSD progress display | HIGH | MEDIUM | P2 |
| Status-based card ordering | MEDIUM | LOW | P2 |
| Animated working pulse | MEDIUM | LOW | P2 |
| Model indicator | LOW | LOW | P2 |
| Token velocity indicator | MEDIUM | HIGH | P3 |
| Idle threshold customization | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch — page is not useful without these
- P2: Should have — add in same milestone once P1 is solid
- P3: Nice to have — future milestone or user-requested

## Competitor Feature Analysis

No direct competitors exist for Claude Code session monitoring dashboards. Closest analogues are process managers and CI/CD dashboards.

| Feature | PM2 Web Dashboard | Grafana CI/CD | Our Approach |
|---------|-------------------|---------------|--------------|
| Live status per process | Green/red indicator | Pipeline status badge | Three-state (working/waiting/idle) inferred from JSONL message type |
| Duration display | Process uptime since start | Job elapsed time | Session elapsed time since first JSONL message |
| Resource consumption | CPU/memory graphs | Build step timing | Token count as primary resource metric |
| Build phase progress | Not applicable | Pipeline stage visualization | GSD phase from STATE.md (unique to this product) |
| Update mechanism | WebSocket push | SSE or polling | SWR 5-second polling — matches existing codebase pattern |
| Empty state | "No processes" message | "No pipelines" placeholder | "No active sessions" with helpful context |

## Sources

- [Carbon Design System — Status Indicator Pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/) — authoritative component design guidance
- [Cloudscape Design System — Status Indicator](https://cloudscape.design/components/status-indicator/?tabId=playground) — production design system from AWS
- [Smashing Magazine — UX Strategies for Real-Time Dashboards (2025)](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) — data freshness indicators, visual hierarchy patterns
- [Medium — Polling vs WebSockets in 2025](https://medium.com/israeli-tech-radar/dont-forget-the-user-polling-vs-websockets-in-2025-cb99999db9be) — polling is appropriate for 5-second granularity dashboards
- [OpenAI Community — Feature Request: Active Session Dashboard with Status Indicators](https://community.openai.com/t/feature-request-active-session-dashboard-with-status-indicators-power-user-pro-workflow-suggestion/1224072) — confirms "working/needs input" status distinction is a recognized user need for AI coding sessions
- [pm2.web GitHub](https://github.com/oxdev03/pm2.web) — reference implementation for process monitoring card UI

---
*Feature research for: real-time active session monitoring (Claud-ometer /active page)*
*Researched: 2026-03-18*
