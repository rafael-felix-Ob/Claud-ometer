# Phase 2: Active Sessions Page - Research

**Researched:** 2026-03-18
**Domain:** Next.js App Router page + SWR polling + React state for card expand/collapse + shadcn/ui card grid
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Card Layout & Density**
- 2 cards per row grid (`grid grid-cols-2 gap-4`)
- Project name as card title, status badge alongside in the header
- Duration displayed prominently below project name
- Token display: combined total + estimated USD cost (e.g., "1.2M tokens • $4.32")
- Model shown as colored badge using existing `getModelColor()` (orange=Opus, blue=Sonnet, green=Haiku)
- Git branch displayed with `font-mono` styling
- Per-card "last activity" timestamp (e.g., "Active 2s ago")

**Status Visual Treatment**
- Working: Green pulse dot (CSS `animate-pulse`) + "Working" text badge. Green left border on card.
- Waiting: Amber/yellow static dot + "Waiting" text badge. Amber left border on card.
- Idle: Gray dot + "Idle" text. Gray left border. Card content slightly muted.
- All cards have a thin colored left border matching their status color for scannability.
- Cards ordered: working first, waiting second, idle last.

**Card Interaction**
- Click to expand card in-place (not navigate away)
- Expanded card shows last 3-5 conversation messages (user/assistant turns) + "View full session" link to /sessions/[id]
- Hover: subtle lift effect (shadow increase + slight scale)
- Expansion needs to fetch session detail on demand (use existing `/api/sessions/[id]` endpoint)

**Page Header**
- Title: "Active Sessions (N)" where N is the count of detected sessions
- Subtitle: "Updated Xs ago" showing freshness of last successful poll
- Loading state: existing spinner pattern from dashboard page

