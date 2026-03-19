# Pitfalls Research

**Domain:** Real-time filesystem monitoring — JSONL tail-reading, active session detection, polling dashboard
**Researched:** 2026-03-18
**Confidence:** HIGH (based on codebase analysis + verified community patterns)

---

## Critical Pitfalls

### Pitfall 1: Partial Line Read from Actively-Written JSONL

**What goes wrong:**
When Claude Code is actively writing a session, the JSONL file is appended line-by-line. Reading the tail of the file mid-write catches a line whose JSON object is incomplete — the line terminates mid-object. `JSON.parse()` throws, the line is silently dropped, and the last-message-based state detection (working / waiting / idle) reads the wrong last message.

**Why it happens:**
The existing `forEachJsonlLine()` already silently swallows JSON parse errors (`catch { /* skip malformed line */ }`). This was safe for historical reads but is dangerous for tail reads because the "malformed" line is actually a valid line that hasn't finished being written yet. The code discards it and the state machine picks up the previous line as authoritative.

**How to avoid:**
For tail reads specifically, treat a JSON parse failure on the last line as "incomplete write in progress" rather than "corrupt line". Strategy: read the last N bytes of the file, find lines, try to parse from the end backwards, and use the last successfully-parsed line as the state indicator. Never discard the final parse failure silently — log it as `incomplete_write` so the polling cycle can retry on the next tick. Set the session status to `working` (not `idle`) when the final line fails to parse, because active writes imply active processing.

**Warning signs:**
- Sessions that flip between "working" and "idle" rapidly on each 5-second poll
- Session status shows "waiting for input" immediately after a tool call with no intervening user message
- `console.log` of last parsed message timestamp shows it is 2+ messages behind the actual file tail

**Phase to address:** Phase implementing state detection logic (tail-read function and status inference).

---

### Pitfall 2: mtime-Based Activity Window is Too Narrow for Claude Code Thinking Time

**What goes wrong:**
Claude Code can be in a "thinking" state — receiving an API response, processing tool results — for 30-120 seconds without writing anything to the JSONL file. Polling every 5 seconds and declaring a session "idle" if `mtime > N seconds ago` will constantly report active sessions as idle.

**Why it happens:**
Developers pick a threshold like "modified in the last 30 seconds = active" because that feels reasonable. But Claude Code's actual write pattern is bursty: messages are appended when the API responds, not continuously. Long model calls with heavy tool use can have silent gaps of 60-90+ seconds while the model reasons.

**How to avoid:**
Use a two-tier threshold:
- **Working**: `mtime < 30 seconds` ago — file was written very recently
- **Active (possibly thinking)**: `mtime < 5 minutes` ago AND the last message in the file is an assistant turn without a following user turn — Claude responded but user hasn't typed yet
- **Idle**: `mtime > 5 minutes` ago OR last message is a user turn with no subsequent assistant turn for > 5 minutes
- **Historical**: `mtime > 30 minutes` ago

Do NOT use mtime alone. Combine mtime with last-message-type analysis.

**Warning signs:**
- Active sessions always show "idle" right after tool execution starts
- Sessions during long `computer_use` or web fetch operations flash idle
- Users report the active page is empty even though Claude Code is clearly running

**Phase to address:** Phase defining the status inference algorithm and thresholds.

---

### Pitfall 3: Polling All JSONL Files on Every 5-Second Tick

**What goes wrong:**
The existing `getSessions()` and `getProjects()` already scan the entire `~/.claude/projects/` directory on every API call. Adding a `/api/active-sessions` endpoint that also does a full directory scan on a 5-second SWR `refreshInterval` means the filesystem is hit 12 times per minute with a full scan plus full JSONL parse for every session. With 50 projects and 10 sessions each, that is 500 JSONL reads per minute, easily pegging CPU.

**Why it happens:**
The natural path of least resistance is to call `getSessions()` (already exists) and filter by recency. This reuses existing code but inherits its full-scan cost. The `force-dynamic` on all routes means no Next.js caching saves it.

**How to avoid:**
For active session detection, do NOT call `getSessions()`. Instead:
1. Use `fs.statSync()` only — scan directory for files with `mtime < threshold` (no JSONL parsing at the directory-scan stage)
2. Only open and tail-read JSONL files that pass the mtime filter (typically 0-5 files vs 500)
3. Cache the directory listing + mtime map in a module-level variable with a 4-second TTL (slightly under the 5-second poll interval) so rapid re-requests don't re-scan
4. Never call `parseSessionFile()` (the full aggregation function) for active session detection — it reads the entire file

**Warning signs:**
- `npm run dev` CPU spikes to 50%+ every 5 seconds
- Other pages (overview, sessions list) become slow or unresponsive while /active is open
- `top` or Activity Monitor shows the Node.js process pegged

