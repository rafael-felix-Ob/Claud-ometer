# Phase 1: Detection Engine - Research

**Researched:** 2026-03-18
**Domain:** Node.js filesystem polling, JSONL tail-reading, session status inference
**Confidence:** HIGH — all findings verified against codebase source and prior research

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Activity Thresholds** — all are configurable constants (not UI settings), defined in a single config object at the top of the new module.

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `ACTIVE_WINDOW_MS` | 30 minutes | How recently a JSONL file must be modified to appear on /active page |
| `IDLE_CUTOFF_MS` | 5 minutes | How long without file modification before status becomes "idle" |
| `WORKING_SIGNAL_MS` | 10 seconds | How recently file must be modified to signal "working" (accounts for WSL 1-2s mtime granularity) |

**Token Counting Strategy** — Full session totals, not tail-read estimates.
1. On first detection (session enters active window), parse entire JSONL file to get full token totals
2. On subsequent polls (5-second refresh), only tail-read for status inference
3. Cache the full token count per session and increment from new messages found in tail-read
4. Show estimated USD cost alongside tokens (reuses existing `calculateCost()` from `src/config/pricing.ts`)

**Status Inference Algorithm** — Three-state model (working / waiting / idle) based on mtime + last relevant message type.

Algorithm (in priority order):
1. If file not modified within `ACTIVE_WINDOW_MS` → session not active (exclude from results)
2. If file not modified within `IDLE_CUTOFF_MS` → status = **idle**
3. If file modified within `IDLE_CUTOFF_MS`, check mtime recency:
   - If file modified within `WORKING_SIGNAL_MS` → status = **working**
4. If file modified between `WORKING_SIGNAL_MS` and `IDLE_CUTOFF_MS`, read last messages:
   - `progress` type → **working**
   - `assistant` with tool calls → **working**
   - `compactMetadata` or `microcompactMetadata` → **working**
   - `assistant` without tool calls → **waiting**
   - `user` type → **working**

"Relevant" message types: `user`, `assistant`, `progress`, and compaction events.
Ignored for status: `system`, `file-history-snapshot`.

Edge case — incomplete last line: If the last line of the JSONL fails to parse → status = **working**

**Duration Calculation** — Show current activity block duration, not total session lifetime.
- Find most recent contiguous block of messages (gap < `ACTIVE_WINDOW_MS` between consecutive messages)
- Duration = `now - firstTimestampOfCurrentBlock`

**Data Structure** — New `ActiveSessionInfo` type returned by the detection engine.
Fields: `id`, `projectId`, `projectName`, `projectPath`, `status`, `duration`, `totalInputTokens`, `totalOutputTokens`, `estimatedCost`, `model`, `models`, `gitBranch`, `lastActivity`, `cwd`

**Code Location**:
- New file: `src/lib/claude-data/active-sessions.ts`
- New types: Add `ActiveSessionInfo` and `SessionStatus` to `src/lib/claude-data/types.ts`
- New constants: Thresholds at top of `active-sessions.ts` as exported config object

### Claude's Discretion

None specified for Phase 1 — all algorithmic decisions are locked.

### Deferred Ideas (OUT OF SCOPE)

- Token velocity indicator (tokens/minute) — requires tracking previous poll state. Deferred to v2.
- Process-level detection (ps aux) — decided against in PROJECT.md.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DETECT-01 | System detects active sessions by scanning JSONL files modified within the last 10 minutes | `fs.statSync().mtimeMs` scan pattern — verified in reader.ts `getRecentSessionFiles()` and `extractCwdFromSession()` |
| DETECT-02 | System infers session status as "working" when last message is assistant with tool calls or file was modified within last 10 seconds | `inferSessionStatus()` pure function + `WORKING_SIGNAL_MS` threshold |
| DETECT-03 | System infers session status as "waiting" when last message is assistant text without pending tool calls | `inferSessionStatus()` — last message is `assistant` type without `tool_use` content blocks |
| DETECT-04 | System infers session status as "idle" when no file modification in the last 5 minutes but session was recently active | `IDLE_CUTOFF_MS` threshold applied before message inspection |
| DETECT-05 | System uses tail-read (last 16KB) of JSONL files instead of full re-parse for performance | `tailReadJsonl()` using `fs.openSync` + `fs.readSync` with byte-offset — same pattern as `extractCwdFromSession()` already in codebase |
| DETECT-06 | System treats incomplete last-line parse as "working" (write in progress) | In `tailReadJsonl()`: if last non-empty line fails `JSON.parse()`, set `hasIncompleteWrite = true` and return `working` from status inferrer |
</phase_requirements>

