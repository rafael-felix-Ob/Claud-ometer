# Codebase Structure

**Analysis Date:** 2025-03-17

## Directory Layout

```
Claud-ometer/
├── src/
│   ├── app/                          # Next.js App Router pages and API routes
│   │   ├── api/
│   │   │   ├── stats/route.ts        # GET /api/stats → DashboardStats
│   │   │   ├── projects/route.ts     # GET /api/projects → ProjectInfo[]
│   │   │   ├── sessions/
│   │   │   │   ├── route.ts          # GET /api/sessions → SessionInfo[]
│   │   │   │   └── [id]/route.ts     # GET /api/sessions/{id} → SessionDetail
│   │   │   ├── data-source/route.ts  # GET/PUT /api/data-source (toggle live/imported)
│   │   │   ├── export/route.ts       # GET /api/export → ZIP download
│   │   │   └── import/route.ts       # POST/DELETE /api/import (upload/clear)
│   │   ├── page.tsx                  # / → Overview dashboard
│   │   ├── layout.tsx                # Root layout (dark theme, sidebar, tooltip provider)
│   │   ├── globals.css               # CSS variables for light/dark themes
│   │   ├── sessions/
│   │   │   ├── page.tsx              # /sessions → Session list with search
│   │   │   └── [id]/page.tsx         # /sessions/{id} → Session detail with replay
│   │   ├── projects/
│   │   │   ├── page.tsx              # /projects → Project grid
│   │   │   └── [id]/page.tsx         # /projects/{id} → Project detail + sessions
│   │   ├── costs/page.tsx            # /costs → Cost analytics
│   │   └── data/page.tsx             # /data → ZIP import/export management
│   ├── components/
│   │   ├── layout/
│   │   │   └── sidebar.tsx           # Fixed left nav bar (60px fixed width)
│   │   ├── cards/
│   │   │   └── stat-card.tsx         # Reusable stat card with icon and title
│   │   ├── charts/
│   │   │   ├── usage-over-time.tsx   # Area chart of daily messages/sessions
│   │   │   ├── model-breakdown.tsx   # Pie chart of token usage by model
│   │   │   ├── activity-heatmap.tsx  # Grid heatmap of activity by hour/day
│   │   │   ├── peak-hours.tsx        # Bar chart of messages by hour
│   │   │   └── cost-chart.tsx        # Cost trends over time
│   │   └── ui/                       # shadcn/ui components
│   │       ├── card.tsx
│   │       ├── badge.tsx
│   │       ├── separator.tsx
│   │       ├── tooltip.tsx
│   │       ├── tabs.tsx
│   │       └── [others].tsx
│   ├── lib/
│   │   ├── claude-data/
│   │   │   ├── types.ts              # All TypeScript interfaces
│   │   │   ├── reader.ts             # JSONL parsing, aggregation, search
│   │   │   └── data-source.ts        # Live vs imported data toggle
│   │   ├── hooks.ts                  # SWR hooks (useStats, useProjects, useSessions, etc.)
│   │   ├── format.ts                 # Formatters (tokens, cost, duration, timeAgo)
│   │   └── utils.ts                  # cn() utility (clsx + tailwind-merge)
│   └── config/
│       └── pricing.ts                # Model pricing table, calculateCost, displayName
├── public/                           # Static assets (favicons, etc.)
├── screenshots/                      # UI screenshots for docs
├── scripts/                          # Build/deployment scripts
├── .planning/
│   └── codebase/                     # Architecture and structure docs
├── components.json                   # shadcn/ui config
├── eslint.config.mjs                 # ESLint configuration
├── next.config.ts                    # Next.js configuration (Turbopack)
├── postcss.config.mjs                # PostCSS config (Tailwind)
├── tsconfig.json                     # TypeScript config
├── package.json                      # Dependencies and scripts
├── CLAUDE.md                         # Project-specific development guide
├── LICENSE                           # MIT license
└── README.md                         # Project overview
```

## Directory Purposes

**src/app/:**
- Purpose: Next.js App Router - contains all pages, layouts, and API routes
- Contains: Page components (route → `.tsx`), layout wrappers, API handlers (route.ts)
- Key files: `layout.tsx` (root), `page.tsx` (home), dynamic routes in brackets

**src/app/api/:**
- Purpose: API endpoints that read JSONL and return JSON
- Contains: All route handlers marked `export const dynamic = 'force-dynamic'`
- Key files: `stats/route.ts`, `sessions/route.ts`, `projects/route.ts`, `data-source/route.ts`
- Pattern: Each route imports reader functions from `lib/claude-data/reader.ts`

**src/components/:**
- Purpose: Reusable React components
- Contains: Layout wrappers, presentational components, UI library components
- Key subdirs: `layout/` (sidebar), `cards/` (stat cards), `charts/` (Recharts wrappers), `ui/` (shadcn)

**src/lib/claude-data/:**
- Purpose: Core business logic - filesystem reading and data transformation
- Contains: JSONL parsing, session/project aggregation, search, cost calculation
- Key files: `reader.ts` (main logic), `types.ts` (all interfaces), `data-source.ts` (toggle mechanism)

**src/lib/:**
- Purpose: Shared utilities and hooks
- Contains: Formatting functions, SWR hooks, utility functions
- Key files: `hooks.ts` (SWR wrappers), `format.ts` (number/duration formatting), `utils.ts` (cn helper)

