# Phase 3: GSD Integration - Research

**Researched:** 2026-03-18
**Domain:** Filesystem parsing (YAML frontmatter + Markdown prose), TypeScript type extension, React conditional rendering
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**GSD Info Placement**
- New row below existing card content (tokens/model/branch), separated by a thin Separator
- Shows: phase name + status + next GSD command
- Format example: "Phase 2: Active Sessions Page • Executing • Next: /gsd:execute-phase 2"
- Small "GSD" badge displayed near the project name in the card header to signal this is a GSD-managed project

**GSD Data Source**
- Read from `{projectPath}/.planning/STATE.md` for each active session
- Parse YAML frontmatter for: `status`, `progress.total_phases`, `progress.completed_phases`, `progress.percent`
- Parse prose sections for: current phase name, stopped-at info
- Read from `{projectPath}/.planning/ROADMAP.md` for phase names if needed
- All file reads guarded with `existsSync` — never throw on missing files

**Non-GSD Session Handling**
- No `.planning/` directory → show nothing at all. Card looks exactly like Phase 2 output. No placeholder, no indicator.
- `.planning/` exists but `STATE.md` is missing or malformed → show "GSD" badge near project name only, no progress info section. Signals it's GSD-managed but state is unreadable.

**GSD Progress Updates**
- GSD state is read server-side in the API route alongside the existing `getActiveSessions()` call
- New field on `ActiveSessionInfo`: optional `gsdProgress` object (or null)
- `gsdProgress` contains: `phaseName`, `phaseNumber`, `phaseStatus`, `nextAction`, `totalPhases`, `completedPhases`, `percent`
- Data refreshes with each 5-second poll — no separate polling needed

**Integration Points**
- Extend `ActiveSessionInfo` type with optional `gsdProgress` field
- Extend `getActiveSessions()` or create helper to read GSD state per session
- Extend card JSX in `page.tsx` to conditionally render GSD section

### Claude's Discretion

- Exact styling/colors for the GSD progress section
- How to truncate long phase names
- Progress bar visual (if used alongside text)
- Separator style between main card content and GSD section

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GSD-01 | User can view current GSD phase name and status for sessions with .planning/ directories | STATE.md frontmatter parsing identifies `status` + prose parsing identifies current phase name; ROADMAP.md provides canonical phase name |
| GSD-02 | User can view the next GSD action for each active GSD session | `status` + `stopped_at` frontmatter fields + phase number from "Current Position" prose block drive next-action inference |
| GSD-03 | GSD progress gracefully shows nothing when .planning/ directory is absent | `existsSync` guard on `.planning/` dir returns null gsdProgress; UI conditionally renders nothing |

</phase_requirements>

---

## Summary

Phase 3 adds optional GSD build progress enrichment to active session cards. The work is entirely additive — no existing functionality changes, only new fields appear when a session's project contains a `.planning/STATE.md` file.

The technical core is a new pure function `readGsdProgress(projectPath)` that reads and parses `STATE.md` YAML frontmatter plus a single prose regex to extract the current phase number. This feeds into a new optional field `gsdProgress` on `ActiveSessionInfo`. The card UI reads `session.gsdProgress` and conditionally renders a bottom section separated from existing content.

The STATE.md format is a custom lightweight YAML-like structure (not full YAML spec) delimited by `---` blocks. It must be parsed with simple regex and string splitting — no external YAML library required or appropriate. The GSD toolchain itself uses the same regex-based approach (see `frontmatter.cjs`). Phase names must be resolved from the prose "Current Position" section or from ROADMAP.md since the frontmatter only stores `stopped_at` text.