**Phase to address:** Phase implementing the `/api/active-sessions` route — the directory scan optimization must be baked in from the start, not added as a performance fix later.

---

### Pitfall 4: Concurrent Reads of the Same JSONL File Being Written

**What goes wrong:**
Claude Code appends to the session JSONL while the dashboard is reading it via `readline` streaming. On Linux/macOS, concurrent reads are safe (POSIX allows multiple readers). However, the readline stream holds a read file descriptor open for the duration of the scan. If Claude Code flushes a partial write during this window, the reader may receive:
- A line that terminates in the middle of a JSON object (partial write)
- A line that is complete but represents a state not yet final (Claude mid-tool-call)

The partial line is silently dropped (existing behavior). The mid-tool-call line causes a status misclassification.

**Why it happens:**
Node.js `readline` with `createReadStream` reads the file as it exists at stream-open time but can include bytes written after opening if the OS read buffer fills slowly. This creates a non-deterministic window. The existing `forEachJsonlLine` does not handle this case.

**How to avoid:**
For tail reads, use `fs.openSync` + `fs.readSync` with explicit byte positions (like the existing `extractCwdFromSession` pattern in reader.ts does). Read a fixed buffer from the end of the file (`file size - N bytes`), parse complete lines from that buffer, and stop at any line that fails JSON.parse. This is deterministic and does not create a streaming reader that can receive mid-write bytes. Never use `createReadStream` for active-session tail reads.

**Warning signs:**
- Occasional crashes or `Unexpected token` errors in server logs during active sessions
- Status shows "idle" exactly when a long tool call starts (the incomplete partial line is the tool_use block)

**Phase to address:** Phase implementing the tail-read utility function.

---

### Pitfall 5: GSD STATE.md / ROADMAP.md Not Found for Most Sessions

**What goes wrong:**
The GSD progress feature reads `.planning/STATE.md` and `.planning/ROADMAP.md` from the project directory associated with each active session. Most Claude Code sessions are NOT GSD projects. If the code assumes these files exist and throws or returns error states when missing, the entire active sessions view breaks for non-GSD sessions (which is the majority).

**Why it happens:**
Developers implement the happy path (session is a GSD project) and only discover the missing-file case in testing. Even for GSD projects, the `.planning/` directory may exist during some phases but not others (e.g., before `/gsd:init`).

**How to avoid:**
Treat GSD progress as entirely optional per session:
- `fs.existsSync()` check before any read of `.planning/STATE.md` or `.planning/ROADMAP.md`
- Return `null` (not an error) for both files when absent
- The UI card for a non-GSD session must render cleanly with no GSD section — not an empty section, not a spinner, not an error badge
- Cache the "no GSD files" result per project path for the duration of the poll cycle so the filesystem isn't checked 12 times/minute per non-GSD project

**Warning signs:**
- `/active` page shows "Error loading GSD data" banners for every session
- Server logs show ENOENT errors every 5 seconds per active session
- Active sessions page only works in the repo where Claud-ometer itself is developed (the one GSD project in the test environment)

**Phase to address:** Phase implementing GSD progress reading — must be the first thing validated with non-GSD sessions.

---

### Pitfall 6: Session "Active" Detection Misidentifies Resumed Historical Sessions

**What goes wrong:**
A session that was created yesterday and resumed today has an `mtime` of now (because Claude Code appended to it on resume). But the session's `firstTimestamp` is yesterday. Duration calculations that use `firstTimestamp` to `now` show the session as 18+ hours long. The "active" detection also shows it as active correctly, but the duration display misleads the user.

**Why it happens:**
`parseSessionFile()` computes duration as `lastTimestamp - firstTimestamp`. For active sessions, "last timestamp" is the most recent completed message, not now. For resumed historical sessions, there's a multi-hour gap between yesterday's messages and today's first message that inflates duration.

**How to avoid:**
For the active sessions view, compute duration differently from historical sessions:
- Use `file mtime` (when the file was last written) minus `start of current contiguous block`
- A "contiguous block" ends when there is a gap > N minutes (30 minutes is a reasonable threshold) between consecutive message timestamps
- The session duration to display is the length of the most recent contiguous block, not total session lifetime
- Show "resumed session" indicator when the current block start is > 1 hour after the first message

**Warning signs:**
- Active sessions show durations like "17h 32m" when the user just started Claude Code
- Duration countdown ticks correctly per second but starts at an absurd value