**Empty & Edge States**
- Empty state: friendly message "No active sessions" with brief explanation + link to /sessions for history
- Imported data mode: warning banner at top "Live monitoring unavailable in imported data mode" + empty state below (don't attempt detection on imported data)
- Loading: centered spinner (same pattern as dashboard page)

**Sidebar Navigation**
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

### Deferred Ideas (OUT OF SCOPE)
- Token velocity indicator (tokens/minute) — Phase 1 deferred this to v2
- Active session count badge on sidebar nav icon — v2 requirement ADV-03
- Configurable idle threshold via UI settings — v2 requirement ADV-02
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISP-01 | User can view active session duration | `ActiveSessionInfo.duration` (ms) ready; use `formatDuration()` |
| DISP-02 | User can view consumed tokens per active session | `totalInputTokens + totalOutputTokens + cache tokens` available on `ActiveSessionInfo`; use `formatTokens()` and `formatCost()` |
| DISP-03 | User can view project name and path for each active session | `ActiveSessionInfo.projectName` and `projectPath` populated by `getActiveSessions()` |
| DISP-04 | User can view git branch for each active session | `ActiveSessionInfo.gitBranch` populated from tail-read messages |
| DISP-05 | User can view which Claude model each active session is using | `ActiveSessionInfo.model` (last used) and `models[]` available; use `getModelDisplayName()` / `getModelColor()` |
| DISP-06 | User can click through to full session detail at /sessions/[id] | Existing `/sessions/[id]` page exists; link from expanded card |
| UI-01 | Dedicated /active page with card grid layout | New file `src/app/active/page.tsx` |
| UI-02 | Sidebar navigation entry with Activity icon | Edit `navItems` in `sidebar.tsx`; `Activity` icon already imported |
| UI-03 | Cards auto-refresh every 5 seconds with last-updated indicator | SWR `refreshInterval: 5000`; track `lastUpdated` state in component |
| UI-04 | Animated pulse indicator on "working" status sessions | Tailwind `animate-pulse` on dot element; no extra dependencies |
| UI-05 | Cards ordered by status: working first, waiting second, idle last | Sort on client: `['working','waiting','idle'].indexOf(s.status)` |
| UI-06 | Empty state displayed when no active sessions detected | Render empty state block when `sessions.length === 0` and not loading |
| UI-07 | Banner displayed when using imported data mode | Reuse `useDataSource` / `/api/data-source` pattern already present in sidebar |
</phase_requirements>

---

## Summary

Phase 2 is entirely a UI/API layer over Phase 1's `getActiveSessions()` engine. All data shapes (`ActiveSessionInfo`, `SessionStatus`) and detection logic are already implemented and tested. The phase adds three artifacts: an API route that calls `getActiveSessions()`, a SWR hook with 5-second polling, and the `/active` page with its card grid.

The trickiest part of this phase is the **in-place card expansion** pattern. Expanding a card fetches `SessionDetail` from the existing `/api/sessions/[id]` endpoint and renders the last few messages inline. This requires local `useState` to track which card is expanded, and conditional rendering within the card. The expand/collapse must not trigger navigation or page-level state changes.

The **"Updated Xs ago" indicator** is the second interesting piece: SWR's `mutate` fires on each successful revalidation but does not expose a "last successful fetch time" directly. The correct approach is to track a `lastUpdated` timestamp in a `useEffect` that fires whenever the SWR `data` reference changes, then display that timestamp using `timeAgo()`.

**Primary recommendation:** Build the API route first, then the SWR hook, then the page bottom-up (summary stats row, then card grid, then card expansion, then empty/imported states). Each layer is independently testable.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 16.1.6 (in use) | Page routing and API routes | Already project framework |
| SWR | 2.4.0 (in use) | Data fetching + polling | Already used for all hooks; `refreshInterval` option built-in |
| React | 19.2.3 (in use) | Component state (expand/collapse) | Project standard |
| Tailwind CSS v4 | in use | `animate-pulse`, border colors, hover effects | Project standard |
| shadcn/ui | in use | Card, Badge components | Project standard |
| Lucide React | 0.575.0 (in use) | `Activity` icon (already imported in sidebar), `GitBranch`, `Clock` | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | 4.1.0 (in use) | Date formatting (if needed) | `timeAgo()` in format.ts covers all current needs; skip direct date-fns import |
| `src/lib/format.ts` | local | `formatTokens`, `formatCost`, `formatDuration`, `timeAgo` | All duration/token/cost display on cards |
| `src/config/pricing.ts` | local | `getModelDisplayName`, `getModelColor` | Model badge content and color |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SWR `refreshInterval` | `setInterval` manual fetch | SWR handles dedupe, focus revalidation, error state automatically — do not hand-roll |
| CSS `animate-pulse` | JS-driven animation library | Tailwind built-in, zero runtime cost |
| In-place card expand | Navigate to /sessions/[id] | User decided: keep at-a-glance grid intact during inspection |

**Installation:** No new packages required. All dependencies already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── active/
│   │   └── page.tsx              # /active page — 'use client', card grid
│   └── api/
│       └── active-sessions/
│           └── route.ts          # GET — ActiveSessionInfo[]
├── lib/
│   └── hooks.ts                  # Add useActiveSessions() here (existing file)
```

No new component files are needed. The session cards are self-contained within `page.tsx` using inline sub-components or local functions. If the card component grows complex (>80 lines), extract to `src/components/cards/active-session-card.tsx`.

### Pattern 1: API Route for Active Sessions
**What:** `force-dynamic` route that calls `getActiveSessions()` and guards imported data mode
**When to use:** Any time filesystem-read data is served over HTTP

```typescript
// src/app/api/active-sessions/route.ts
import { NextResponse } from 'next/server';
import { getActiveSessions } from '@/lib/claude-data/active-sessions';
import { getActiveDataSource } from '@/lib/claude-data/data-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Return empty array for imported data mode — detection requires live filesystem
  if (getActiveDataSource() === 'imported') {
    return NextResponse.json([]);
  }
  try {
    const sessions = await getActiveSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch active sessions' }, { status: 500 });
  }
}
```

### Pattern 2: SWR Hook with Polling
**What:** Hook with `refreshInterval: 5000` added to `src/lib/hooks.ts`
**When to use:** Any data that needs periodic refresh without user interaction

```typescript
// Addition to src/lib/hooks.ts
import type { ActiveSessionInfo } from '@/lib/claude-data/types';