**Primary recommendation:** Implement `readGsdProgress()` as a standalone module in `src/lib/claude-data/gsd-progress.ts`, call it from `getActiveSessions()`, extend `ActiveSessionInfo` with `gsdProgress?: GsdProgress | null`, and add a conditional GSD section below the card's existing git branch row.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | built-in | Read `.planning/STATE.md` and `ROADMAP.md` | Already used throughout `active-sessions.ts` and `reader.ts` |
| Node.js `path` | built-in | Resolve `.planning/` paths from `projectPath` | Already used everywhere in the codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn/ui `Badge` | already installed | "GSD" indicator in card header | When `.planning/` directory detected |
| shadcn/ui `Separator` | already installed | Divides GSD section from card content | When gsdProgress is non-null |
| Lucide `Layers` or `BookOpen` | already installed | Icon for GSD section | Claude's discretion |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex frontmatter parsing | `js-yaml` npm package | js-yaml adds a dependency and handles full YAML spec; overkill for this 10-field frontmatter |
| Regex frontmatter parsing | `gray-matter` npm package | gray-matter handles edge cases but adds ~15KB; not worth it for one flat file per session |
| Reading STATE.md on every poll | File mtime cache | Complexity not justified at 5s poll rate with tiny file reads |

**Installation:** No new packages needed. All libraries already in the project.

---

## Architecture Patterns

### Recommended Project Structure

New file to create:
```
src/lib/claude-data/
├── gsd-progress.ts     # New: readGsdProgress() pure function
├── active-sessions.ts  # Existing: add gsdProgress call per session
└── types.ts            # Existing: add GsdProgress interface + gsdProgress field
```

Modified files:
```
src/lib/claude-data/types.ts          # Add GsdProgress interface, extend ActiveSessionInfo
src/lib/claude-data/active-sessions.ts # Import readGsdProgress, call per session
src/app/active/page.tsx               # Add conditional GSD section to card JSX
```

### Pattern 1: Three-tier gsdProgress Response

`readGsdProgress(projectPath)` returns one of three shapes:

```typescript
// Tier 1: No .planning/ directory — non-GSD project
null

// Tier 2: .planning/ exists, STATE.md missing or malformed — GSD project, unreadable state
{ isGsd: true, phaseName: null, phaseNumber: null, phaseStatus: null,
  nextAction: null, totalPhases: null, completedPhases: null, percent: null }

// Tier 3: STATE.md parseable — full progress object
{ isGsd: true, phaseName: 'Active Sessions Page', phaseNumber: 2,
  phaseStatus: 'executing', nextAction: '/gsd:execute-phase 2',
  totalPhases: 3, completedPhases: 1, percent: 33 }
```

The card uses this shape:
- `gsdProgress === null` → render nothing (non-GSD)
- `gsdProgress.isGsd && gsdProgress.phaseName === null` → render "GSD" badge only
- `gsdProgress.isGsd && gsdProgress.phaseName !== null` → render badge + full progress section

### Pattern 2: Frontmatter Parsing (No Library)

The STATE.md frontmatter uses a custom GSD format. Parse with regex line-by-line, matching the approach in `frontmatter.cjs`:

```typescript
// Source: frontmatter.cjs extractFrontmatter() + this project's STATE.md
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) return {};

  const result: Record<string, unknown> = {};
  const lines = match[1].split('\n');

  let currentSection: Record<string, unknown> | null = null;
  let currentKey = '';

  for (const line of lines) {
    if (line.trim() === '') continue;

    // Nested key (e.g., "  total_phases: 3")
    const nestedMatch = line.match(/^\s{2}([a-z_]+):\s*(.*)/);
    if (nestedMatch && currentSection) {
      const val = nestedMatch[2].trim().replace(/^["']|["']$/g, '');
      currentSection[nestedMatch[1]] = isNaN(Number(val)) ? val : Number(val);
      continue;
    }

    // Top-level key
    const keyMatch = line.match(/^([a-z_]+):\s*(.*)/);
    if (keyMatch) {
      const key = keyMatch[1];
      const val = keyMatch[2].trim().replace(/^["']|["']$/g, '');
      if (val === '') {
        // Start of nested block (e.g., "progress:")
        currentSection = {};
        result[key] = currentSection;
        currentKey = key;
      } else {
        result[key] = isNaN(Number(val)) ? val : Number(val);
        currentSection = null;
      }
    }
  }

  return result;
}
```