---

## Summary

Phase 1 implements a pure filesystem-polling detection engine: a new module `active-sessions.ts` that scans `~/.claude/projects/` for recently-modified JSONL files, tail-reads them for status signals, and returns `ActiveSessionInfo[]`. This module is standalone — no API route, no UI, no SWR hook. It is the data layer only; those consumers are built in Phase 2.

The core technical challenge is **performance on a 5-second poll cadence**: the existing `parseSessionFile()` reads entire JSONL files and must never be called here. Instead, a two-pass approach is used: `fs.statSync().mtimeMs` to filter to only recently-modified files (typically 0-5), then a 16KB tail-read via byte-offset seek for status inference. This pattern is already established in the codebase (`extractCwdFromSession` reads the first 8KB using the same `fd/buffer/readSync` method).

The token counting strategy is the one area with non-trivial state: on first detection, a full JSONL parse captures accurate totals; on subsequent polls, a per-session in-memory cache accumulates from tail-read messages. This requires a module-level cache keyed by session ID with the total counts carried forward — the same caching pattern used by `supplementalCache` in `reader.ts`.

**Primary recommendation:** Build `active-sessions.ts` as three pure, independently-testable functions — `scanActiveFiles()`, `tailReadJsonl()`, `inferSessionStatus()` — composed by a top-level `getActiveSessions()`. Export the threshold config object for future adjustment without code changes.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` (built-in) | built-in | `statSync`, `openSync`, `readSync`, `readdirSync` | Already used throughout `reader.ts`. Zero new dependencies. `mtimeMs` is the cheapest possible activity detection. |
| TypeScript | ^5 (installed) | Strict types for `ActiveSessionInfo`, `SessionStatus` | Project-wide — all code is TypeScript. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `calculateCost()` from `src/config/pricing.ts` | internal | Convert token counts to USD cost | Called once per full-parse (first detection) and once per new tail-read message. Already the project standard. |
| `getClaudeDir()` / `getProjectsDir()` from `reader.ts` | internal | Resolve live vs. imported data source | Must call these — they respect the data-source toggle. Do not hardcode `~/.claude`. |
| `projectIdToName()` / `projectIdToFullPath()` from `reader.ts` | internal | Decode project ID to human-readable name | Reuse exactly — no new decoding logic. |
| `extractCwdFromSession()` from `reader.ts` | internal | Get `cwd` from first 8KB of JSONL | Reuse for `cwd` extraction; its implementation is the reference for the tail-read buffer pattern. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fs.statSync().mtimeMs` per file | `fs.watch()` / `fs.watchFile()` | `fs.watch` requires persistent watcher singleton with lifecycle management — incompatible with stateless `force-dynamic` routes. `statSync` per poll is simpler and sufficient. |
| Custom `tailReadJsonl()` (20 lines) | `read-last-lines` npm package | Package is 5 years unmaintained; codebase already has the pattern. No new dependency warranted. |
| Module-level cache (`Map` + TTL) | Next.js `use cache` directive | `use cache` is experimental in Next.js 15+/16. Module-scope `Map` with TTL is proven — already used as `supplementalCache` in `reader.ts`. |

**Installation:** No new packages required. All capabilities exist in the current stack.

---

## Architecture Patterns

### Recommended File Structure

```
src/lib/claude-data/
├── active-sessions.ts    # NEW — detection engine (all Phase 1 logic)
├── reader.ts             # EXISTING — unchanged (full-parse functions stay here)
├── types.ts              # EXTEND — add ActiveSessionInfo, SessionStatus
└── data-source.ts        # EXISTING — unchanged (getClaudeDir used from here via reader.ts)
```

