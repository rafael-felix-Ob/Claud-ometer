# Stack Research

**Domain:** Real-time filesystem polling + live session status in Next.js dashboard
**Researched:** 2026-03-18
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| SWR | 2.4.0 (already installed) | 5-second polling for /api/active | `refreshInterval: 5000` is a first-class SWR feature. Zero new dependencies. Matches every other data hook in the codebase. Deduplication prevents burst requests on tab focus. |
| Node.js `fs` module | built-in (already used) | File modification time detection via `fs.statSync().mtimeMs` | Already used throughout `reader.ts`. `mtimeMs` returns a millisecond epoch — the cheapest possible activity check. No new dependency. |
| Node.js `fs` module | built-in | Tail-read JSONL for last message detection | Use `fs.fstatSync` + `fs.readSync` with a negative position offset to read only the last 8–16 KB of each active JSONL. Avoids full-file streaming. Pattern already established in `extractCwdFromSession`. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| No new library needed | — | Last-N-lines reading | Implement with Node.js built-ins: `fs.openSync`, `fs.fstatSync`, `fs.readSync`. The existing codebase already does this in `extractCwdFromSession` (8 KB buffer from position 0). Extend that pattern to read from end-of-file instead. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript strict types | New `ActiveSession` interface | Keep in `src/lib/claude-data/types.ts` alongside existing types |
| ESLint (already configured) | Enforce no-async patterns in route guards | No config change needed |

## Installation