### Pattern 3: Current Phase Extraction from Prose

The "Current Position" prose block contains the active phase number. Parse with a single regex:

```typescript
// Source: inspection of .planning/STATE.md in this project
// "Phase: 2 of 3 (Active Sessions Page)"
const phaseMatch = content.match(/^Phase:\s*(\d+)\s+of\s+(\d+)\s*\(([^)]+)\)/m);
if (phaseMatch) {
  const phaseNumber = parseInt(phaseMatch[1], 10);
  const totalPhases = parseInt(phaseMatch[2], 10);
  const phaseName = phaseMatch[3].trim(); // "Active Sessions Page"
}
```

### Pattern 4: Next Action Inference

The `nextAction` string is derived from `status` + `phaseNumber`. No additional file reading needed:

```typescript
// Status values observed in STATE.md: "active", "completed", "paused", "blocked"
// Frontmatter field: status
function inferNextAction(status: string, phaseNumber: number, stoppedAt: string): string {
  if (status === 'completed') return `/gsd:verify-work ${phaseNumber}`;
  if (status === 'paused' || status === 'blocked') return `/gsd:execute-phase ${phaseNumber}`;
  // Default for active/executing
  return `/gsd:execute-phase ${phaseNumber}`;
}
```

**Note on status values:** The STATE.md for this project shows `status: completed` at the milestone level (the whole v1.0 milestone is completed). The phase-level `stopped_at` field and prose "Status" line are the more reliable indicators for current-phase status. See Anti-Patterns below.

### Pattern 5: existsSync Guard (Established in This Codebase)

All filesystem reads in this codebase use `existsSync` guards before reading:

```typescript
// Source: reader.ts and active-sessions.ts patterns
import * as fs from 'fs';
import * as path from 'path';

export function readGsdProgress(projectPath: string): GsdProgress | null {
  if (!projectPath) return null;

  const planningDir = path.join(projectPath, '.planning');
  if (!fs.existsSync(planningDir)) return null; // Tier 1: non-GSD

  const stateMdPath = path.join(planningDir, 'STATE.md');
  if (!fs.existsSync(stateMdPath)) {
    // Tier 2: GSD project, no STATE.md
    return { isGsd: true, phaseName: null, phaseNumber: null, /* ... */ };
  }

  try {
    const content = fs.readFileSync(stateMdPath, 'utf-8');
    // parse...
  } catch {
    // Tier 2: unreadable STATE.md
    return { isGsd: true, phaseName: null, phaseNumber: null, /* ... */ };
  }
}
```

### Pattern 6: Conditional Card Section (Additive JSX)

The card in `page.tsx` currently ends with a `CardContent` block. Add GSD section conditionally:

```tsx
{/* Existing CardContent ends here */}
{/* GSD section — only when gsdProgress is present */}
{session.gsdProgress?.isGsd && (
  <CardContent className="pt-0">
    <Separator className="mb-3" />
    {session.gsdProgress.phaseName ? (
      <div className="space-y-1">
        {/* GSD progress text */}
      </div>
    ) : (
      /* Badge-only state already shown in header */
      null
    )}
  </CardContent>
)}
```

**Note:** The "GSD" badge in the card header (for `.planning/` detection) uses a different insertion point — it goes next to `session.projectName` in the CardHeader, not in CardContent.

### Anti-Patterns to Avoid