export function useActiveSessions() {
  return useSWR<ActiveSessionInfo[]>('/api/active-sessions', fetcher, {
    refreshInterval: 5000,
  });
}
```

### Pattern 3: Last-Updated Tracking
**What:** Track wall-clock time of last successful SWR data delivery; display as "Updated Xs ago"
**When to use:** Any polling hook that needs a freshness indicator

```typescript
// Inside the page component
const { data: sessions, isLoading } = useActiveSessions();
const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

useEffect(() => {
  if (sessions !== undefined) {
    setLastUpdated(new Date());
  }
}, [sessions]);

// Render: lastUpdated ? `Updated ${timeAgo(lastUpdated.toISOString())}` : 'Loading...'
```

Note: `sessions` reference changes on every successful poll, so the effect fires correctly. The `timeAgo()` display will show "just now" immediately after each 5-second poll resolves.

### Pattern 4: In-Place Card Expansion
**What:** Local `expandedId` state; clicking a card sets/clears it; expanded state fetches `SessionDetail`
**When to use:** Show supplementary detail without leaving the current view

```typescript
const [expandedId, setExpandedId] = useState<string | null>(null);

// Per card:
const isExpanded = expandedId === session.id;
const handleClick = () => setExpandedId(isExpanded ? null : session.id);
```

The expanded section uses `useSessionDetail(expandedId ?? '')` — but only renders when `expandedId` matches. Because `useSessionDetail` is called unconditionally (hooks rules), pass an empty string when no card is expanded and skip rendering when `expandedId` is null.

**Alternative:** Use a child component `<ExpandedCardDetail sessionId={id} />` that calls `useSessionDetail` internally. This avoids the "dummy call with empty string" hack and is the cleaner approach. The child only mounts when the card is expanded.

### Pattern 5: Status Sort Order
**What:** Client-side sort of `ActiveSessionInfo[]` before rendering
**When to use:** Whenever status ordering is needed

```typescript
const STATUS_ORDER: Record<string, number> = { working: 0, waiting: 1, idle: 2 };

