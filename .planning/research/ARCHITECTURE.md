# Architecture Research

**Domain:** Real-time active session monitoring integrated into existing Next.js analytics dashboard
**Researched:** 2026-03-18
**Confidence:** HIGH — based on direct codebase analysis, no speculative claims

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          UI Layer (React / SWR)                       │
│                                                                       │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│  │  /active page  │  │  Sidebar       │  │  useActiveSessions()   │  │
│  │  (card grid)   │  │  (nav + badge) │  │  SWR, 5s interval      │  │
│  └───────┬────────┘  └───────┬────────┘  └───────────┬────────────┘  │
│          │                  │                        │               │
│          └──────────────────┴────────────────────────┘               │
│                             │ HTTP GET                                │
├─────────────────────────────┼────────────────────────────────────────┤
│                          API Layer (Next.js route handlers)           │
│                             │                                         │
│  ┌──────────────────────────▼───────────────────────────────────┐    │
│  │          GET /api/active-sessions                             │    │
│  │          force-dynamic, returns ActiveSessionInfo[]           │    │
│  └──────────────────────────┬───────────────────────────────────┘    │
│                             │ calls                                   │
├─────────────────────────────┼────────────────────────────────────────┤
│                     Filesystem Reader Layer                           │
│                             │                                         │
│  ┌──────────────────────────▼───────────────────────────────────┐    │
│  │   getActiveSessions()  — new function in reader.ts            │    │
│  │   ├── getRecentJsonlFiles(cutoffMs)    (file stat scan)       │    │
│  │   ├── tailReadJsonl(filePath, n)       (tail-read last N msgs)│    │
│  │   ├── inferSessionStatus(lastMsgs)     (state machine)        │    │
│  │   └── readGsdProgress(projectCwd)      (plain text read)      │    │
│  └──────────────────────────┬───────────────────────────────────┘    │
│                             │ fs operations                           │
├─────────────────────────────┼────────────────────────────────────────┤
│                         Filesystem                                    │
│                                                                       │
│  ┌───────────────────┐  ┌─────────────────────────────────────────┐  │
│  │  ~/.claude/       │  │  <project-cwd>/.planning/               │  │
│  │  projects/        │  │  ├── STATE.md   (phase, plan, status)   │  │
│  │  <projectId>/     │  │  └── ROADMAP.md (phase list, progress)  │  │
│  │  <sessionId>.jsonl│  │                                         │  │
│  └───────────────────┘  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|---------------|----------|
| `/active` page | Renders active session card grid, owns 5-second SWR polling | `src/app/active/page.tsx` (new) |
| `useActiveSessions()` hook | SWR hook with `refreshInterval: 5000`, mirrors pattern from `hooks.ts` | `src/lib/hooks.ts` (extend) |
| `GET /api/active-sessions` | HTTP endpoint, delegates to reader, returns `ActiveSessionInfo[]` | `src/app/api/active-sessions/route.ts` (new) |
| `getActiveSessions()` | Scans for recently-modified JSONL files, tail-reads each, infers status, reads GSD progress | `src/lib/claude-data/reader.ts` (extend) |
| `tailReadJsonl()` | Reads only last N lines of a JSONL file using byte-offset seek, avoids full re-parse | `src/lib/claude-data/reader.ts` (new helper) |
| `inferSessionStatus()` | Pure function: maps last messages to `working | waiting | idle` states | `src/lib/claude-data/reader.ts` (new helper) |
| `readGsdProgress()` | Reads `.planning/STATE.md` and `.planning/ROADMAP.md` from project cwd | `src/lib/claude-data/reader.ts` (new helper) |
| `ActiveSessionCard` | Renders single session with status badge, duration, tokens, GSD progress | `src/components/cards/active-session-card.tsx` (new) |
| `Sidebar` | Adds `/active` nav item with `Radio` or `Activity` Lucide icon | `src/components/layout/sidebar.tsx` (extend) |
| `ActiveSessionInfo` | Type for active session data (extends SessionInfo subset + status + gsdProgress) | `src/lib/claude-data/types.ts` (extend) |

## Recommended Project Structure

