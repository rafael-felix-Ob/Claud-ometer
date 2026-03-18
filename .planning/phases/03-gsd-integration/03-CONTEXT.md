# Phase 3: GSD Integration - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add GSD build progress information to active session cards. Sessions running in GSD-managed projects show current phase name, status, and next action. Non-GSD sessions show nothing extra. GSD data updates with each 5-second poll.

</domain>

<decisions>
## Implementation Decisions

### GSD Info Placement
- New row below the existing card content (tokens/model/branch), separated by a thin Separator
- Shows: phase name + status + next GSD command
- Format example: "Phase 2: Active Sessions Page • Executing • Next: /gsd:execute-phase 2"
- Small "GSD" badge displayed near the project name in the card header to signal this is a GSD-managed project

### GSD Data Source
- Read from `{projectPath}/.planning/STATE.md` for each active session
- Parse YAML frontmatter for: `status`, `progress.total_phases`, `progress.completed_phases`, `progress.percent`
- Parse prose sections for: current phase name, stopped-at info
- Read from `{projectPath}/.planning/ROADMAP.md` for phase names if needed
- All file reads guarded with `existsSync` — never throw on missing files

### Non-GSD Session Handling
- No `.planning/` directory → show nothing at all. Card looks exactly like Phase 2 output. No placeholder, no indicator.
- `.planning/` exists but `STATE.md` is missing or malformed → show "GSD" badge near project name only, no progress info section. Signals it's GSD-managed but state is unreadable.

### GSD Progress Updates
- GSD state is read server-side in the API route alongside the existing `getActiveSessions()` call
- New field on `ActiveSessionInfo`: optional `gsdProgress` object (or null)
- `gsdProgress` contains: `phaseName`, `phaseNumber`, `phaseStatus`, `nextAction`, `totalPhases`, `completedPhases`, `percent`
- Data refreshes with each 5-second poll — no separate polling needed

### Claude's Discretion
- Exact styling/colors for the GSD progress section
- How to truncate long phase names
- Progress bar visual (if used alongside text)
- Separator style between main card content and GSD section

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Detection Engine
- `src/lib/claude-data/active-sessions.ts` — `getActiveSessions()` function to extend with GSD data
- `src/lib/claude-data/types.ts` — `ActiveSessionInfo` type to extend with `gsdProgress` field

### Phase 2 Active Sessions Page
- `src/app/active/page.tsx` — Card rendering to extend with GSD section
- `src/app/api/active-sessions/route.ts` — API route (may need to pass GSD data through)

### GSD File Structure
- `.planning/STATE.md` — YAML frontmatter with milestone, status, progress fields; prose with current phase and decisions
- `.planning/ROADMAP.md` — Phase list with names, goals, completion status

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Separator` component from shadcn/ui — for dividing GSD section from card content
- `Badge` component — for the "GSD" indicator badge
- `ActiveSessionInfo.projectPath` — filesystem path to locate `.planning/` directory
- Existing card layout in `page.tsx` — additive GSD section below current content

### Established Patterns
- `existsSync` guards on all filesystem reads (from reader.ts pattern)
- YAML frontmatter parsing — STATE.md uses `---` delimited frontmatter
- Optional fields on types — `gsdProgress?: GsdProgress | null`

### Integration Points
- Extend `ActiveSessionInfo` type with optional `gsdProgress` field
- Extend `getActiveSessions()` or create helper to read GSD state per session
- Extend card JSX in `page.tsx` to conditionally render GSD section

</code_context>

<specifics>
## Specific Ideas

- "GSD" badge should be visually distinct but small — not competing with the status badge
- The next action should show the actual GSD command (e.g., `/gsd:execute-phase 2`) so the user knows what to run
- Progress section should feel like a natural extension of the card, not a separate widget

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-gsd-integration*
*Context gathered: 2026-03-18*