const sorted = [...(sessions || [])].sort(
  (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)
);
```

### Pattern 6: Status Visual Encoding
**What:** Map `SessionStatus` to Tailwind classes for dot color, border, badge, and content muting

```typescript
const STATUS_CONFIG = {
  working: {
    dot: 'bg-green-500 animate-pulse',
    border: 'border-l-green-500',
    badge: 'bg-green-500/10 text-green-600 border-green-500/30',
    label: 'Working',
  },
  waiting: {
    dot: 'bg-amber-500',
    border: 'border-l-amber-500',
    badge: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    label: 'Waiting',
  },
  idle: {
    dot: 'bg-muted-foreground/40',
    border: 'border-l-border',
    badge: 'bg-secondary text-muted-foreground',
    label: 'Idle',
  },
} as const;
```

### Anti-Patterns to Avoid
- **Fetching session detail at page level for all cards:** Fetches N sessions' worth of detail on every poll. Use on-demand fetch only for the expanded card.
- **Using `setInterval` for polling:** SWR's `refreshInterval` handles deduplication, focus revalidation, and error handling. Do not bypass it.
- **Navigating on card click:** User locked decision is in-place expand, not navigation. Keep `onClick` on the card div, not a `<Link>` wrapper.
- **Calling `useSessionDetail` conditionally:** Violates React hooks rules. Always call the hook but conditionally render the output.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 5-second polling | `setInterval` + `fetch` | SWR `refreshInterval: 5000` | Focus revalidation, error state, deduplication built-in |
| Token display | Format function | `formatTokens()` in `format.ts` | Already handles B/M/K suffixes |
| Cost display | Format function | `formatCost()` in `format.ts` | Already handles $0.0001 to $1K+ |
| Duration display | Format function | `formatDuration()` in `format.ts` | Already handles h/m/s |
| "X ago" display | Manual date math | `timeAgo()` in `format.ts` | Already handles s/m/h/d/w/mo |
| Model name/color | Switch statement | `getModelDisplayName()` / `getModelColor()` in `pricing.ts` | Already maps model IDs to display names and hex colors |
| Imported data check | Re-read data-source | Fetch `/api/data-source` via SWR (already in sidebar) or check API route server-side | Pattern established in `data-source.ts` |

**Key insight:** Every display utility this phase needs already exists in `format.ts` and `pricing.ts`. The page's job is composition, not computation.

---

## Common Pitfalls

### Pitfall 1: Token Total Calculation
**What goes wrong:** Displaying `totalInputTokens` alone misrepresents cost; users expect "total tokens" to mean the combined number they'd see in a receipt.
**Why it happens:** `ActiveSessionInfo` separates input/output/cache tokens for accurate cost calculation, but the display label "tokens" implies a single combined number.
**How to avoid:** Compute combined total for display: `totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens`. Use `estimatedCost` directly for the cost part (already computed by `calculateCost()` in the detection engine).
**Warning signs:** Displayed token count is suspiciously low compared to what users see in Claude's interface.

### Pitfall 2: "Updated Xs ago" Staying Stale
**What goes wrong:** The "updated X seconds ago" label says "2m ago" even when data refreshes every 5 seconds.
**Why it happens:** If `lastUpdated` state is set only once on mount (e.g., in a `useEffect([])`) rather than responding to data changes.
**How to avoid:** Use `useEffect(() => { if (sessions !== undefined) setLastUpdated(new Date()); }, [sessions])`. SWR returns a new `sessions` reference on each successful fetch, triggering the effect reliably.
**Warning signs:** The subtitle text is always stale relative to the actual poll cadence.

### Pitfall 3: Expand/Collapse with Hook Rules
**What goes wrong:** Calling `useSessionDetail(expandedId || '')` at the page level with an empty string causes an API call to `/api/sessions/` (with no ID) every 5 seconds even when no card is expanded.
**Why it happens:** SWR fetches when the key is truthy. An empty string is falsy — actually SWR treats falsy keys as "disabled". So `useSWR('')` is fine and makes no request. However the empty string may not produce a falsy key depending on SWR version.
**How to avoid:** Use `useSWR<SessionDetail>(expandedId ? /api/sessions/${expandedId} : null, fetcher)`. Passing `null` as the key explicitly disables the hook. Better yet, extract an `<ExpandedDetail sessionId={id} />` component that calls `useSessionDetail` internally and only mounts when a card is expanded.
**Warning signs:** Network tab shows requests to `/api/sessions/` (empty path) or 404 errors every 5 seconds.

### Pitfall 4: Left Border with shadcn Card
**What goes wrong:** Setting `border-l-green-500` has no visible effect because the shadcn `Card` component uses `rounded-xl` which clips the border.
**Why it happens:** The Card component applies `rounded-xl` via its base styles. A flat left border on a fully-rounded card is invisible at the corners.
**How to avoid:** Use `border-l-4` with the card's `className` prop. The left border is thick enough to show through the rounded corner. Example: `<Card className="border-l-4 border-l-green-500 border-border/50 shadow-sm">`. Alternatively, use `rounded-l-none` on the left side only, but that conflicts with the card's visual style.
**Warning signs:** Status color doesn't appear on the left edge of cards in the rendered UI.

### Pitfall 5: Imported Data Mode Banner Showing Incorrectly
**What goes wrong:** The warning banner appears on the live data path, or the page attempts detection even in imported mode.
**Why it happens:** The data source check is done client-side from the SWR hook response, which may have a brief delay on mount. If not handled carefully, the banner may flicker or show briefly before the source is known.
**How to avoid:** The API route already handles this server-side — it returns `[]` when `getActiveDataSource() === 'imported'`. Client-side, add a separate `useDataSource()` hook or reuse the same `/api/data-source` fetch already present in `sidebar.tsx`. Show the banner based on `sourceInfo?.active === 'imported'`, using the same pattern the sidebar uses.
**Warning signs:** Banner appears briefly on live mode, or page shows "No active sessions" without the explanation banner when in imported mode.

### Pitfall 6: Model Color as Inline Style
**What goes wrong:** `getModelColor()` returns a hex string (`'#D4764E'`). Applying it directly as a Tailwind class (`text-[#D4764E]`) can fail in Tailwind v4 with JIT if the value is dynamically generated at runtime.
**Why it happens:** Tailwind purges classes it cannot statically detect. Dynamic class construction defeats the purge.
**How to avoid:** Apply as inline style: `style={{ color: getModelColor(session.model) }}` on the badge span. The existing dashboard code in `page.tsx` uses `Badge variant="secondary"` with custom className — prefer `style` prop for dynamic colors.
**Warning signs:** Model badge text has no color in production build even though it works in dev.

---

## Code Examples

Verified patterns from existing codebase:

### Loading Spinner (from src/app/page.tsx)
```typescript
// Same pattern used across dashboard, sessions, projects pages
if (isLoading || !sessions) {
  return (
    <div className="flex h-[80vh] items-center justify-center">
      <div className="space-y-3 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
```

### Existing API Route Pattern (from src/app/api/stats/route.ts)
```typescript
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await someReaderFunction();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}
```

### Sidebar navItems Structure (from src/components/layout/sidebar.tsx)
```typescript
// Current array — Activity icon is imported but not yet used
const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  // INSERT HERE: { href: '/active', label: 'Active', icon: Activity },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare },
  { href: '/costs', label: 'Costs', icon: DollarSign },
  { href: '/data', label: 'Data', icon: Database },
];
```

### Imported Data Banner Pattern (from src/components/layout/sidebar.tsx)
```typescript
// Reuse this source-check pattern for the imported data banner
const { data: sourceInfo } = useSWR('/api/data-source', fetcher, { refreshInterval: 5000 });
const isImported = sourceInfo?.active === 'imported';
```

### Token Total for Display
```typescript
// ActiveSessionInfo has separate token fields — combine for display
const totalTokens = session.totalInputTokens
  + session.totalOutputTokens
  + session.totalCacheReadTokens
  + session.totalCacheWriteTokens;

// Display: "1.2M tokens • $4.32"
const tokenDisplay = `${formatTokens(totalTokens)} tokens • ${formatCost(session.estimatedCost)}`;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WebSocket/SSE for live updates | SWR polling at 5s | Project decision at design | Simpler, stateless API routes work correctly |
| Full JSONL re-parse on every poll | Tail-read + token cache (Phase 1) | Phase 1 complete | Fast polls; full parse runs once per session lifetime |
| Navigate to session on click | In-place card expand | User decision Phase 2 | Keeps at-a-glance grid intact |

**Deprecated/outdated:**
- `Activity` icon import in `sidebar.tsx` is currently unused — this phase activates it.

---

## Open Questions

1. **Token count semantics: "recent" vs "full session"**
   - What we know: Phase 1 STATE.md flagged this: "tail-read yields tokens from last N messages, not full session total. Validate label 'recent tokens' before Phase 2 ships."
   - What's unclear: `getActiveSessions()` uses `fullParseSession` on first detection and accumulates from tail-read on subsequent polls. The implementation accumulates tokens additively. Whether this yields a true session total or an over/under-count depends on whether `updateCacheFromTailRead` double-counts tokens already seen in the full parse.
   - Recommendation: The planner should include a verification task that tests token count accuracy across multiple polls against a known JSONL file. The label should say "session tokens" only if the full-parse strategy is confirmed accurate; otherwise use "recent tokens."

2. **`animate-pulse` duration in Tailwind v4**
   - What we know: Tailwind v4 is in use. The `animate-pulse` utility exists in all Tailwind versions.
   - What's unclear: Whether custom animation duration (e.g., `[animation-duration:1.5s]`) works with Tailwind v4 JIT arbitrary value syntax.
   - Recommendation: Use `animate-pulse` as-is (default 2s). If a different cadence is desired, add a custom `@keyframes` to `globals.css`. Avoid arbitrary `[animation-duration:...]` values until tested.

3. **Card component `gap-6` default spacing**
   - What we know: The shadcn `Card` component has `gap-6` in its base class (`flex flex-col gap-6`). This creates significant vertical space between `CardHeader` and `CardContent`.
   - What's unclear: Whether this gap is appropriate for the denser active session cards compared to the stat cards elsewhere.
   - Recommendation: Override with `gap-3` or `gap-2` in the card `className` prop for the active session cards, since they need to be more compact. This is Claude's discretion (exact spacing).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.3.0 + ts-jest 29.4.6 |
| Config file | `jest.config.js` (exists) |
| Quick run command | `npm test -- --testPathPattern=active-sessions` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISP-01 | Duration formatted correctly from ms | unit | `npm test -- --testPathPattern=active-page` | ❌ Wave 0 |
| DISP-02 | Token total computed from all four fields + cost formatted | unit | `npm test -- --testPathPattern=active-page` | ❌ Wave 0 |
| DISP-03 | Project name/path from `ActiveSessionInfo` rendered | unit | `npm test -- --testPathPattern=active-page` | ❌ Wave 0 |
| DISP-04 | Git branch rendered with font-mono | unit | `npm test -- --testPathPattern=active-page` | ❌ Wave 0 |
| DISP-05 | Model badge shows display name and color | unit | `npm test -- --testPathPattern=active-page` | ❌ Wave 0 |
| DISP-06 | "View full session" link points to /sessions/[id] | unit | `npm test -- --testPathPattern=active-page` | ❌ Wave 0 |
| UI-01 | Page renders card grid with sessions | manual-only | — | N/A (React rendering requires browser or jsdom setup not in project) |
| UI-02 | Sidebar navItems includes Active entry at position 1 | unit | `npm test -- --testPathPattern=sidebar` | ❌ Wave 0 |
| UI-03 | SWR hook configured with refreshInterval: 5000 | unit | `npm test -- --testPathPattern=hooks` | ❌ Wave 0 |
| UI-04 | Working status cards include animate-pulse class | manual-only | — | N/A |
| UI-05 | Sort order: working < waiting < idle | unit | `npm test -- --testPathPattern=active-page` | ❌ Wave 0 |
| UI-06 | Empty state renders when sessions array is empty | manual-only | — | N/A |
| UI-07 | Imported data banner shown when source is imported | manual-only | — | N/A |

Note: Jest config uses `testEnvironment: 'node'` — React component rendering tests are manual-only unless jsdom is added. All unit tests target pure functions (sort logic, token computation, token display formatting).

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern=active`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/lib/active-page-logic.test.ts` — covers DISP-01 through DISP-06, UI-05 (sort order, token total computation)
- [ ] `src/__tests__/lib/hooks.test.ts` — covers UI-03 (hook has `refreshInterval: 5000`)
- [ ] `src/__tests__/lib/sidebar.test.ts` — covers UI-02 (navItems includes Active entry)

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/lib/claude-data/active-sessions.ts`, `src/lib/claude-data/types.ts`, `src/lib/hooks.ts`, `src/components/layout/sidebar.tsx`, `src/app/page.tsx`, `src/lib/format.ts`, `src/config/pricing.ts`
- `src/__tests__/lib/active-sessions.test.ts` — confirmed Phase 1 test contract and Jest node environment
- `jest.config.js` — confirmed framework, environment, test match pattern
- `package.json` — confirmed all dependency versions, test scripts

### Secondary (MEDIUM confidence)
- SWR documentation pattern for `refreshInterval` and null key disabling — consistent with SWR v2 API (version 2.4.0 in package.json); `null` key disables the hook
- Tailwind v4 `animate-pulse` utility — confirmed present in Tailwind v4 (unchanged from v3)

### Tertiary (LOW confidence)
- Tailwind v4 arbitrary `[animation-duration:...]` support — not verified against v4 docs; flagged as open question

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are existing project dependencies; versions verified from package.json
- Architecture: HIGH — all patterns derived from existing codebase code; no speculative patterns
- Pitfalls: HIGH — each pitfall traced to a specific code artifact or explicit note in STATE.md
- Test infrastructure: HIGH — jest.config.js and existing test file directly inspected

**Research date:** 2026-03-18
**Valid until:** 2026-04-17 (30 days — stable stack, no fast-moving dependencies)