**src/config/:**
- Purpose: Configuration and constants
- Contains: Pricing table, model mappings, constants
- Key files: `pricing.ts` (pricing table, calculateCost, model display names)

## Key File Locations

**Entry Points:**

- `src/app/layout.tsx`: Root HTML structure, dark theme, sidebar wrapper
- `src/app/page.tsx`: Homepage dashboard (`/`)
- `src/app/sessions/page.tsx`: Session list and search (`/sessions`)
- `src/app/sessions/[id]/page.tsx`: Session detail with transcript (`/sessions/{id}`)
- `src/app/projects/page.tsx`: Project grid (`/projects`)
- `src/app/costs/page.tsx`: Cost analytics (`/costs`)
- `src/app/data/page.tsx`: Data import/export management (`/data`)

**Configuration:**

- `tsconfig.json`: TypeScript paths (e.g., `@/` aliases `src/`)
- `next.config.ts`: Next.js runtime config
- `postcss.config.mjs`: PostCSS plugins (Tailwind)
- `components.json`: shadcn/ui config (style: "new-york")
- `package.json`: Dependencies (Next.js 16, React 19, SWR, Recharts, Tailwind)

**Core Logic:**

- `src/lib/claude-data/reader.ts`: JSONL parsing, session aggregation, search, dashboard stats computation
- `src/lib/claude-data/types.ts`: All TypeScript interfaces (SessionMessage, SessionInfo, DashboardStats, etc.)
- `src/lib/claude-data/data-source.ts`: Live vs imported data toggle, import directory management
- `src/config/pricing.ts`: Model pricing, cost calculation, display name/color mapping

**Testing:**

- No test files in codebase (testing not yet implemented)

## Naming Conventions

**Files:**

- Pages: `page.tsx` (e.g., `src/app/page.tsx`, `src/app/sessions/page.tsx`)
- API routes: `route.ts` (e.g., `src/app/api/stats/route.ts`)
- Dynamic segments: `[param].tsx` (e.g., `src/app/sessions/[id]/page.tsx`)
- Components: `PascalCase.tsx` (e.g., `Sidebar.tsx`, `StatCard.tsx`)
- Utilities: `camelCase.ts` (e.g., `hooks.ts`, `format.ts`)

**Directories:**

- Feature dirs: kebab-case (e.g., `data-source/`, `api/`, `components/`)
- Component group dirs: camelCase (e.g., `components/layout/`, `components/cards/`)

**TypeScript:**

- Types/Interfaces: PascalCase (e.g., `DashboardStats`, `SessionInfo`)
- Functions: camelCase (e.g., `getDashboardStats()`, `parseSessionFile()`)
- Constants: SCREAMING_SNAKE_CASE (e.g., `MODEL_PRICING`, `SUPPLEMENTAL_TTL_MS`)
- Exports: Named exports for functions, default export for pages/components

## Where to Add New Code

**New Feature (e.g., new analytics page):**

1. Create page: `src/app/{feature}/page.tsx` (or `src/app/{feature}/[id]/page.tsx` for detail)
2. Create API if needed: `src/app/api/{feature}/route.ts`
3. API delegates to new reader function in `src/lib/claude-data/reader.ts`
4. Page uses SWR hook from `src/lib/hooks.ts` (create if new)
5. Page imports formatting utilities from `src/lib/format.ts` and UI components from `src/components/`

**New Component/Module:**

- Presentational component: `src/components/{category}/{ComponentName}.tsx` (use PascalCase)
- Chart wrapper: `src/components/charts/{ChartName}.tsx` (extends Recharts, props accept data arrays)
- Card variant: `src/components/cards/{CardName}.tsx`
- shadcn/ui component: Import from `@/components/ui/` (pre-configured in `components.json`)

**Utilities & Helpers:**

- Shared formatting: `src/lib/format.ts` (add formatter functions alongside existing ones)
- Custom hooks: `src/lib/hooks.ts` (add SWR hook following pattern: `const fetcher = ...; return useSWR(url, fetcher)`)
- Type definitions: `src/lib/claude-data/types.ts` (add interface, always export)
- Reader functions: `src/lib/claude-data/reader.ts` (add async function that reads JSONL, export it, use in API route)

## Special Directories

**src/app/api/:**
- Purpose: All API route handlers
- Generated: No (hand-written)
- Committed: Yes
- Pattern: Each route is `export const dynamic = 'force-dynamic'` (no caching)

**.planning/codebase/:**
- Purpose: Architecture and structure documentation (this file, ARCHITECTURE.md, etc.)
- Generated: No (hand-written by GSD mapper)
- Committed: Yes
- Usage: Referenced by GSD planner/executor when creating phases

**public/:**
- Purpose: Static assets served directly (favicons, robots.txt, etc.)
- Generated: No
- Committed: Yes

**screenshots/:**
- Purpose: UI screenshots for documentation and README
- Generated: Manual captures
- Committed: Yes (.gitignore includes `test-results` but not screenshots)

**.dashboard-data/:**
- Purpose: Imported Claude data from ZIP uploads (created at runtime)
- Generated: Yes (POST /api/import)
- Committed: No (.gitignore entry)
- Structure: `.dashboard-data/claude-data/projects/{projectId}/{sessionId}.jsonl`

## Import Path Aliases

- `@/` maps to `src/` (defined in `tsconfig.json`)
- Use `@/lib/...`, `@/components/...`, `@/config/...` throughout codebase

---

*Structure analysis: 2025-03-17*