```bash
# No new packages required.
# All required capabilities are in the existing stack:
# - SWR 2.4.0 (refreshInterval)
# - Node.js fs (statSync, fstatSync, readSync)
# - Next.js 16 force-dynamic API routes
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| SWR `refreshInterval: 5000` (polling) | Server-Sent Events (SSE) | If sub-second updates were required or if many concurrent clients needed push notifications. For a local single-user dashboard at 5s cadence, SSE adds complexity with no benefit. |
| SWR `refreshInterval: 5000` (polling) | WebSockets | If bidirectional communication or sub-second latency were required. Adds a WS server, connection lifecycle management, and reconnect handling — all unnecessary here. |
| `fs.statSync().mtimeMs` for activity detection | `fs.watch()` / `fs.watchFile()` | `fs.watch` is event-driven and would require a persistent server-side watcher with state. In a Next.js API route (stateless, force-dynamic), a watcher would need global module state and careful cleanup. `statSync` in a polled route is simpler and exactly sufficient. |
| Native `fs.readSync` tail-read | `read-last-lines` npm package | `read-last-lines` (v1.8.0, last published 5 years ago) is a no-maintenance package doing what one can write in 20 lines. Given the codebase already has `extractCwdFromSession` using this exact pattern, use the established internal approach. |
| In-memory cache in API module scope | Next.js `use cache` directive | `use cache` is new in Next.js 15+; the project is on 16.1.6 but the pattern is experimental. Module-scope `Map` with a TTL (already established in `reader.ts` as `supplementalCache`) is simpler and proven in this codebase. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `fs.watch()` / `fs.watchFile()` in API routes | Next.js force-dynamic routes are stateless per-request. A persistent watcher requires module-level singleton state that survives across requests — fragile, leaks on hot-reload in dev, and unnecessary for 5s polling. | `fs.statSync().mtimeMs` called directly in the API handler on each poll |
| Full JSONL reparse on every 5s poll | `parseSessionFile()` streams the entire file. For active sessions that may be hundreds of thousands of lines, doing this every 5 seconds per session will degrade performance. | Tail-read: read the last 8–16 KB via `fs.readSync` from end of file to extract only the last few messages for status detection |
| WebSocket or SSE push | Significant server complexity (persistent connection, cleanup, reconnect) for a single-user local tool where polling at 5s is indistinguishable from push. Out of scope per PROJECT.md. | `useSWR` with `refreshInterval: 5000` |
| `useInterval` / `setInterval` in React | Bypasses SWR's deduplication and caching. Two components on the same page would double-fetch. SWR's key-based deduplication ensures one request per 5s regardless of how many components subscribe. | `useSWR('/api/active', fetcher, { refreshInterval: 5000 })` |
| `revalidateOnFocus: true` (default) for the active hook | The active sessions hook will poll at 5s. Re-fetching again on tab focus is redundant noise on a poll-based hook. | Set `revalidateOnFocus: false` on the `useActiveSessions` hook |

## Stack Patterns by Variant

**For session "active" detection (is this JSONL being written to right now?):**
- Use `fs.statSync(filePath).mtimeMs`
- Compare to `Date.now()` — if modified within last 30s, session is candidate for "active"
- Threshold of 30s covers the time between Claude tool calls in a typical session

**For session "status" detection (what is Claude doing right now?):**
- Tail-read: `fs.openSync`, `fs.fstatSync`, `fs.readSync` from `(fileSize - 16384)` position
- Parse lines backward to find the last complete JSON object
- Check `type === 'assistant'` with tool_use content → "working"
- Check `type === 'assistant'` with text content and no pending tool_use → "waiting for input"
- File modified >5m ago but was active in last session → "idle"

**For GSD progress detection:**
- `fs.existsSync(projectCwd + '/.planning/STATE.md')` — check presence
- `fs.readFileSync(projectCwd + '/.planning/STATE.md', 'utf-8')` — read directly
- Parse markdown for current phase, status lines
- This is a cheap synchronous read of a small file; no optimization needed

**For API route caching (avoid per-poll full-scan of all projects):**
- Module-scope `Map` with `{ data, ts }` entries, TTL of 4000ms (just under 5s poll)
- Pattern already established in `reader.ts` as `supplementalCache` with `SUPPLEMENTAL_TTL_MS`
- Keeps the route idempotent under concurrent requests without adding a dependency

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| SWR 2.4.0 | React 19.2.3 | HIGH confidence — SWR 2.x supports React 18+ including React 19. `refreshInterval` and `revalidateOnFocus` are stable, documented options. |
| Node.js fs (built-in) | Next.js 16.1.6 App Router | HIGH confidence — API routes run in Node.js runtime. `fs` is always available in `force-dynamic` API routes. Not available in Edge runtime (don't use Edge runtime for this route). |
| `export const dynamic = 'force-dynamic'` | Next.js 16.1.6 | HIGH confidence — established pattern, already used in every existing API route in the codebase. |

## Sources

- [SWR API Reference — swr.vercel.app/docs/api](https://swr.vercel.app/docs/api) — `refreshInterval` type/default confirmed (`0` disabled, number = ms); `revalidateOnFocus` default `true`; `dedupingInterval` default `2000ms`. HIGH confidence.
- [SWR Automatic Revalidation — swr.vercel.app/docs/revalidation](https://swr.vercel.app/docs/revalidation) — polling behavior, focus revalidation. HIGH confidence.
- [Node.js fs documentation — nodejs.org/api/fs.html](https://nodejs.org/api/fs.html) — `fs.statSync`, `fs.fstatSync`, `fs.readSync`, `stats.mtimeMs`. HIGH confidence.
- [Node.js file stats guide — nodejs.org/en/learn/manipulating-files/nodejs-file-stats](https://nodejs.org/en/learn/manipulating-files/nodejs-file-stats) — `mtime` vs `ctime` distinction confirmed. HIGH confidence.
- Next.js 16.1.6 `force-dynamic` route segment config — confirmed working in existing codebase API routes. HIGH confidence (verified in source).
- `supplementalCache` TTL pattern — confirmed in `/mnt/c/SourceControl/GitHub/Claud-ometer/src/lib/claude-data/reader.ts`, lines 472–499. HIGH confidence (verified in source).

---
*Stack research for: Real-time filesystem monitoring and live UI updates in Next.js 16 with SWR*
*Researched: 2026-03-18*
