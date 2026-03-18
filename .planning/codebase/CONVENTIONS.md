# Coding Conventions

**Analysis Date:** 2026-03-17

## Naming Patterns

**Files:**
- PascalCase for React components: `StatCard.tsx`, `UsageOverTime.tsx`, `Sidebar.tsx`
- kebab-case for utility/feature directories: `claude-data/`, `stat-card.tsx`
- camelCase for non-component TypeScript files: `hooks.ts`, `format.ts`, `utils.ts`, `reader.ts`
- Route files use bracket notation for dynamic segments: `[id]/route.ts`, `[id]/page.tsx`

**Functions:**
- camelCase for all function names: `formatTokens()`, `calculateCost()`, `getProjects()`, `parseSessionFile()`
- Async functions follow same camelCase pattern: `forEachJsonlLine()`, `getProjectSessions()`
- Hooks use `use` prefix: `useStats()`, `useSessions()`, `useSessionDetail()`, `useDebounce()`, `useProjectSessions()`
- Event handlers use `on` prefix or action verb: `onClick()`, `onChange()`, `setActiveMetric()`, `setSearchQuery()`

**Variables:**
- camelCase for all variables: `sessionId`, `debouncedQuery`, `isLoading`, `isActive`
- Boolean variables often start with `is` or `has`: `isLoading`, `isActive`, `isImported`, `hasImportedData()`
- Set/map collections use plural or descriptive names: `modelsSet`, `toolsUsed`, `projects[]`, `sessions[]`

**Types:**
- PascalCase for all TypeScript interfaces and types: `SessionInfo`, `ProjectInfo`, `DashboardStats`, `StatCardProps`
- Props interfaces use `Props` suffix: `StatCardProps`, `UsageOverTimeProps`
- Short generic names for helper types: `MetricKey` (for union of string literals)

**Constants:**
- UPPER_SNAKE_CASE for constants: `MODEL_PRICING`, `IMPORT_DIR`, `IMPORT_META`
- Local/config constants use descriptive PascalCase for collections: `navItems`, `metrics`

## Code Style

**Formatting:**
- ESLint 9 with Next.js config (`eslint-config-next`) enforces core web vitals and TypeScript best practices
- No Prettier configured — relies on ESLint formatting rules
- Import organization: strict typing, module resolution via bundler
- Target: ES2017 (TypeScript compilerOptions), JSX: react-jsx

**Linting:**
- ESLint config: `eslint.config.mjs` (flat config format)
- Extends: `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`
- Ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- Run: `npm run lint`

## Import Organization

**Order:**
1. React and Next.js imports: `import { useState } from 'react'`, `import { useRouter } from 'next/navigation'`
2. Third-party library imports: `import useSWR from 'swr'`, `import { AreaChart } from 'recharts'`, `import { format } from 'date-fns'`
3. Internal absolute imports: `import { useStats } from '@/lib/hooks'`, `import { StatCard } from '@/components/cards/stat-card'`
4. Type imports: `import type { SessionInfo } from '@/lib/claude-data/types'`, `import type { LucideIcon } from 'lucide-react'`

**Path Aliases:**
- `@/*` resolves to `./src/*` (configured in tsconfig.json)
- All internal imports use `@/` prefix: `@/lib/`, `@/components/`, `@/config/`

## Error Handling

**Patterns:**
- API routes wrap logic in try-catch and return NextResponse with status code: `NextResponse.json(stats)` on success, `NextResponse.json({ error: 'message' }, { status: 500 })` on failure
- Error logging to console: `console.error('Error context:', error)` with descriptive prefix
- JSONL parsing failures are silently skipped: `catch { /* skip malformed line */ }` with inline comment
- File operations check existence before reading: `if (!fs.existsSync(filePath)) return []`

Example from `src/app/api/stats/route.ts`:
```typescript
export async function GET() {
  try {
    const stats = await getDashboardStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
```

Example from `src/lib/claude-data/reader.ts`:
```typescript
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const msg = JSON.parse(line) as SessionMessage;
    callback(msg);
  } catch { /* skip malformed line */ }
}
```

## Logging

**Framework:** Native `console.error()` — no logging library used

