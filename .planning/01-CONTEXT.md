# Phase 1 Context: Detection Engine

**Phase goal:** The system can accurately detect which Claude Code sessions are currently active and infer their status from filesystem data alone.

**Created:** 2026-03-18

## Activity Thresholds

**Decision:** All thresholds are configurable constants (not UI settings), defined in a single config object.

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `ACTIVE_WINDOW_MS` | 30 minutes | How recently a JSONL file must be modified to appear on /active page |
| `IDLE_CUTOFF_MS` | 5 minutes | How long without file modification before status becomes "idle" |
| `WORKING_SIGNAL_MS` | 10 seconds | How recently file must be modified to signal "working" (accounts for WSL 1-2s mtime granularity) |

**Rationale:**
- 30-minute active window is generous — keeps sessions visible even during long Claude thinking pauses. Accepts some ghost cards after shutdown (no "goodbye" message in JSONL to detect closure).
- 5-minute idle cutoff accounts for Claude's 60-120s thinking gaps with safety margin.
- 10 seconds for working signal is safe even on WSL with low mtime precision.
- User wants to be able to adjust these later without code changes — extract to a constants file or top-of-module config object.

## Token Counting Strategy

**Decision:** Full session totals, not tail-read estimates.

**Approach:**
1. On first detection (session enters active window), parse entire JSONL file to get full token totals
2. On subsequent polls (5-second refresh), only tail-read for status inference
3. Cache the full token count per session and increment from new messages found in tail-read
4. Show estimated USD cost alongside tokens (reuses existing `calculateCost()` from `src/config/pricing.ts`)

**Rationale:** User wants accurate totals, not estimates. The cost of one full parse per session on first detection is acceptable — it's the repeated full parses every 5 seconds that would be expensive.

## Status Inference Algorithm

**Decision:** Three-state model (working / waiting / idle) based on mtime + last relevant message type.

**Algorithm (in priority order):**

1. **Check file mtime:**
   - If file not modified within `ACTIVE_WINDOW_MS` → session not active (exclude from results)
   - If file not modified within `IDLE_CUTOFF_MS` → status = **idle**

2. **If file modified within `IDLE_CUTOFF_MS`, check mtime recency:**
   - If file modified within `WORKING_SIGNAL_MS` → status = **working** (actively writing output)

3. **If file modified between `WORKING_SIGNAL_MS` and `IDLE_CUTOFF_MS`, read last messages:**
   - Last relevant message is `progress` → **working** (tool execution in progress)
   - Last relevant message is `assistant` with tool calls → **working**
   - Last relevant message has `compactMetadata` or `microcompactMetadata` → **working** (compacting)
   - Last relevant message is `assistant` without tool calls → **waiting** (finished talking, waiting for user)
   - Last relevant message is `user` → **working** (Claude is processing the user's input)

**"Relevant" message types:** `user`, `assistant`, `progress`, and compaction events.
**Ignored for status:** `system`, `file-history-snapshot` — skip past these to find the last relevant message.

**Edge case — incomplete last line:**
- If the last line of the JSONL fails to parse (partial write in progress) → status = **working**
- This is a strong signal that Claude Code is actively writing to the file right now

## Duration Calculation

**Decision:** Show current activity block duration, not total session lifetime.

**Approach:**
- Find the most recent contiguous block of messages (gap < `ACTIVE_WINDOW_MS` between consecutive messages)
- Duration = `now - firstTimestampOfCurrentBlock`
- This handles resumed sessions correctly: a session from yesterday resumed today shows "15 min" not "18 hours"

## Data Structure

**Decision:** New `ActiveSessionInfo` type returned by the detection engine.

**Fields needed by Phase 2 (display) and Phase 3 (GSD):**
- `id` — session ID
- `projectId` — project identifier
- `projectName` — human-readable project name
- `projectPath` — full filesystem path (for Phase 3 to locate .planning/)
- `status` — 'working' | 'waiting' | 'idle'
- `duration` — current activity block duration in ms
- `totalInputTokens` — full session input tokens
- `totalOutputTokens` — full session output tokens
- `estimatedCost` — USD cost
- `model` — last used model name
- `models` — all models used in session
- `gitBranch` — current branch
- `lastActivity` — ISO timestamp of last file modification
- `cwd` — working directory

## Code Context

**Existing patterns to follow:**
- `extractCwdFromSession()` in `reader.ts:69-85` — reads first 8KB of file with `fs.openSync`/`fs.readSync`. Use same pattern for tail-read (seek to end - 16KB).
- `forEachJsonlLine()` in `reader.ts:21-31` — full JSONL parse with readline. Use for initial full-parse, NOT for polling.
- `getClaudeDir()` / `getProjectsDir()` in `reader.ts:33-42` — respects data source toggle. Active sessions detection must also use these.
- `projectIdToName()` / `projectIdToFullPath()` in `reader.ts:59-67` — reuse for project name resolution.
- `SessionMessage` type in `types.ts:65-91` — defines all JSONL message shapes including compaction metadata.
- `calculateCost()` in `pricing.ts` — reuse for cost calculation.

**New code location:**
- New file: `src/lib/claude-data/active-sessions.ts` — keeps detection logic separate from existing `reader.ts` to avoid performance contamination
- New types: Add `ActiveSessionInfo` and `SessionStatus` to `src/lib/claude-data/types.ts`
- New constants: Thresholds at top of `active-sessions.ts` as exported config object

## Deferred Ideas

- Token velocity indicator (tokens/minute) — requires tracking previous poll state. Deferred to v2.
- Process-level detection (ps aux) — decided against in PROJECT.md.

---
*Context gathered: 2026-03-18*