```
src/
├── app/
│   ├── active/
│   │   └── page.tsx            # New — /active page, 5-second polling card grid
│   └── api/
│       └── active-sessions/
│           └── route.ts        # New — GET /api/active-sessions
├── components/
│   └── cards/
│       └── active-session-card.tsx   # New — status card component
└── lib/
    ├── claude-data/
    │   ├── types.ts            # Extend — add ActiveSessionInfo, SessionStatus
    │   └── reader.ts           # Extend — add getActiveSessions(), tailReadJsonl(),
    │                           #           inferSessionStatus(), readGsdProgress()
    └── hooks.ts                # Extend — add useActiveSessions()
```

### Structure Rationale

- **`app/active/`:** Follows the existing page-per-route pattern (`/sessions`, `/projects`, `/costs`). No nested routes needed for this feature.
- **`api/active-sessions/`:** Separate route from `/api/sessions` — different data shape, different freshness requirement, different read strategy (tail-read vs full-parse).
- **`components/cards/active-session-card.tsx`:** Status cards are significantly different from `stat-card.tsx` (richer, include status badge and GSD section). New component avoids polluting the generic stat card.
- **Reader extensions in `reader.ts`:** All filesystem reads live here by convention. GSD progress reading belongs here too — it is just another filesystem read from the project cwd.
- **Types extension in `types.ts`:** Single source of truth for all data shapes.

## Architectural Patterns

### Pattern 1: Tail-Reading JSONL for Status Inference

**What:** Read only the last 10-20 lines of a JSONL file using `fs.statSync().size` + `fs.read()` with byte offset to seek near the end, then scan backward to find complete lines.

**When to use:** Any time you need only the "latest state" of a session rather than aggregate statistics. Avoids reading entire files that can be megabytes for long sessions.

**Trade-offs:**
- Pro: 10-20x faster than full-parse for large sessions; does not block the 5-second polling loop
- Con: Slightly more complex than `readline` — must handle the partial-first-line edge case from the byte-seek
- Pro: The existing `extractCwdFromSession()` function in `reader.ts` uses the same pattern (first 8KB read), confirming the approach is already established

**Example:**
```typescript
function tailReadJsonl(filePath: string, maxLines = 20): SessionMessage[] {
  const stat = fs.statSync(filePath);
  const chunkSize = Math.min(stat.size, 8192); // read last 8KB
  const buffer = Buffer.alloc(chunkSize);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, chunkSize, stat.size - chunkSize);
  fs.closeSync(fd);
  const text = buffer.toString('utf-8');
  const lines = text.split('\n').filter(Boolean).slice(-maxLines);
  return lines
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean) as SessionMessage[];
}
```

### Pattern 2: Status Inference as a Pure Function

**What:** A stateless function that maps an array of tail-read messages to a `SessionStatus` enum value. No side effects, fully testable.

**When to use:** Any time status must be computed from message data. Decoupled from file I/O so it can be unit-tested without touching the filesystem.

**Trade-offs:**
- Pro: Clear, auditable rules; easy to adjust thresholds
- Con: Can only infer — no ground truth about whether the process is alive

**Status rules (derived from PROJECT.md requirements):**
```typescript
type SessionStatus = 'working' | 'waiting' | 'idle';

function inferSessionStatus(
  lastMessages: SessionMessage[],
  fileMtimeMs: number
): SessionStatus {
  const ageMs = Date.now() - fileMtimeMs;
  if (ageMs > 5 * 60 * 1000) return 'idle';  // no activity in 5 minutes

  const last = lastMessages[lastMessages.length - 1];
  if (!last) return 'idle';

  if (last.type === 'assistant') {
    const content = last.message?.content;
    const hasToolCalls = Array.isArray(content) &&
      content.some(c => c && typeof c === 'object' && 'type' in c && c.type === 'tool_use');
    return hasToolCalls ? 'working' : 'waiting';
  }

  // Last message is user — assistant is actively processing
  return 'working';
}
```

### Pattern 3: GSD Progress as Optional Enrichment

**What:** Attempt to read `.planning/STATE.md` and `.planning/ROADMAP.md` from the session's `cwd`. Return `null` if files are absent. The active sessions API works without GSD data.

**When to use:** When a project cwd is known and `.planning/` exists. Silently skips if not a GSD project.

**Trade-offs:**
- Pro: Degrades gracefully — non-GSD projects still show in active sessions, just without progress
- Con: Requires parsing plain markdown; use simple regex/string matching (not a full markdown parser)
- The STATE.md format is well-defined (`Phase: X of Y`, `Status: ...`, `Progress: [░░██████░░] N%`) — a few targeted regexes are sufficient