- **Parsing `status` from frontmatter as phase status:** The top-level `status` field tracks milestone status (e.g., `completed` = all phases done), not the current phase's execution status. Use the prose "Status:" line in "Current Position" section for phase-level status, or infer from `stopped_at`.
- **Throwing on parse errors:** Any parse failure must return the Tier 2 shape (isGsd badge only), never propagate an exception up to the API route.
- **Adding a separate API endpoint for GSD data:** GSD data must flow through the existing `/api/active-sessions` route alongside session data. No new routes.
- **Runtime-constructed Tailwind classes:** The existing codebase avoids Tailwind JIT purge by using inline `style` for dynamic colors. Use the same approach for any GSD section color that varies at runtime.
- **Importing yaml/js-yaml:** Not in package.json. The frontmatter is simple enough for regex-based line parsing.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Custom full-spec YAML parser | Regex line scanner (see Pattern 2) | STATE.md uses only flat and one-level-deep key-value; full YAML spec not needed |
| GSD badge styling | Custom CSS | `Badge` variant from shadcn/ui | Already installed, consistent with existing model/status badges |
| Section divider | Custom `<hr>` | `Separator` from shadcn/ui | Already used for `ExpandedCardDetail` in the same file |
| Polling GSD data | Separate SWR hook with its own interval | Piggyback on existing `useActiveSessions` 5s poll | API route already returns it; no new hook needed |

---

## Common Pitfalls

### Pitfall 1: projectPath vs cwd

**What goes wrong:** `ActiveSessionInfo` has both `projectPath` (the full filesystem path, e.g., `/home/user/my-project`) and `cwd` (the working directory of the Claude Code session). For GSD, `.planning/` lives at the **project root**, which is `projectPath`, not `cwd`. Using `cwd` might work for top-level projects but fails for sessions in subdirectories.

**Why it happens:** `cwd` comes from session messages and may point to a subdirectory; `projectPath` is resolved via `projectIdToFullPath()` and is the authoritative project root.

**How to avoid:** Always use `session.projectPath` when constructing the `.planning/` path.

**Warning signs:** `existsSync` returns false on a project that clearly has `.planning/` when you `ls` its root.

### Pitfall 2: Milestone `status` vs Phase `status`

**What goes wrong:** The frontmatter `status` field reads `completed` even while Phase 3 is actively being worked on. This is the **milestone** status, not the current phase's status.

**Why it happens:** GSD sets `status: completed` when a phase is done. When multiple phases complete, the milestone `status` reflects the whole milestone, not the in-progress phase.

**How to avoid:** For `phaseStatus` in `GsdProgress`, parse the prose section "Current Position" → "Status: Phase X complete — ready for Phase Y" line, not the frontmatter `status` field. Or use `stopped_at` as a fallback label.

**Warning signs:** Every GSD session shows "Status: completed" even when Claude Code is clearly running a build phase.

### Pitfall 3: Missing `projectPath` at Call Site

**What goes wrong:** `projectPath` is `''` (empty string) for some sessions — for example, sessions whose `projectIdToFullPath()` resolver returns empty.

**Why it happens:** The resolver calls a path decoder that can fail silently. `readGsdProgress('')` would then try `path.join('', '.planning')` which resolves to `.planning` (relative to process cwd — a Next.js server directory).

**How to avoid:** Guard at the top of `readGsdProgress`: `if (!projectPath) return null`.

**Warning signs:** Strange `.planning` directory reads appearing to succeed or fail in the Next.js server root.

### Pitfall 4: `fs.readFileSync` Blocking the Event Loop

**What goes wrong:** `getActiveSessions()` is already `async` (uses readline streaming for `fullParseSession`). Adding synchronous `readFileSync` for STATE.md (called per session) adds blocking I/O in the same hot path.

**Why it happens:** STATE.md files are tiny (<5KB), so blocking reads are acceptable here. But if this assumption is wrong for some edge case, it blocks the Node.js event loop during the API response.

**How to avoid:** STATE.md files are indeed small (under 5KB always). Synchronous read is fine and keeps the code simple. Document the assumption with a comment. No async needed.

**Warning signs:** Slow API responses during polling when many sessions are active.

### Pitfall 5: ROADMAP.md Phase Name vs STATE.md Prose

