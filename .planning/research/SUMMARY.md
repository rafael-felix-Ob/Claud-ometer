# Project Research Summary

**Project:** Claud-ometer — Active Sessions Monitoring Page
**Domain:** Real-time filesystem polling and live session status in a local-first Next.js analytics dashboard
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

This feature adds a `/active` page to the existing Claud-ometer dashboard, displaying live Claude Code sessions inferred from JSONL file modification times and tail-read message analysis. The project is a pure extension of an already well-designed codebase: all required capabilities — SWR polling, Node.js `fs` operations, JSONL parsing patterns, and formatting utilities — already exist. No new dependencies are needed. The recommended approach is a dedicated API route (`/api/active-sessions`) backed by a purpose-built reader function that uses mtime filtering and tail-reading, not the existing full-scan `getSessions()` path.

The single most important architectural decision is to avoid reusing the existing `getSessions()` function for active detection. That function performs full JSONL parsing of every session file, which is acceptable for on-demand historical views but will spike CPU to 50%+ when run every 5 seconds. The new reader must use a two-step approach: stat-only directory scan filtered by mtime, followed by tail-reads of only the recently-modified files. This keeps polling cost at near-zero regardless of total historical session count.

The feature carries one significant UX risk: the three-state status detection (working/waiting/idle) must correctly handle Claude Code's bursty write pattern, where model processing can produce 60-120 second gaps with no file writes. Using mtime alone will constantly misclassify active sessions as idle. Status must combine mtime recency with last-message-type analysis. All other pitfalls are avoidable with careful implementation and the explicit defensive coding patterns already established in this codebase.

## Key Findings

### Recommended Stack

The entire feature can be built on what is already installed. SWR's `refreshInterval: 5000` is the correct polling mechanism — WebSockets and SSE add stateful server complexity with no benefit at 5-second granularity for a single-user local tool. Node.js `fs` built-ins (`statSync`, `fstatSync`, `readSync`) cover both mtime detection and tail-reading. The existing `supplementalCache` pattern in `reader.ts` provides the right model for a 4-second module-level TTL cache on the directory listing.

**Core technologies:**
- SWR 2.4.0 (already installed): 5-second polling via `refreshInterval` — zero new dependencies, established pattern already used in sidebar
- Node.js `fs` (built-in): `statSync().mtimeMs` for activity detection, `readSync` with byte-offset for tail-reading
- Next.js `force-dynamic` routes (already established): stateless API handler pattern used by every existing route
- Module-level `Map` cache with 4-second TTL: prevents directory re-scan on burst requests, pattern already present as `supplementalCache`

### Expected Features

**Must have (table stakes — P1 for launch):**
- Active session detection via file mtime filtering — nothing works without this
- Per-session status indicator (working/waiting/idle) — the core differentiator of this page
- Session duration display — answers "how long has this been running?"
- Token consumption display — answers "how much has this cost so far?"
- 5-second SWR polling with last-updated timestamp — makes the page feel live
- Card grid layout with project name, git branch, link to session detail
- Empty state with explicit "no active sessions" messaging
- Sidebar navigation entry

**Should have (P2 — add once core is validated):**
- GSD build progress display from `.planning/STATE.md` — high value for GSD workflow users, fully optional enrichment
- Status-based card ordering (working first, waiting second, idle last)
- Animated pulse indicator on "working" status

**Defer (P3 / v2+):**
- Token velocity indicator (tokens/minute) — requires client-side state diffing between polls, conflicts with stateless SWR pattern
- Idle threshold customization via UI setting
- Desktop/browser notifications for session completion

### Architecture Approach

The architecture follows the established layered pattern of the codebase strictly: types first, reader functions second, API route third, SWR hook fourth, UI components fifth, page last. A new `ActiveSessionInfo` type extends the existing type hierarchy. A dedicated `/api/active-sessions` route isolates active-session concerns from the historical `/api/sessions` route, which uses a fundamentally different read strategy and polling cadence. The `readGsdProgress()` helper reads `.planning/STATE.md` as optional enrichment, returning `null` for non-GSD projects rather than erroring.

