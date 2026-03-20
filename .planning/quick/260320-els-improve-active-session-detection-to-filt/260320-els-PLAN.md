---
phase: quick-260320-els
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/claude-data/active-sessions.ts
  - src/lib/claude-data/types.ts
  - src/app/active/page.tsx
  - src/__tests__/lib/active-sessions.test.ts
autonomous: true
requirements: [ELS-01]

must_haves:
  truths:
    - "Only sessions with a running Claude Code process (or very recent file write) appear as working/waiting"
    - "Finished sessions whose JSONL was modified within 30 min but have no running process are filtered out or shown as 'recent' not 'active'"
    - "Active Now count in stat cards reflects only process-backed sessions"
    - "If process detection fails (lsof unavailable), behavior degrades gracefully to current heuristics"
  artifacts:
    - path: "src/lib/claude-data/active-sessions.ts"
      provides: "Process detection via lsof + filtering logic"
      contains: "detectOpenJsonlFiles"
    - path: "src/lib/claude-data/types.ts"
      provides: "hasRunningProcess field on ActiveSessionInfo"
      contains: "hasRunningProcess"
    - path: "src/app/active/page.tsx"
      provides: "Split UI showing active vs recently-active sessions"
      contains: "Recently Active"
  key_links:
    - from: "src/lib/claude-data/active-sessions.ts"
      to: "lsof command"
      via: "child_process.execSync"
      pattern: "execSync.*lsof"
    - from: "src/lib/claude-data/active-sessions.ts"
      to: "ActiveSessionInfo.hasRunningProcess"
      via: "cross-reference open files with scanned sessions"
      pattern: "hasRunningProcess"
    - from: "src/app/active/page.tsx"
      to: "hasRunningProcess"
      via: "filter/partition sessions for display"
      pattern: "hasRunningProcess"
---

<objective>
Filter out stale sessions from the active sessions page by detecting whether a Claude Code process actually has each session's JSONL file open.

Purpose: User sees 5 "idle" sessions when only 1 Claude Code instance is running. Finished sessions whose files were modified within the 30-minute window show as idle clutter. Process-based detection separates truly active sessions from recently-touched-but-finished ones.

Output: Updated active-sessions.ts with lsof-based process detection, updated types, updated UI with "Active" vs "Recently Active" sections.
</objective>

<execution_context>
@/home/rfelix/.claude/get-shit-done/workflows/execute-plan.md
@/home/rfelix/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/lib/claude-data/active-sessions.ts
@src/lib/claude-data/types.ts
@src/app/active/page.tsx
@src/__tests__/lib/active-sessions.test.ts
@src/app/api/active-sessions/route.ts

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/lib/claude-data/types.ts:
```typescript
export type SessionStatus = 'working' | 'waiting' | 'idle';

export interface ActiveSessionInfo {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  cwd: string;
  gitBranch: string;
  status: SessionStatus;
  duration: number;
  activeTime: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCost: number;
  model: string;
  models: string[];
  lastActivity: string;
  gsdProgress?: GsdProgress | null;
}
```