## Data Flow

### 5-Second Polling Flow

```
[5s timer triggers SWR revalidation]
    ↓
useActiveSessions() → GET /api/active-sessions
    ↓
Route handler → getActiveSessions()
    ↓
1. fs.readdirSync(projectsDir) — list all projects
2. For each project: fs.readdirSync(projectPath) — list JSONL files
3. fs.statSync(filePath) — get mtime for each
4. Filter: keep only files modified within last 10 minutes (cutoff)
5. tailReadJsonl(filePath) — read last 20 lines
6. inferSessionStatus(messages, mtime) — compute status
7. If status != idle AND cwd known: readGsdProgress(cwd) — optional
8. Build ActiveSessionInfo[] (subset of SessionInfo + status + gsdProgress)
    ↓
JSON response → SWR cache update → React re-render
```

### Key Data Flows

1. **Active detection:** File modification time is the signal. Any JSONL file modified within the last 10 minutes is a candidate active session. The 10-minute window is generous — `inferSessionStatus` then narrows `idle` to files with no activity in the last 5 minutes.

2. **State inference:** Last message role + tool call presence determines whether Claude is working or waiting for input. File mtime provides the recency check. These two signals combine to cover the three states.

3. **GSD progress reading:** Uses session's `cwd` field (already parsed by `parseSessionFile`). Reads `.planning/STATE.md` first (small, targeted), then `.planning/ROADMAP.md` if phase detail is needed. Both are read synchronously (small text files, typically under 100 lines).

4. **Token count for active session:** Derived from tail-read messages only — shows tokens consumed in the recent portion, not total session tokens. This is intentional: it reflects "what's happening now" not historical totals. Full session total is available via the existing sessions list.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 active sessions | Current design — file scan + tail-read per file is trivially fast |
| 10-50 active sessions | Still fine — tail-reads are bounded (8KB each), scan is a directory listing |
| 50+ active sessions | The 10-minute mtime cutoff filter keeps the work set small regardless of total session count |

### Scaling Priorities

1. **First bottleneck:** Directory scan across many projects with many JSONL files each. Mitigated by the mtime cutoff — most files are old and filtered in the stat step before any file reading occurs.
2. **Second bottleneck:** GSD progress reading for many concurrent sessions. Mitigated by the optional/degradable pattern — if the read takes too long, it can be skipped. In practice, `.planning/STATE.md` is under 100 lines.

## Anti-Patterns

### Anti-Pattern 1: Full JSONL Re-parse for Active Sessions

**What people do:** Reuse `parseSessionFile()` to get session status, then poll every 5 seconds.

**Why it's wrong:** `parseSessionFile()` reads the entire JSONL file front-to-back. A session with 100 turns is hundreds of KB. At 5-second intervals across multiple active sessions, this creates measurable I/O spikes and response latency. The existing supplemental stats mechanism already has a 30-second TTL to protect against this — active sessions at 5-second polling has even lower tolerance.

**Do this instead:** `tailReadJsonl()` with byte-seek to read only the last 8-20 lines. Status inference needs only the last few messages.

### Anti-Pattern 2: WebSocket or SSE for 5-Second Updates

**What people do:** Implement Server-Sent Events or WebSocket connection for "real-time" push updates.

**Why it's wrong:** SSE/WebSocket adds persistent connection management, requires different Next.js route handling (streaming response), and complicates the architecture significantly. At a 5-second update interval, polling and push have identical perceived responsiveness. SWR polling is already used in the sidebar (`refreshInterval: 5000` on `/api/data-source`), making this pattern established and consistent.

**Do this instead:** SWR `refreshInterval: 5000` on the `/api/active-sessions` endpoint. Same pattern as the sidebar's data-source polling.

### Anti-Pattern 3: Mixing Active Session State into Existing Routes

**What people do:** Add `?active=true` param to `/api/sessions` or modify `/api/stats` to return active sessions.

**Why it's wrong:** The existing routes do full JSONL scans with aggregate stats. Mixing active-detection concerns (mtime, tail-read, status inference, GSD) into them makes both harder to understand and creates coupling between very different read strategies and data shapes. Active sessions have a fundamentally different freshness profile (5-second polling) from historical sessions (on-demand or focus-revalidation).

