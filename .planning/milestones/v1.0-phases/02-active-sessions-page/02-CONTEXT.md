# Phase 2: Active Sessions Page - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

API route, SWR hook with 5-second polling, card grid UI at /active, sidebar navigation entry, and all session display requirements (DISP-01 to DISP-06, UI-01 to UI-07). Users navigate to /active and see live-updating session cards with status, duration, tokens, project context, and model info.

</domain>

<decisions>
## Implementation Decisions

### Card Layout & Density
- 2 cards per row grid (`grid grid-cols-2 gap-4`)
- Project name as card title, status badge alongside in the header
- Duration displayed prominently below project name
- Token display: combined total + estimated USD cost (e.g., "1.2M tokens • $4.32")
- Model shown as colored badge using existing `getModelColor()` (orange=Opus, blue=Sonnet, green=Haiku)
- Git branch displayed with `font-mono` styling
- Per-card "last activity" timestamp (e.g., "Active 2s ago")

### Status Visual Treatment
- **Working:** Green pulse dot (CSS `animate-pulse`) + "Working" text badge. Green left border on card.
- **Waiting:** Amber/yellow static dot + "Waiting" text badge. Amber left border on card.
- **Idle:** Gray dot + "Idle" text. Gray left border. Card content slightly muted.
- All cards have a thin colored left border matching their status color for scannability.
- Cards ordered: working first, waiting second, idle last.

### Card Interaction
- Click to expand card in-place (not navigate away)
- Expanded card shows last 3-5 conversation messages (user/assistant turns) + "View full session" link to /sessions/[id]
- Hover: subtle lift effect (shadow increase + slight scale)
- Expansion needs to fetch session detail on demand (use existing `/api/sessions/[id]` endpoint)

### Page Header
- Title: "Active Sessions (N)" where N is the count of detected sessions
- Subtitle: "Updated Xs ago" showing freshness of last successful poll
- Loading state: existing spinner pattern from dashboard page

### Empty & Edge States
- Empty state: friendly message "No active sessions" with brief explanation + link to /sessions for history
- Imported data mode: warning banner at top "Live monitoring unavailable in imported data mode" + empty state below (don't attempt detection on imported data)
- Loading: centered spinner (same pattern as dashboard page)

### Sidebar Navigation
- Add entry to `navItems` array in `sidebar.tsx`
- Position: between "Overview" and "Projects" (second in the list)
- Icon: `Activity` from lucide-react (already imported in sidebar but unused!)
- Label: "Active"
- href: "/active"

### Claude's Discretion
- Exact spacing/padding within cards
- Animation duration for pulse effect
- How to truncate long project names or branch names
- Transition animation for card expand/collapse
- How many messages to show in expanded view (3-5 range)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Detection Engine
- `.planning/01-CONTEXT.md` — Locked decisions on thresholds, status algorithm, data structure (ActiveSessionInfo fields)
- `src/lib/claude-data/active-sessions.ts` — Implementation of `getActiveSessions()`, `ACTIVE_SESSION_CONFIG`
- `src/lib/claude-data/types.ts` — `ActiveSessionInfo` and `SessionStatus` type definitions

### Existing UI Patterns
- `src/app/page.tsx` — Dashboard page pattern: loading state, stat cards, grid layout
- `src/components/layout/sidebar.tsx` — Navigation structure, `navItems` array, active state styling
- `src/components/cards/stat-card.tsx` — Reusable card component pattern
- `src/lib/hooks.ts` — SWR hook pattern (`useSWR<Type>(url, fetcher)`)

### Styling & Components
- `src/app/globals.css` — CSS variables for theme colors
- `src/lib/format.ts` — `formatTokens`, `formatCost`, `formatDuration`, `timeAgo` utilities
- `src/config/pricing.ts` — `getModelDisplayName()`, `getModelColor()` for model badges

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StatCard` component: for summary stats at top of page (session count, total tokens, etc.)
- `Badge` component: for status badges and model indicators
- `Card/CardHeader/CardContent`: shadcn card components for session cards
- `formatTokens()`, `formatCost()`, `formatDuration()`, `timeAgo()`: all formatting utilities needed
- `getModelDisplayName()`, `getModelColor()`: model badge content and color
- `Activity` icon: already imported in sidebar.tsx but unused — perfect for the nav entry

### Established Patterns
- SWR hooks: `useSWR<Type>(url, fetcher)` with error-throwing fetcher
- Page structure: `'use client'` → hook call → loading check → content render
- Card styling: `border-border/50 shadow-sm` with `CardHeader` + `CardContent`
- API routes: `export const dynamic = 'force-dynamic'` → call reader function → `NextResponse.json()`
- Grid layout: `grid grid-cols-N gap-4` pattern

### Integration Points
- New API route: `src/app/api/active-sessions/route.ts` calls `getActiveSessions()`
- New SWR hook: `useActiveSessions()` in `src/lib/hooks.ts` with `refreshInterval: 5000`
- New page: `src/app/active/page.tsx`
- Sidebar: add entry to `navItems` array in `sidebar.tsx`
- Session detail: reuse existing `/api/sessions/[id]` for expanded card content

</code_context>

<specifics>
## Specific Ideas

- Cards should expand in-place showing last few messages — not navigate away. This keeps the at-a-glance view intact while allowing quick inspection.
- "View full session" link at the bottom of expanded card goes to existing /sessions/[id] page.
- Green/amber/gray color scheme for status mirrors common CI/CD dashboard patterns (passing/warning/inactive).
- Left border color accent is subtle but highly scannable — borrowed from GitHub PR status indicators.

</specifics>

<deferred>
## Deferred Ideas

- Token velocity indicator (tokens/minute) — Phase 1 deferred this to v2
- Active session count badge on sidebar nav icon — v2 requirement ADV-03
- Configurable idle threshold via UI settings — v2 requirement ADV-02

</deferred>

---

*Phase: 02-active-sessions-page*
*Context gathered: 2026-03-18*