**Major components:**
1. `GET /api/active-sessions` — dedicated route, delegates to `getActiveSessions()`, returns `ActiveSessionInfo[]`
2. `getActiveSessions()` in `reader.ts` — mtime scan, tail-read, status inference, optional GSD progress read
3. `tailReadJsonl()` helper — byte-offset seek to file end, reads last 8KB, parses complete lines only
4. `inferSessionStatus()` helper — pure function mapping last messages + mtime age to `working | waiting | idle`
5. `readGsdProgress()` helper — optional `.planning/STATE.md` reader, returns `null` when absent
6. `useActiveSessions()` SWR hook — `refreshInterval: 5000`, `revalidateOnFocus: false`, isolated from existing hooks
7. `ActiveSessionCard` component — status badge, duration, tokens, optional GSD section
8. `/active/page.tsx` — card grid, empty state, polling badge

### Critical Pitfalls

1. **Partial line from active JSONL write** — When Claude Code is mid-write, the last line of the JSONL file is incomplete JSON. Treat a final parse failure as `incomplete_write` and infer `working` status rather than silently discarding the line and reading the previous one as authoritative. Use `fs.readSync` with explicit byte positions (not `createReadStream`) to avoid the streaming race condition.

2. **mtime threshold too narrow for model thinking time** — Claude Code has 60-120 second gaps with no file writes during active model processing. Never use mtime alone for status. Combine: `mtime < 30s` = definitely working; `mtime < 5min AND last message is assistant turn` = active/thinking; `mtime > 5min` = idle. Failing to do this makes the page show everything as idle during the most interesting moments.

3. **Full JSONL re-parse on every 5-second poll** — Calling `getSessions()` or `parseSessionFile()` in the active-sessions route will spike CPU to 40-80% with any meaningful session history. The fix must be baked into the initial implementation: mtime-filter at directory-scan time (stat only), then tail-read (last 8KB) only for files that pass. Adding this as a retrofit after launch is a day's work.

4. **Resumed historical sessions inflate duration** — A session started yesterday and resumed today shows mtime of now but `firstTimestamp` of yesterday, producing duration values like "17h 32m". For active sessions, display the duration of the most recent contiguous activity block (gap threshold: 30 minutes), not total session lifetime.

5. **GSD file reads crash non-GSD sessions** — Most Claude Code projects have no `.planning/` directory. Any code that assumes STATE.md exists will produce ENOENT errors every 5 seconds per session. Always `existsSync` before reading; return `null` (not error) when absent; hide the GSD card section entirely (not empty/spinner) for non-GSD sessions.

## Implications for Roadmap

Based on research, the dependency chain is strictly bottom-up and maps cleanly to 4 phases. Each phase is independently testable before the next is built. The architecture is fully specified — no research gaps require deeper investigation before work begins.

### Phase 1: Types and Core Data Layer

**Rationale:** All UI and API work depends on the `ActiveSessionInfo` type shape. Reader functions are the riskiest new logic (mtime thresholds, tail-read byte math, status inference) and must be built and unit-tested before any route or UI consumes them. This is the natural bottom of the dependency chain.

**Delivers:** `ActiveSessionInfo`, `SessionStatus`, `GsdProgress` types in `types.ts`; `tailReadJsonl()`, `inferSessionStatus()`, `readGsdProgress()`, `getActiveSessions()` functions in `reader.ts`

**Addresses:** All P1 data requirements (active detection, status, duration, tokens)

**Avoids pitfalls:** Partial line read (handle in `tailReadJsonl`), mtime threshold (encode in `inferSessionStatus`), full JSONL re-parse (never call `parseSessionFile` here), resumed session duration (use contiguous block calculation), GSD crash (existsSync guard in `readGsdProgress`)

### Phase 2: API Route and SWR Hook

**Rationale:** The route is a thin wrapper over the reader functions from Phase 1. The SWR hook is a thin wrapper over the route. Both can be built and integration-tested independently of any UI. The isolation of `useActiveSessions()` from existing hooks must be enforced here — adding `refreshInterval` to an existing hook is an anti-pattern that would start polling all existing pages.

**Delivers:** `GET /api/active-sessions` route; `useActiveSessions()` hook with `refreshInterval: 5000` and `revalidateOnFocus: false`

**Uses:** `getActiveSessions()` from Phase 1; established `force-dynamic` route pattern; SWR `refreshInterval`

**Implements:** API layer and data-access boundary from the architecture diagram

### Phase 3: UI Components and Page

**Rationale:** Components depend on the hook (Phase 2) and types (Phase 1). This phase translates all data work into visible output. The `ActiveSessionCard` is significantly different from `stat-card.tsx` (richer, includes status badge and optional GSD section) and must be a new component. The empty state and data source toggle behavior must be explicitly handled.