The detection engine lives in its own file to prevent performance contamination: `reader.ts` functions do expensive full parses; `active-sessions.ts` must never import or call them. The separation makes this boundary enforceable at import time.

### Pattern 1: Config Object at Module Top

**What:** Export all thresholds as a single const object from `active-sessions.ts`.
**When to use:** Every threshold comparison in the file.

```typescript
// Source: .planning/01-CONTEXT.md — Locked Decisions
export const ACTIVE_SESSION_CONFIG = {
  ACTIVE_WINDOW_MS: 30 * 60 * 1000,   // 30 minutes
  IDLE_CUTOFF_MS:    5 * 60 * 1000,   //  5 minutes
  WORKING_SIGNAL_MS:      10 * 1000,  // 10 seconds
  TAIL_READ_BYTES:         16 * 1024, // 16 KB
  CACHE_TTL_MS:             4 * 1000, //  4 seconds (under 5s poll)
} as const;
```

### Pattern 2: Tail-Read via Byte-Offset Seek

**What:** Read the last N bytes of a JSONL file using `fs.openSync` + `fs.readSync` with a calculated byte offset. Parse complete lines from the buffer. Return lines as `SessionMessage[]`.
**When to use:** Every status-inference poll. Never use `readline`/`createReadStream` for active-session polling.

```typescript
// Source: Pattern established in reader.ts:69-85 (extractCwdFromSession)
function tailReadJsonl(filePath: string, maxBytes = ACTIVE_SESSION_CONFIG.TAIL_READ_BYTES): {
  messages: SessionMessage[];
  hasIncompleteWrite: boolean;
} {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(readSize);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
  fs.closeSync(fd);

  const text = buffer.toString('utf-8');
  const lines = text.split('\n');

  // First line may be a partial cut from byte-seek — always skip it
  // unless the file is smaller than our read window (no partial cut)
  const startIdx = stat.size > maxBytes ? 1 : 0;
  const candidateLines = lines.slice(startIdx).filter(l => l.trim());

  const messages: SessionMessage[] = [];
  let hasIncompleteWrite = false;

  for (let i = 0; i < candidateLines.length; i++) {
    try {
      messages.push(JSON.parse(candidateLines[i]) as SessionMessage);
    } catch {
      // If it's the LAST non-empty line, this is an active write-in-progress
      if (i === candidateLines.length - 1) {
        hasIncompleteWrite = true;
      }
      // Interior malformed lines: skip (same as existing forEachJsonlLine behavior)
    }
  }

  return { messages, hasIncompleteWrite };
}
```

### Pattern 3: Status Inference as Pure Function

**What:** Stateless function from `(messages, fileMtimeMs, hasIncompleteWrite)` to `SessionStatus`. No I/O. Fully testable.
**When to use:** Called after every tail-read.

```typescript
// Source: .planning/01-CONTEXT.md — Status Inference Algorithm
function inferSessionStatus(
  messages: SessionMessage[],
  fileMtimeMs: number,
  hasIncompleteWrite: boolean
): SessionStatus {
  const ageMs = Date.now() - fileMtimeMs;

  if (ageMs > ACTIVE_SESSION_CONFIG.IDLE_CUTOFF_MS) return 'idle';
  if (ageMs <= ACTIVE_SESSION_CONFIG.WORKING_SIGNAL_MS) return 'working';
  if (hasIncompleteWrite) return 'working';

  // Find last relevant message (skip system and file-history-snapshot)
  const IGNORED_TYPES = new Set(['system', 'file-history-snapshot']);
  let last: SessionMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!IGNORED_TYPES.has(messages[i].type)) {
      last = messages[i];
      break;
    }
  }

  if (!last) return 'idle';

  if (last.compactMetadata || last.microcompactMetadata) return 'working';
  if (last.type === 'progress') return 'working';
  if (last.type === 'user') return 'working';

  if (last.type === 'assistant') {
    const content = last.message?.content;
    const hasToolCalls = Array.isArray(content) &&
      content.some(c => c && typeof c === 'object' && 'type' in c && c.type === 'tool_use');
    return hasToolCalls ? 'working' : 'waiting';
  }

  return 'idle';
}
```