From src/lib/claude-data/active-sessions.ts:
```typescript
export function scanActiveFiles(): ActiveFileEntry[];
export async function getActiveSessions(): Promise<ActiveSessionInfo[]>;
export function inferSessionStatus(...): SessionStatus;
export function tailReadJsonl(...): TailReadResult;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add process detection and hasRunningProcess to active session pipeline</name>
  <files>src/lib/claude-data/active-sessions.ts, src/lib/claude-data/types.ts, src/__tests__/lib/active-sessions.test.ts</files>
  <behavior>
    - Test: detectOpenJsonlFiles returns a Set of absolute file paths that have an open file descriptor (mock execSync)
    - Test: detectOpenJsonlFiles returns empty Set when lsof command fails (graceful fallback)
    - Test: getActiveSessions populates hasRunningProcess=true when file is in the open-files set
    - Test: getActiveSessions populates hasRunningProcess=false when file is NOT in the open-files set
    - Test: When detectOpenJsonlFiles returns empty Set (lsof unavailable), all sessions get hasRunningProcess=true (graceful fallback — assume all active)
  </behavior>
  <action>
1. In `src/lib/claude-data/types.ts`, add `hasRunningProcess: boolean` field to `ActiveSessionInfo` interface.

2. In `src/lib/claude-data/active-sessions.ts`, add a new exported function `detectOpenJsonlFiles(projectsDir: string): Set<string>`:
   - Uses `child_process.execSync` to run `lsof +D <projectsDir> 2>/dev/null` with `encoding: 'utf8'` and a 3-second timeout
   - Parses lsof output: each line has columns separated by whitespace, the last column (NAME) is the file path
   - Filters for paths ending in `.jsonl`
   - Returns a `Set<string>` of absolute paths
   - On ANY error (command not found, timeout, non-zero exit): return empty Set (graceful degradation)
   - IMPORTANT: lsof +D is recursive and checks all files under the directory — this is exactly what we need

3. In `getActiveSessions()`, call `detectOpenJsonlFiles(projectsDir)` once at the start (before the loop). Store as `openFiles`.
   - Determine `lsofAvailable`: true if openFiles.size > 0 OR if we can confirm lsof ran successfully. Simplest: wrap the execSync in a try/catch, set a boolean `lsofWorked` based on whether it threw.
   - For each session: set `hasRunningProcess = lsofWorked ? openFiles.has(filePath) : true` (if lsof is unavailable, assume all sessions are active — graceful fallback to current behavior)

4. In the `results.push(...)` block, add `hasRunningProcess` to the object.

5. Update tests in `src/__tests__/lib/active-sessions.test.ts`:
   - Mock `child_process` module: `jest.mock('child_process')`
   - Add test group for `detectOpenJsonlFiles` function
   - Update existing `getActiveSessions` tests to mock execSync (returning empty string so lsofWorked=false, making hasRunningProcess default to true — existing assertions unchanged)
   - Add new test: when lsof reports a file open, that session gets hasRunningProcess=true
   - Add new test: when lsof does NOT report a file, that session gets hasRunningProcess=false
  </action>
  <verify>
    <automated>cd /mnt/c/SourceControl/GitHub/Claud-ometer && npx jest src/__tests__/lib/active-sessions.test.ts --no-cache 2>&1 | tail -30</automated>
  </verify>
  <done>ActiveSessionInfo has hasRunningProcess field. detectOpenJsonlFiles function exists and is tested. getActiveSessions populates the field. All existing + new tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Split active sessions UI into Active vs Recently Active sections</name>
  <files>src/app/active/page.tsx</files>
  <action>
1. Update the page to partition sessions into two groups:
   - `activeSessions`: sessions where `hasRunningProcess === true` (Claude Code is running)
   - `recentSessions`: sessions where `hasRunningProcess === false` (file was recently modified but no process)

2. Update the stat cards row:
   - "Active Now" count: only count `activeSessions` with status 'working' or 'waiting'
   - "Sessions" count: keep as total (both groups)
   - "Tokens (Recent)" sum: keep as total (both groups)

3. Render two sections in the card grid area:

   **Active section** (always shown, uses existing card grid layout):
   - Show `activeSessions` sorted by status (working > waiting > idle)
   - Use the existing card rendering code (no visual changes to individual cards)
   - If no active sessions: show a small inline message "No sessions with running Claude Code processes" (NOT the full empty state)

   **Recently Active section** (collapsible, only shown if recentSessions.length > 0):
   - Add a header row: "Recently Active ({count})" with a ChevronDown/ChevronUp toggle icon (from lucide-react)
   - Default state: collapsed
   - Use `useState<boolean>` for `showRecent`, default `false`
   - When expanded, show the same card grid but with reduced opacity: add `opacity-60` to the outer wrapper div
   - Show a small note below the header: "Sessions modified in the last 30 minutes with no running Claude Code process"

4. Keep the full empty state (Activity icon + "No active sessions" text) only when BOTH groups are empty (sorted.length === 0).

5. Keep the existing imported-data banner logic unchanged.

6. Styling for the "Recently Active" header:
   - `flex items-center gap-2 cursor-pointer` on the clickable row
   - Text: `text-sm font-medium text-muted-foreground`
   - ChevronDown/ChevronUp icon: `h-4 w-4 text-muted-foreground`
   - Subtitle note: `text-xs text-muted-foreground/70`
  </action>
  <verify>
    <automated>cd /mnt/c/SourceControl/GitHub/Claud-ometer && npx next build 2>&1 | tail -20</automated>
  </verify>
  <done>Active sessions page shows two distinct sections. Sessions with running processes appear in the main "Active" area. Sessions without running processes appear in a collapsed "Recently Active" section. Active Now count only reflects process-backed sessions. Build succeeds with no errors.</done>
</task>

</tasks>

<verification>
1. `npx jest src/__tests__/lib/active-sessions.test.ts --no-cache` — all tests pass
2. `npx next build` — production build succeeds
3. Manual: open the active sessions page with Claude Code running — the running session shows in the main section, stale sessions appear in "Recently Active"
</verification>

<success_criteria>
- Active sessions page no longer shows 5 idle sessions when only 1 Claude Code instance is running
- The 1 running session appears prominently in the main active section
- The 4 stale sessions appear in a collapsed "Recently Active" section (or are hidden)
- If lsof is unavailable, behavior is identical to current (all sessions shown as active — no regression)
- All existing tests continue to pass
- Build succeeds
</success_criteria>

<output>
After completion, create `.planning/quick/260320-els-improve-active-session-detection-to-filt/260320-els-SUMMARY.md`
</output>