**Do this instead:** Dedicated `/api/active-sessions` route with its own reader function. Clean separation mirrors how `/api/stats`, `/api/sessions`, and `/api/projects` are already separate despite all reading the same JSONL files.

### Anti-Pattern 4: Eagerly Reading GSD Files for All Sessions

**What people do:** Read `.planning/STATE.md` for every session in the response, even sessions that have been idle for 9 minutes.

**Why it's wrong:** Most sessions in the 10-minute window will be idle (no activity in 5 minutes). GSD file reads are synchronous and unnecessary for idle sessions.

**Do this instead:** Only attempt GSD progress reading for sessions where `status !== 'idle'`. Avoids filesystem reads for sessions the user likely doesn't care about in real-time.

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `getActiveSessions()` → existing `getClaudeDir()` | Direct function call | Reuses the live/imported data-source abstraction — active sessions respect the data-source toggle |
| `getActiveSessions()` → `extractCwdFromSession()` | Reuse existing helper | The cwd is needed to locate `.planning/`. Already extracted by the existing function |
| `/active` page → `useActiveSessions()` hook | SWR | New hook in `hooks.ts`, follows identical pattern to `useStats()`, `useSessions()` |
| `ActiveSessionCard` → formatting utilities | `src/lib/format.ts` | Reuse `formatTokens()`, `formatCost()`, `timeAgo()`, `formatDuration()` — no new formatters needed |
| Sidebar → `/active` route | Next.js `<Link>` | Add nav item to `navItems` array — follows existing pattern exactly |

### New Type: `ActiveSessionInfo`

```typescript
// Proposed addition to src/lib/claude-data/types.ts
export type SessionStatus = 'working' | 'waiting' | 'idle';

export interface GsdProgress {
  currentPhase: string;      // e.g., "Phase 2: Active Sessions"
  planStatus: string;        // e.g., "In progress"
  progressPercent: number;   // parsed from "Progress: [████░░░░░░] 40%"
  nextAction?: string;       // optional, from "Stopped at:" in STATE.md
}

export interface ActiveSessionInfo {
  id: string;
  projectId: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  status: SessionStatus;
  fileMtime: string;          // ISO string — when file was last modified
  durationMs: number;         // time since session start (from first JSONL timestamp)
  recentTokens: number;       // tokens from tail-read messages only
  recentCost: number;         // cost from tail-read messages only
  lastActivity: string;       // ISO string of last message timestamp in tail
  gsdProgress: GsdProgress | null;  // null if not a GSD project
}
```

## Build Order Implications

The dependency chain is strictly bottom-up:

1. **Types first** — `ActiveSessionInfo`, `SessionStatus`, `GsdProgress` in `types.ts`. Everything else depends on these shapes.

2. **Reader functions second** — `tailReadJsonl()`, `inferSessionStatus()`, `readGsdProgress()`, `getActiveSessions()` in `reader.ts`. These are pure filesystem logic with no UI dependencies.

3. **API route third** — `/api/active-sessions/route.ts` requires `getActiveSessions()` to exist.

4. **SWR hook fourth** — `useActiveSessions()` in `hooks.ts` requires the API route to be callable.

5. **UI components fifth** — `ActiveSessionCard` requires the hook and the type shapes.

6. **Page last** — `/active/page.tsx` requires the card component and the hook.

7. **Sidebar update last** — can be done at any point after the page exists, but nav items are low-risk last-step changes.

No phase requires waiting for another's completion except in this strict order. Each layer is independently testable before the next is built.

## Sources

- Codebase direct analysis: `src/lib/claude-data/reader.ts` (tail-read pattern already used in `extractCwdFromSession()`)
- Codebase direct analysis: `src/components/layout/sidebar.tsx` (5-second SWR polling pattern already in use)
- Codebase direct analysis: `src/lib/hooks.ts` (SWR hook pattern)
- Codebase direct analysis: `src/lib/claude-data/types.ts` (type extension points)
- PROJECT.md requirements: Session status definitions and GSD progress reading spec
- GSD template analysis: `STATE.md` and `ROADMAP.md` format for progress parsing

---
*Architecture research for: Claud-ometer — Active Session Monitoring*
*Researched: 2026-03-18*