**Delivers:** `ActiveSessionCard` component; `/active/page.tsx` with card grid, empty state, last-updated indicator, imported-data-mode guard

**Addresses:** All P1 display requirements; P2 status-based ordering and animated pulse

**Avoids pitfalls:** Page flicker (SWR `keepPreviousData: true`), empty state confusion (explicit "no sessions running" message), imported data mode (show "not available" state)

### Phase 4: Navigation and Polish

**Rationale:** Sidebar nav entry and P2 features (GSD progress display, model indicator, git branch prominence) are additive once the core page works. GSD progress is P2 because it requires a separate sub-feature (STATE.md parser) and the core page is fully useful without it. Doing it last also allows validation that the base active detection is reliable before adding derived features on top.

**Delivers:** Sidebar `/active` nav entry with `Activity` icon; GSD progress section on `ActiveSessionCard`; model indicator; git branch display

**Addresses:** P2 features from FEATURES.md; discoverability (sidebar entry)

### Phase Ordering Rationale

- Bottom-up dependency forces Phase 1 before all else: types and reader functions are prereqs for everything
- Phase 3 (UI) must wait for Phase 2 (hook), which must wait for Phase 1 (reader) — no parallelization possible given the vertical slice
- Phase 4 (polish + GSD) deliberately deferred to validate the status detection is reliable before adding features that depend on it
- GSD progress display moves to Phase 4 specifically because it requires validating non-GSD session behavior first (Pitfall 5), which is only verifiable once the page exists

### Research Flags

Phases with standard patterns (skip `research-phase`):
- **Phase 1:** Reader extension patterns are well-established in this codebase; `tailReadJsonl` follows the existing `extractCwdFromSession` approach exactly
- **Phase 2:** Route and hook patterns are identical to existing routes/hooks; no novel integration
- **Phase 3:** All UI patterns documented in CLAUDE.md; card grid, badge, and animation patterns are established
- **Phase 4:** Sidebar nav extension is a 3-line change following existing `navItems` pattern; GSD progress regex parsing is simple and the format is documented

No phases require `/gsd:research-phase` — all unknowns are resolved by the existing research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommended tools are already in the project and in active use; no speculative choices |
| Features | HIGH | Clear P1/P2/P3 prioritization with explicit rationale; no features are ambiguous in value or scope |
| Architecture | HIGH | Based on direct codebase analysis; all components have clear analogues already in the codebase; build order is strictly specified |
| Pitfalls | HIGH | Six critical pitfalls identified from codebase analysis + verified Node.js/SWR community patterns; each has concrete detection and prevention |

**Overall confidence:** HIGH

### Gaps to Address

- **WSL mtime precision:** On Windows/WSL, filesystem mtime has 1-2 second granularity for Windows-hosted files. If the dev or production environment is WSL, threshold comparisons should use >10 second margins rather than <5 second. Verify the deployment environment during Phase 1 implementation.

- **STATE.md format stability:** The GSD progress parsing uses regex against a documented but project-internal format. If the STATE.md format changes in future GSD versions, the parser will silently return `null`. Add a format version comment to the parser so breakage is obvious rather than silent.

- **Token count semantics:** The tail-read approach yields tokens from only the last N messages, not the full session total. The label "recent tokens" is accurate but may confuse users who expect a session total. Validate the label with at least one user before shipping Phase 3.

## Sources

### Primary (HIGH confidence)
- SWR official docs (swr.vercel.app) — `refreshInterval`, `revalidateOnFocus`, deduplication behavior
- Node.js official docs (nodejs.org/api/fs.html) — `statSync`, `fstatSync`, `readSync`, `stats.mtimeMs`
- Codebase direct analysis — `reader.ts`, `hooks.ts`, `types.ts`, `sidebar.tsx` — all patterns verified in source

### Secondary (MEDIUM confidence)
- OpenAI community (community.openai.com) — confirms "working/needs input" status distinction is a recognized user need
- Implementing tail-f in Node.js (Medium/Kamran) — byte-position tail pattern approach
- OpenKanban issue tracker — analogous agent status misclassification case

### Tertiary (LOW confidence / analogues)
- PM2 web dashboard (github.com/oxdev03/pm2.web) — reference UI for process monitoring cards
- Chokidar awaitWriteFinish docs — partial write pattern; not used directly but informs the incomplete-line handling approach

---
*Research completed: 2026-03-18*
*Ready for roadmap: yes*