### Pattern 4: Per-Session Token Cache

**What:** Module-level `Map<sessionId, TokenCache>` where `TokenCache` holds full session totals plus the JSONL byte offset of the last processed message. On first detection, full-parse to populate; on subsequent polls, tail-read appends only new messages' tokens.
**When to use:** Every call to `getActiveSessions()`.

```typescript
interface TokenCache {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCost: number;
  lastParsedSize: number;   // file size after last full-parse
  lastModel: string;
  models: Set<string>;
}

const tokenCacheMap = new Map<string, TokenCache>();
```

Key constraint: when a session exits the active window (not seen in current scan), remove it from the cache to prevent unbounded memory growth.

### Pattern 5: Duration from Current Contiguous Block

**What:** Walk message timestamps in the full-parsed messages (available on first detection) to find the start of the most recent contiguous block (consecutive messages with gaps < `ACTIVE_WINDOW_MS`).
**When to use:** Computed once during full-parse on first detection; stored in the cache.

```typescript
function findCurrentBlockStart(messages: SessionMessage[]): string {
  // Walk backward from last message, finding first gap > ACTIVE_WINDOW_MS
  for (let i = messages.length - 1; i > 0; i--) {
    const curr = new Date(messages[i].timestamp).getTime();
    const prev = new Date(messages[i - 1].timestamp).getTime();
    if (curr - prev > ACTIVE_SESSION_CONFIG.ACTIVE_WINDOW_MS) {
      return messages[i].timestamp;
    }
  }
  return messages[0]?.timestamp ?? new Date().toISOString();
}
```

### Anti-Patterns to Avoid

- **Calling `parseSessionFile()` or `forEachJsonlLine()` from `active-sessions.ts`:** These are in `reader.ts` and do full-file reads. Active sessions module must only call full-parse internally for first-detection token initialization, implemented with its own `readline`-based loop — not by importing from `reader.ts`.
- **Using `createReadStream`/`readline` for status polling:** Non-deterministic with active writes. Use `fd/buffer/readSync` only.
- **Hard-coding thresholds inline:** All threshold comparisons must reference `ACTIVE_SESSION_CONFIG.*` — never magic numbers.
- **Not clearing stale entries from `tokenCacheMap`:** Sessions not seen in the current scan must be evicted from the cache map to prevent memory leak.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Project ID → path decoding | Custom decode logic | `projectIdToName()`, `projectIdToFullPath()` in `reader.ts` | Already correct and handles edge cases (leading slash, hyphens) |
| Token cost calculation | Custom pricing math | `calculateCost()` in `src/config/pricing.ts` | Already handles all model variants with fallback pricing |
| Live vs. imported data source | Custom path resolution | `getClaudeDir()` / `getProjectsDir()` in `reader.ts` | These implement the data-source toggle — bypassing them breaks import mode |
| `cwd` extraction from session | Custom first-line parser | `extractCwdFromSession()` in `reader.ts` | Already handles partial first-line edge case |

**Key insight:** `active-sessions.ts` is a consumer of the existing library — it should call existing helpers for all concerns except status inference and tail-reading, which are net-new and unique to this module.

---

## Common Pitfalls

### Pitfall 1: Partial Last Line Treated as Missing (DETECT-06)

**What goes wrong:** The last line of an actively-written JSONL fails `JSON.parse()` because Claude Code is mid-write. If silently dropped (existing `forEachJsonlLine` behavior), the status inferrer reads the wrong last message and returns `waiting` instead of `working`.

**Why it happens:** The existing `forEachJsonlLine` swallows all parse errors. That was safe for historical reads but is wrong for tail reads where the last line carries live signal.