**Patterns:**
- Only errors logged: `console.error('context:', error)`
- No debug, info, or warn logging in source code
- Error messages use descriptive prefixes: `'Error fetching stats:'`, `'Export error:'`, `'Import error:'`
- Used in: API routes (`src/app/api/*/route.ts`)

## Comments

**When to Comment:**
- Minimal comments — code is generally self-documenting
- Inline comments for non-obvious logic: `// Read first 8KB, enough for first few lines`, `// Compaction tracking`, `// Sync debounced query to URL`
- Comments above blocks that explain "why": `// Track compaction events`, `// Skip malformed line`
- Comments in catch blocks explain intent: `/* skip malformed line */`, `/* skip partial line */`, `/* skip */`

**JSDoc/TSDoc:**
- Not used in this codebase
- All functions rely on TypeScript type signatures for documentation

## Function Design

**Size:** Functions are focused and typically 10-50 lines

**Parameters:**
- Use destructuring for component props: `{ title, value, subtitle, icon: Icon, trend }`
- Named parameters preferred for clarity: `useSessions(limit = 50, offset = 0, query = '')`
- Default parameters used when appropriate: `useStats()` vs `useSessions(limit, offset, query)`

**Return Values:**
- Explicit return types: `async function getProjects(): Promise<ProjectInfo[]>`
- Null returns for missing data: `getStatsCache(): StatsCache | null`, `getImportMeta(): ImportMeta | null`
- Empty arrays default when no data: `return []` on missing directory/file
- SWR hooks return `{ data, isLoading }` tuple via useSWR pattern

## Module Design

**Exports:**
- Named exports for functions and components: `export function formatTokens()`, `export function StatCard()`
- Default exports for pages: `export default function DashboardPage()`
- Type exports for interfaces: `export interface SessionInfo {}`
- Named exports generally preferred over defaults for reusability

**Barrel Files:**
- Not used — imports reference specific files: `import { useStats } from '@/lib/hooks'`
- Each component directory may have a single component file: `src/components/cards/stat-card.tsx`

## Client/Server Boundaries

**Client Components:**
- All page components marked with `'use client'` at top
- All interactive components marked with `'use client'`: Sidebar, search inputs, charts with state
- Uses hooks: useState, useEffect, useRouter, useSearchParams, useSWR

**Server Components:**
- API routes are server-only by default
- Use `export const dynamic = 'force-dynamic'` to disable caching on filesystem-reading routes

**SWR Pattern:**
- Fetcher function throws on non-OK responses to propagate errors to SWR
```typescript
const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
});
```

## Defensive Data Access

**Pattern:** Guard optional or potentially missing fields:
```typescript
const models = session.models || [];
const compaction = session.compaction || { compactions: 0, microcompactions: 0, totalTokensSaved: 0, compactionTimestamps: [] };
```

Reason: Session data from JSONL can have missing fields at runtime even though TypeScript types declare them present. Used in `src/app/page.tsx` and session detail pages.

## Tailwind CSS Conventions

**Text Sizing:**
- Page titles: `text-xl font-bold tracking-tight`
- Card titles: `text-sm font-semibold`
- Labels: `text-xs text-muted-foreground`
- Tiny text: `text-[10px]` or `text-[9px]`
- Monospace IDs/branches: `font-mono`

**Colors:**
- Primary (Claude orange): CSS var `--primary`
- Hover states: `hover:bg-accent hover:text-foreground`
- Muted text: `text-muted-foreground`
- Subtle borders: `border-border/50`
- Amber warnings: `text-amber-600`, `border-amber-300/50`, `bg-amber-50/30`
- Green for savings: `text-green-600`

**Icons:**
- Lucide React icons only
- Typical sizing: `h-3 w-3` (inline), `h-3.5 w-3.5` (card headers), `h-4 w-4` (buttons/nav)

**Card Styling Pattern:**
```tsx
<Card className="border-border/50 shadow-sm">
  <CardHeader className="pb-3">
    <CardTitle className="text-sm font-semibold">Title</CardTitle>
  </CardHeader>
  <CardContent className="pt-0">...</CardContent>
</Card>
```

**Grid Layouts:**
- `grid grid-cols-4 gap-4` for stat rows
- `grid grid-cols-3 gap-4` for chart rows with `col-span-2` for wide charts
- Responsive via gap and grid-cols

---

*Convention analysis: 2026-03-17*