**What goes wrong:** Phase name extracted from STATE.md prose ("Active Sessions Page") and phase name from ROADMAP.md ("Phase 2: Active Sessions Page") are redundant. Fetching ROADMAP.md for every active session on every 5-second poll is wasteful.

**Why it happens:** The CONTEXT.md mentions reading ROADMAP.md "for phase names if needed", implying it's a fallback, not the primary source.

**How to avoid:** Use the phase name from STATE.md prose first (the `Phase: N of M (Name)` line). Only fall back to ROADMAP.md if this regex fails. Given the STATE.md format is consistent, ROADMAP.md read is likely never needed in practice.

**Warning signs:** Extra file reads per session on every poll.

---

## Code Examples

Verified patterns from existing codebase and GSD tool source:

### GsdProgress Interface (types.ts addition)

```typescript
// Extends existing ActiveSessionInfo
export interface GsdProgress {
  isGsd: true;
  phaseName: string | null;        // "Active Sessions Page" — null if STATE.md unreadable
  phaseNumber: number | null;      // 2 — null if unreadable
  phaseStatus: string | null;      // "executing" | "complete" | "paused" — null if unreadable
  nextAction: string | null;       // "/gsd:execute-phase 2" — null if unreadable
  totalPhases: number | null;      // 3 — from progress.total_phases
  completedPhases: number | null;  // 1 — from progress.completed_phases
  percent: number | null;          // 33 — from progress.percent
}

// In ActiveSessionInfo (extend existing interface):
export interface ActiveSessionInfo {
  // ... all existing fields unchanged ...
  gsdProgress?: GsdProgress | null;  // null = non-GSD, GsdProgress with nulls = GSD but unreadable
}
```

### Full readGsdProgress Function Sketch

```typescript
// src/lib/claude-data/gsd-progress.ts
import * as fs from 'fs';
import * as path from 'path';
import type { GsdProgress } from './types';

const GSD_UNREADABLE: GsdProgress = {
  isGsd: true, phaseName: null, phaseNumber: null,
  phaseStatus: null, nextAction: null,
  totalPhases: null, completedPhases: null, percent: null,
};

export function readGsdProgress(projectPath: string): GsdProgress | null {
  if (!projectPath) return null;

  const planningDir = path.join(projectPath, '.planning');
  if (!fs.existsSync(planningDir)) return null;

  const stateMdPath = path.join(planningDir, 'STATE.md');
  if (!fs.existsSync(stateMdPath)) return GSD_UNREADABLE;

  let content: string;
  try {
    content = fs.readFileSync(stateMdPath, 'utf-8');
  } catch {
    return GSD_UNREADABLE;
  }

  try {
    // 1. Parse frontmatter
    const fm = parseFrontmatter(content);
    const progress = fm.progress as Record<string, number> | undefined;
    const totalPhases = progress?.total_phases ?? null;
    const completedPhases = progress?.completed_phases ?? null;
    const percent = progress?.percent ?? null;

    // 2. Extract phase number and name from "Phase: N of M (Name)" prose line
    const phaseMatch = content.match(/^Phase:\s*(\d+)\s+of\s+\d+\s*\(([^)]+)\)/m);
    if (!phaseMatch) return { ...GSD_UNREADABLE, totalPhases, completedPhases, percent };

    const phaseNumber = parseInt(phaseMatch[1], 10);
    const phaseName = phaseMatch[2].trim();

    // 3. Extract phase status from "Status: ..." prose line
    const statusMatch = content.match(/^Status:\s*(.+)$/m);
    const phaseStatus = statusMatch ? statusMatch[1].trim() : (fm.status as string | null) ?? null;

    // 4. Derive next action from phase number and status
    const nextAction = `/gsd:execute-phase ${phaseNumber}`;

    return { isGsd: true, phaseName, phaseNumber, phaseStatus, nextAction,
             totalPhases, completedPhases, percent };
  } catch {
    return GSD_UNREADABLE;
  }
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  let currentNested: Record<string, unknown> | null = null;
  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue;
    const nested = line.match(/^\s{2}([a-z_]+):\s*(.*)/);
    if (nested && currentNested) {
      const v = nested[2].trim().replace(/^["']|["']$/g, '');
      currentNested[nested[1]] = isNaN(Number(v)) || v === '' ? v : Number(v);
      continue;
    }
    const top = line.match(/^([a-z_]+):\s*(.*)/);
    if (top) {
      const v = top[2].trim().replace(/^["']|["']$/g, '');
      if (v === '') { currentNested = {}; result[top[1]] = currentNested; }
      else { currentNested = null; result[top[1]] = isNaN(Number(v)) || v === '' ? v : Number(v); }
    }
  }
  return result;
}
```