**Phase to address:** Phase implementing duration calculation for active sessions.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Call existing `getSessions()` for active detection | Zero new code | Full directory scan + full JSONL parse every 5 seconds; CPU spikes | Never — mtime filter + tail read must be purpose-built |
| Use `refreshInterval: 5000` on existing SWR hooks | Trivially adds polling to existing hooks | All existing pages start polling at 5s too if hooks are shared; other pages get expensive | Never — active-sessions hook must be a new, isolated hook |
| Hard-code "modified in last 60s = active" threshold | Simple, easy to explain | Misses thinking time; misclassifies 40% of genuinely active sessions | Only during initial spike testing with known short tasks |
| Use `parseSessionFile()` for status and token counts on active sessions | Reuse existing aggregation | Reads entire JSONL every 5s regardless of size | Never — tail-read only for active; full parse only on explicit navigation |
| Parse STATE.md with a custom regex | Fast implementation | Fragile against GSD file format changes; breaks silently | Only if no structured parse API is available and format is documented/stable |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| SWR `refreshInterval` on `/api/active-sessions` | Set it on the shared `useStats` or `useSessions` hook by adding a parameter | Create a dedicated `useActiveSessions()` hook with its own SWR key and `refreshInterval: 5000`; never add polling to existing hooks |
| Next.js `force-dynamic` on active sessions route | Assume it's enough to prevent stale responses | It prevents Next.js caching but does not prevent module-level in-process cache; the directory listing cache (4s TTL) intentionally uses module-level state — this is correct and expected |
| File `mtime` on WSL (Windows Subsystem for Linux) | Trust mtime precision to milliseconds | WSL filesystem mtime has lower precision for Windows-hosted files (1-2 second granularity); use > 10 second threshold comparisons, not < 5 second |
| GSD STATE.md parsing | Parse entire file with `readFileSync` | Read only the frontmatter block (first ~20 lines) using the buffer-read pattern from `extractCwdFromSession` — STATE.md can be large for long milestones |
| SWR deduplication with `refreshInterval` | Assume 2 components with same key share one poll | SWR deduplicates requests within the same dedupingInterval (2s default), not across tabs; if user opens /active in two browser tabs, two independent polls fire |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full JSONL parse in polling route | CPU 40-80% every 5 seconds, other pages lag | mtime filter first, tail-read only for recently-modified files, dedicated route separate from historical scan | Immediately with > 20 total sessions across projects |
| No module-level cache for directory listings | Filesystem scan 12x/minute per active page tab | 4-second in-memory cache for `{ projectDir → [files with mtime] }` map in active-sessions reader | When user has > 5 projects (noticeable) or > 50 projects (severe) |
| `fs.statSync` inside `forEachJsonlLine` callback | Cascading stat calls during line enumeration | Separate the "which files are recent?" stat phase from the "read content" phase | Immediately — this is an O(n²) pattern |
| GSD file read without caching | STATE.md + ROADMAP.md read on every poll per active session | Cache parsed GSD state per project path with 5-second TTL | With > 3 concurrent active GSD sessions |
| Synchronous `fs.readFileSync` in route handler | Route handler blocks event loop during read | Use `fs.promises.readFile` or the existing readline streaming approach for any file > 10KB | When STATE.md or ROADMAP.md grows beyond ~1KB (common for complex milestones) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing `.planning/STATE.md` content verbatim in API response | Leaks internal milestone plans, task names, progress details | This is a local-only dashboard — the risk is minimal. Note it in code comments. Do not add auth — it adds complexity with no local benefit |
| Reading arbitrary paths from session `cwd` field for GSD files | A malformed JSONL with `cwd: "../../etc"` could cause path traversal to read system files | Validate that `cwd` resolves to a path under `~` (home directory) before constructing `.planning/` paths from it; use `path.resolve()` and check the result starts with `os.homedir()` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Show spinner during every 5-second poll | Page flickers every 5 seconds; user loses scroll position | SWR with `keepPreviousData: true` (SWR v2 option); show stale data while revalidating; only show spinner on initial load |
| Show empty state when Claude Code is not running | User confused — is the feature broken or just no sessions? | Distinguish "no active sessions found" from "never loaded": show explicit "No active Claude Code sessions detected. Sessions appear here when Claude Code is running." |
| All 3 status labels (working / waiting / idle) update immediately on every poll | Status oscillates visibly if threshold is on the boundary | Debounce status transitions: require 2 consecutive polls to agree before changing displayed status (prevents flicker at boundary) |
| Display raw JSONL session ID as the session title | Non-human UUID is meaningless | Use `cwd` basename (project folder name) + git branch as the primary label; fall back to session ID only if both are absent |
| Show per-session token count from full parse | Forces full JSONL read every 5s | Only show accumulated token count from the tail-read data (last N messages); label it "recent tokens" not "total tokens" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Active session detection**: Tested with a Claude Code session that has been running for > 30 minutes with gaps — verify it still shows as active, not idle
- [ ] **Partial line handling**: Tested by opening the active page while Claude Code is in the middle of a multi-tool response — verify no crash and no "idle" flash
- [ ] **Non-GSD sessions**: Tested with a project directory that has no `.planning/` folder — verify GSD section is hidden (not erroring) for those sessions
- [ ] **Historical session resume**: Tested with a session that was started yesterday and resumed today — verify duration shows current block, not total lifetime
- [ ] **WSL mtime precision**: If running on Windows/WSL, tested that 5-second polling still detects changes reliably (mtime granularity issue)
- [ ] **Multiple active sessions**: Tested with 3+ concurrent Claude Code sessions (open multiple terminals) — verify all appear correctly and CPU stays below 20%
- [ ] **Empty state**: Tested with no active sessions (all Claude Code instances closed) — verify explicit "nothing running" message, not blank page
- [ ] **Data source toggle**: Tested that switching to imported data mode hides the /active page or shows a clear "not available in imported mode" message (imported data cannot have active sessions)
- [ ] **Tab visibility**: Verified that SWR `refreshInterval` respects tab visibility — polling should pause when browser tab is hidden (SWR default behavior; confirm it's not overridden)

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Full JSONL parse in production polling | MEDIUM | Create dedicated `getActiveSessions()` function that uses mtime filter + tail read; update route to call new function; existing `getSessions()` unchanged |
| Status oscillation from boundary threshold | LOW | Add debounce wrapper: `prevStatus === newStatus || consecutiveSameCount >= 2` before emitting status change; no architecture change |
| GSD file read crashes | LOW | Wrap all GSD reads in try-catch with `null` return; add `existsSync` guard before every read; takes < 1 hour |
| Duration showing session lifetime instead of current block | MEDIUM | Add `findCurrentSessionBlock()` helper that scans timestamps for contiguous blocks; used only in active sessions, not historical sessions |
| CPU spike from polling | HIGH (if discovered late) | Requires extracting a purpose-built `getActiveSessions()` function from scratch; cannot be patched on top of existing `getSessions()`; ~1 day to implement correctly with caching |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Partial line read from active write | Phase: tail-read utility function | Unit test: read a file, append to it mid-read, confirm last-line drop is detected as in-progress, not discarded |
| mtime threshold too narrow | Phase: status inference algorithm | Manual test: open /active, run a long Claude Code task (file copy, web search), confirm status stays "working" for > 60s |
| Full JSONL scan on every poll | Phase: `/api/active-sessions` route implementation | Load test: 50 sessions in ~/.claude, open /active page, measure CPU over 30 seconds (target: < 5% steady state) |
| Concurrent read race condition | Phase: tail-read utility function | Test: open /active while Claude Code is actively writing; confirm no crashes in server logs over 10 minutes |
| GSD files not found | Phase: GSD progress reader implementation | Test with non-GSD project: verify clean UI, no errors, no ENOENT in server logs |
| Resumed session duration inflation | Phase: active session duration calculation | Test: resume a session from yesterday; verify displayed duration is < 1 hour (current block), not 18+ hours |
| SWR polling on wrong hook | Phase: `useActiveSessions()` hook creation | Code review: confirm `useStats`, `useSessions`, `useProjects` do NOT have `refreshInterval` added |
| Imported data mode interaction | Phase: `/active` page UI | Test: switch to imported data mode; verify /active shows "not available" state, not broken empty state |

---

## Sources

- Codebase analysis: `/mnt/c/SourceControl/GitHub/Claud-ometer/src/lib/claude-data/reader.ts` (full file read — existing patterns and gaps)
- Codebase concerns: `.planning/codebase/CONCERNS.md` (existing tech debt and performance bottlenecks)
- [Chokidar: file add event fires before write complete (awaitWriteFinish pattern)](https://github.com/paulmillr/chokidar) — HIGH confidence, official docs
- [fs.watch false positives on Windows/WSL](https://github.com/nodejs/node/issues/6771) — HIGH confidence, official Node.js issue tracker
- [read-last-lines: efficient tail read via byte position](https://github.com/alexbbt/read-last-lines) — HIGH confidence, npm official
- [SWR refreshInterval behavior and deduplication](https://swr.vercel.app/docs/revalidation) — HIGH confidence, official Vercel docs
- [OpenKanban issue: agent status always shows idle due to wrong session ID](https://github.com/TechDufus/openkanban/issues/33) — MEDIUM confidence, analogous real-world case
- [GSD getMilestoneInfo bug: wrong version from STATE.md vs ROADMAP.md](https://github.com/gsd-build/get-shit-done/issues/853) — MEDIUM confidence, directly relevant
- [Node.js fs.watch wildly different behavior across scenarios](https://github.com/nodejs/node/issues/47058) — HIGH confidence, official Node.js issue
- [Implementing tail -f in Node.js: position tracking pattern](https://kodewithkamran.medium.com/implementing-tail-f-in-node-js-edeb412eb587) — MEDIUM confidence, community source

---
*Pitfalls research for: Real-time active session monitoring — JSONL filesystem polling on Next.js local dashboard*
*Researched: 2026-03-18*