**How to avoid:** In `tailReadJsonl()`, track whether the parse failure was on the last non-empty line. If yes, set `hasIncompleteWrite = true` and pass it to `inferSessionStatus()` which returns `working` immediately.

**Warning signs:** Sessions oscillate between `working` and `waiting` every 5 seconds during active multi-tool tasks.

### Pitfall 2: First Partial Line from Byte Seek

**What goes wrong:** When reading the last 16KB of a file larger than 16KB, the first line in the buffer is a partial cut. Parsing it throws and poisons the result array.

**Why it happens:** Byte-offset seek lands mid-line when the file is larger than the read window.

**How to avoid:** Always skip `lines[0]` (startIdx = 1) when `stat.size > maxBytes`. The second line onward is guaranteed to start at a line boundary.

### Pitfall 3: WSL mtime Precision (Blocker Risk)

**What goes wrong:** On Windows/WSL with NTFS-hosted files, `fs.statSync().mtimeMs` has 1-2 second granularity. `WORKING_SIGNAL_MS` of 10 seconds is set deliberately above this — but if code uses a smaller threshold, active sessions may never be detected as "working".

**Why it happens:** NTFS timestamps have 100ns resolution but Windows filesystem driver exposes 1-2s granularity to WSL. Noted in `STATE.md` Blockers/Concerns.

**How to avoid:** Never use thresholds below 10 seconds. `WORKING_SIGNAL_MS = 10 * 1000` is the minimum safe value. Document in code comments.

**Warning signs:** All sessions show `idle` or `waiting` even when Claude Code is visibly running on Windows/WSL.

### Pitfall 4: Full-Parse Called Every 5 Seconds

**What goes wrong:** CPU spikes to 40-80% every 5 seconds; other dashboard pages become unresponsive.

**Why it happens:** It is tempting to call `parseSessionFile()` (which exists and is correct) for accurate token totals. This reads the entire JSONL on every poll.

**How to avoid:** Full-parse only once per session (first detection). Cache result in `tokenCacheMap`. Subsequent polls use tail-read only.

### Pitfall 5: Resumed Historical Sessions Show Inflated Duration

**What goes wrong:** A session created yesterday and resumed today shows "18h duration" instead of "15m".

**Why it happens:** Duration computed as `lastTimestamp - firstTimestamp` includes the overnight gap.

**How to avoid:** Use `findCurrentBlockStart()` — walk timestamps backward to find the start of the current contiguous activity block. Duration = `Date.now() - new Date(blockStart).getTime()`.

### Pitfall 6: Stale Token Cache for Completed Sessions

**What goes wrong:** `tokenCacheMap` grows without bound if sessions are never evicted. Over days, this leaks memory.

**Why it happens:** Sessions exit the active window without triggering cleanup.

**How to avoid:** At the start of each `getActiveSessions()` call, collect the set of currently-detected session IDs. After building results, evict any `tokenCacheMap` key not in that set.

---

## Code Examples

Verified patterns from codebase source:

### Existing Tail-Read Pattern (extractCwdFromSession — reader.ts:69-85)

```typescript
// Source: src/lib/claude-data/reader.ts lines 69-85
function extractCwdFromSession(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8192); // Read first 8KB
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
    fs.closeSync(fd);
    const text = buffer.toString('utf-8', 0, bytesRead);
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.cwd) return msg.cwd;
      } catch { /* skip partial line */ }
    }
  } catch { /* skip */ }
  return null;
}
```

The tail-read in `active-sessions.ts` mirrors this exactly, but reads from `stat.size - readSize` instead of position `0`.

### Existing Module-Level Cache Pattern (reader.ts:472-499)

```typescript
// Source: src/lib/claude-data/reader.ts lines 472-499
let supplementalCache: { key: string; data: SupplementalStats; ts: number } | null = null;
const SUPPLEMENTAL_TTL_MS = 30_000;

async function computeSupplementalStats(afterDate: string): Promise<SupplementalStats> {
  const cacheKey = afterDate + ':' + getActiveDataSource();
  if (supplementalCache && supplementalCache.key === cacheKey &&
      Date.now() - supplementalCache.ts < SUPPLEMENTAL_TTL_MS) {
    return supplementalCache.data;
  }
  // ... compute ...
  supplementalCache = { key: cacheKey, data: result, ts: Date.now() };
  return result;
}
```