### Integration in getActiveSessions()

```typescript
// src/lib/claude-data/active-sessions.ts — addition inside the results.push() block
import { readGsdProgress } from './gsd-progress';

// In the per-session loop, after projectPath is resolved:
const gsdProgress = readGsdProgress(projectPath) ?? null;

results.push({
  // ... existing fields ...
  gsdProgress,
});
```

### Card Header GSD Badge

```tsx
{/* In CardHeader, after project name span */}
{session.gsdProgress?.isGsd && (
  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 ml-1 font-mono">
    GSD
  </Badge>
)}
```

### Card GSD Section

```tsx
{/* Below existing CardContent in the card JSX */}
{session.gsdProgress?.isGsd && session.gsdProgress.phaseName && (
  <CardContent className="pt-0">
    <Separator className="mb-2" />
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex items-start justify-between gap-2">
        <span className="truncate">
          Phase {session.gsdProgress.phaseNumber}: {session.gsdProgress.phaseName}
        </span>
        {session.gsdProgress.percent !== null && (
          <span className="shrink-0 font-mono text-[10px]">{session.gsdProgress.percent}%</span>
        )}
      </div>
      {session.gsdProgress.nextAction && (
        <div className="font-mono text-[10px] text-primary/70 truncate">
          {session.gsdProgress.nextAction}
        </div>
      )}
    </div>
  </CardContent>
)}
```

---

## STATE.md Format Reference

Verified against this project's `.planning/STATE.md` (the canonical source of truth for what we're parsing):

```
---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: completed              ← MILESTONE status, not phase status
stopped_at: Phase 3 context gathered
last_updated: "2026-03-18T18:54:59.523Z"
last_activity: 2026-03-18 — ...
progress:
  total_phases: 3              ← key field
  completed_phases: 2          ← key field
  total_plans: 6
  completed_plans: 6
  percent: 50                  ← key field
---

## Current Position

Phase: 2 of 3 (Active Sessions Page)  ← parse phaseNumber + phaseName here
Plan: 3 of 3 in current phase
Status: Phase 2 complete — ready for Phase 3  ← parse phaseStatus here
```