The `tokenCacheMap` in `active-sessions.ts` follows the same pattern, using `sessionId` as key.

### Existing mtime-Based File Filter (reader.ts:475-495)

```typescript
// Source: src/lib/claude-data/reader.ts lines 475-495
function getRecentSessionFiles(afterDate: string): string[] {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];
  const cutoff = afterDate ? new Date(afterDate + 'T23:59:59Z').getTime() : 0;
  const files: string[] = [];
  for (const entry of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, entry);
    if (!fs.statSync(projectPath).isDirectory()) continue;
    for (const f of fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))) {
      const filePath = path.join(projectPath, f);
      if (fs.statSync(filePath).mtimeMs > cutoff) {
        files.push(filePath);
      }
    }
  }
  return files;
}
```

`scanActiveFiles()` in `active-sessions.ts` replicates this structure with `ACTIVE_WINDOW_MS` as the cutoff, returning `{ filePath, projectId, mtimeMs }[]`.

### New Types to Add (types.ts)

```typescript
// Add to src/lib/claude-data/types.ts

export type SessionStatus = 'working' | 'waiting' | 'idle';

export interface ActiveSessionInfo {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  cwd: string;
  gitBranch: string;
  status: SessionStatus;
  duration: number;           // ms — current contiguous activity block
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCost: number;
  model: string;              // last used model
  models: string[];           // all models in session
  lastActivity: string;       // ISO — file mtime
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `readline`/`createReadStream` for all JSONL reads | Byte-offset `fd/readSync` for tail-reads | Established in codebase (extractCwdFromSession) | 10-20x faster for large sessions; deterministic with concurrent writes |
| Hard-coded polling thresholds | Exported config object | Phase 1 design decision | User-adjustable without code changes |
| Duration = `lastTimestamp - firstTimestamp` | Duration = length of current contiguous block | Phase 1 design decision | Correct for resumed historical sessions |

**Deprecated/outdated in this context:**
- `parseSessionFile()` for active session data: never call from `active-sessions.ts` — this is the "full parse" function that must remain out of the polling path.
- `forEachJsonlLine()` for status polling: readline streaming is non-deterministic with active writes; replaced by synchronous `fd/readSync`.

---

## Open Questions

1. **Token count on subsequent polls — how to detect new messages in tail-read?**
   - What we know: The tail-read returns the last 20-ish messages. On each poll, some of those may be new.
   - What's unclear: How to know which tail-read messages were already counted in the previous poll without tracking per-message UUIDs.
   - Recommendation: Track `lastParsedSize` (file size after last full parse) in the token cache. On each poll: if `current_stat.size > lastParsedSize`, calculate the difference. A simpler alternative: re-sum tokens from only tail-read messages and label them as "recent session tokens" — acceptable since the locked decision says to increment from tail-read. The planner should clarify this accumulation mechanism in Wave 1.

2. **Full-parse on first detection — concurrency with active write?**
   - What we know: The first full parse uses `readline`/`createReadStream` which can race with an active write. This is only run once per session per active window — not on every poll.
   - What's unclear: Whether a concurrent write during first-parse causes materially wrong token counts.
   - Recommendation: Accept minor under-count risk for first-parse (the next poll will catch remaining tokens via tail-read). Document in code comments. This is a one-time inaccuracy, not a recurring problem.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None currently installed — see Wave 0 gaps |
| Config file | `jest.config.js` — Wave 0 creates this |
| Quick run command | `npm test -- --testPathPattern=active-sessions` |
| Full suite command | `npm test` |

Per `.planning/codebase/TESTING.md`: no test framework is configured. The codebase uses manual testing only. Wave 0 must install Jest + ts-jest before any tests can run.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DETECT-01 | Files modified within ACTIVE_WINDOW_MS are included; older files are excluded | unit | `npm test -- --testPathPattern=active-sessions -t "scanActiveFiles"` | Wave 0 |
| DETECT-02 | `inferSessionStatus` returns `working` for assistant+tool_calls or file age < WORKING_SIGNAL_MS | unit | `npm test -- --testPathPattern=active-sessions -t "inferSessionStatus working"` | Wave 0 |
| DETECT-03 | `inferSessionStatus` returns `waiting` for assistant without tool_calls, age between signals | unit | `npm test -- --testPathPattern=active-sessions -t "inferSessionStatus waiting"` | Wave 0 |
| DETECT-04 | `inferSessionStatus` returns `idle` when file age > IDLE_CUTOFF_MS | unit | `npm test -- --testPathPattern=active-sessions -t "inferSessionStatus idle"` | Wave 0 |
| DETECT-05 | `tailReadJsonl` does not open full file — only reads last 16KB | unit | `npm test -- --testPathPattern=active-sessions -t "tailReadJsonl byte limit"` | Wave 0 |
| DETECT-06 | `tailReadJsonl` sets `hasIncompleteWrite=true` when last line is malformed JSON | unit | `npm test -- --testPathPattern=active-sessions -t "tailReadJsonl incomplete"` | Wave 0 |

All tests are pure unit tests against `inferSessionStatus` and `tailReadJsonl`. No filesystem mocking needed for status inference tests (pure function). `tailReadJsonl` tests use temp files created with `fs.writeFileSync` in `beforeEach`.

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern=active-sessions`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/__tests__/lib/active-sessions.test.ts` — covers all DETECT-XX requirements
- [ ] `jest.config.js` — project root, with `ts-jest` preset and `@/` path alias
- [ ] `src/__tests__/setup.ts` — `@testing-library/jest-dom` setup (for future component tests)
- [ ] Framework install: `npm install --save-dev jest @types/jest ts-jest jest-environment-jsdom`
- [ ] Add `"test": "jest"` to `package.json` scripts

---

## Sources

### Primary (HIGH confidence)

- `src/lib/claude-data/reader.ts` (full file) — `extractCwdFromSession` tail-read pattern, `supplementalCache` TTL pattern, `getRecentSessionFiles` mtime filter pattern, `forEachJsonlLine` full-parse pattern
- `src/lib/claude-data/types.ts` (full file) — `SessionMessage` type with all message shapes including compaction metadata
- `src/config/pricing.ts` (full file) — `calculateCost()` signature and `MODEL_PRICING` entries
- `src/lib/claude-data/data-source.ts` (full file) — `getActiveDataSource()`, `getClaudeDir()` implementation
- `.planning/01-CONTEXT.md` — all locked design decisions (thresholds, algorithm, data structure, code location)
- `.planning/REQUIREMENTS.md` — DETECT-01 through DETECT-06 definitions
- `.planning/research/PITFALLS.md` — verified pitfall catalog for this exact domain
- `.planning/research/ARCHITECTURE.md` — component map, data flow, type proposals
- `.planning/research/STACK.md` — stack choices and justification
- `.planning/codebase/TESTING.md` — test framework gap analysis

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — WSL mtime precision concern (noted, verified against Windows NTFS behavior)
- Node.js `fs` documentation patterns — `openSync`/`readSync`/`closeSync` with byte positions; consistent with codebase usage

### Tertiary (LOW confidence)

None. All findings verified against codebase source.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; patterns verified against existing `reader.ts`
- Architecture: HIGH — directly derived from locked CONTEXT.md decisions and existing codebase conventions
- Status inference algorithm: HIGH — verbatim from CONTEXT.md locked decision
- Tail-read pattern: HIGH — directly mirrors `extractCwdFromSession()` in `reader.ts`
- Token cache design: MEDIUM — approach is clear but accumulation mechanism has an open question (Q1 above)
- Validation architecture: MEDIUM — test framework must be installed from scratch (Wave 0 gap)

**Research date:** 2026-03-18
**Valid until:** 2026-04-17 (stable stack, no fast-moving dependencies)