**Key parsing observations (HIGH confidence — verified against real file):**
- Frontmatter delimited by `---\n` ... `\n---`
- `progress:` is a nested block with 2-space indent on children
- Quoted values (e.g., `last_updated: "2026-03-18..."`) include surrounding quotes — strip them
- `percent` is a bare integer (not quoted)
- Prose "Phase: N of M (Name)" line is in the `## Current Position` section, always on its own line
- Prose "Status:" line follows immediately after
- Top-level `status` is milestone-level, not phase-level

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest + ts-jest (configured in `jest.config.js`) |
| Config file | `/mnt/c/SourceControl/GitHub/Claud-ometer/jest.config.js` |
| Quick run command | `npm test -- --testPathPattern=gsd-progress` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GSD-01 | `readGsdProgress` returns phaseName + phaseStatus from valid STATE.md | unit | `npm test -- --testPathPattern=gsd-progress -t "parses valid STATE.md"` | ❌ Wave 0 |
| GSD-01 | `readGsdProgress` returns GSD_UNREADABLE when STATE.md is malformed | unit | `npm test -- --testPathPattern=gsd-progress -t "malformed STATE.md"` | ❌ Wave 0 |
| GSD-02 | `readGsdProgress` returns correct nextAction string | unit | `npm test -- --testPathPattern=gsd-progress -t "nextAction"` | ❌ Wave 0 |
| GSD-03 | `readGsdProgress` returns null when no .planning/ directory | unit | `npm test -- --testPathPattern=gsd-progress -t "no planning dir"` | ❌ Wave 0 |
| GSD-03 | `readGsdProgress` returns null when projectPath is empty string | unit | `npm test -- --testPathPattern=gsd-progress -t "empty projectPath"` | ❌ Wave 0 |
| GSD-03 | `readGsdProgress` returns GSD_UNREADABLE when STATE.md absent but .planning/ exists | unit | `npm test -- --testPathPattern=gsd-progress -t "planning dir no state"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern=gsd-progress`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/lib/gsd-progress.test.ts` — covers GSD-01, GSD-02, GSD-03
- [ ] No framework gaps — Jest + ts-jest already installed and configured

---

## Open Questions

1. **`stopped_at` vs prose "Status:" for phaseStatus**
   - What we know: `stopped_at` contains free-text like "Phase 3 context gathered"; prose "Status:" contains a sentence like "Phase 2 complete — ready for Phase 3"
   - What's unclear: Which is more reliably machine-readable for deriving a short `phaseStatus` label?
   - Recommendation: Use the prose "Status:" line as the raw `phaseStatus` string (it's human-readable and short enough to display as-is, truncated). Don't try to parse it into a structured enum — just show it verbatim.

2. **Progress bar vs text for percent**
   - What we know: `percent` is available (e.g., 50)
   - What's unclear: User preference for visual (bar vs text vs both)
   - Recommendation: Text percentage (`50%`) is Claude's discretion. A simple `text-[10px] font-mono` number is sufficient. A progress bar requires layout space and adds visual weight — use text only unless it looks sparse after implementation.

---

## Sources

### Primary (HIGH confidence)
- `/mnt/c/SourceControl/GitHub/Claud-ometer/.planning/STATE.md` — verified real STATE.md format and field names
- `/mnt/c/SourceControl/GitHub/Claud-ometer/src/lib/claude-data/active-sessions.ts` — verified existing `getActiveSessions()` structure, `projectPath` availability
- `/mnt/c/SourceControl/GitHub/Claud-ometer/src/lib/claude-data/types.ts` — verified `ActiveSessionInfo` interface shape
- `/mnt/c/SourceControl/GitHub/Claud-ometer/src/app/active/page.tsx` — verified card JSX structure and existing Separator/Badge usage
- `/home/rfelix/.claude/get-shit-done/bin/lib/frontmatter.cjs` — verified GSD's own regex-based frontmatter parser approach
- `/mnt/c/SourceControl/GitHub/Claud-ometer/jest.config.js` — verified test framework and `testEnvironment: node`
- `/mnt/c/SourceControl/GitHub/Claud-ometer/src/__tests__/lib/active-sessions.test.ts` — verified test patterns and mock approach

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONVENTIONS.md` — verified naming patterns, import order, error handling conventions
- `.planning/codebase/TESTING.md` — verified test structure patterns (co-location, mock approach)
- `.planning/phases/03-gsd-integration/03-CONTEXT.md` — all locked decisions from user discussion

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed, verified in package.json
- Architecture: HIGH — based on direct inspection of all files to be modified
- Frontmatter parsing: HIGH — verified against real STATE.md + GSD tool source
- Phase name regex: HIGH — tested against actual STATE.md prose format
- Pitfalls: HIGH — derived from direct code inspection, not guesses

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable — no external dependencies)
