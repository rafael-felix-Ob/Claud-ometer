# Codebase Concerns

**Analysis Date:** 2026-03-17

## Tech Debt

**Large reader.ts file (751 lines):**
- Issue: `src/lib/claude-data/reader.ts` is the core data processing engine with multiple responsibilities (parsing, aggregation, caching, supplemental stats). At 751 lines, it's difficult to test and modify safely.
- Files: `src/lib/claude-data/reader.ts`
- Impact: Changes to data reading logic risk breaking multiple features simultaneously. Testing individual functions is complicated due to interdependencies.
- Fix approach: Refactor into smaller modules: `parser.ts` (JSON parsing, line-by-line reading), `aggregator.ts` (session/project aggregation), `cache.ts` (supplemental stats computation). Each module should have focused responsibilities and unit tests.

**Silent JSON parsing failures:**
- Issue: Malformed JSONL lines are silently caught and skipped with empty catch blocks (lines 29, 55, 81, 387 in `reader.ts`). No logging or metrics indicate when data is being discarded.
- Files: `src/lib/claude-data/reader.ts`
- Impact: Corrupt session files could lose data silently without the user knowing. Impossible to debug data inconsistencies.
- Fix approach: Add logging for skipped lines (count per file, sample of errors). Use structured logging so bad files can be identified and fixed. Consider adding a validation report to the data management page.

**Type assertions without validation (as SessionMessage, as File):**
- Issue: Lines 27, 336 in `reader.ts` cast JSON to `SessionMessage` without verifying required fields. Line 12 in `import/route.ts` casts to `File` without null checks.
- Files: `src/lib/claude-data/reader.ts`, `src/app/api/import/route.ts`
- Impact: Defensive code is already in place (e.g., `session.models || []`) but fragile—relies on handlers catching missing fields after unsafe casting. A malformed JSONL that passes JSON.parse but lacks critical fields could cause runtime errors.
- Fix approach: Create validation functions that check required fields before casting. Use type guards instead of `as` assertions. Example: `function isSessionMessage(obj: unknown): obj is SessionMessage { return obj && typeof obj === 'object' && 'type' in obj && ... }`

**Potential memory issue with large history.jsonl:**
- Issue: Line 53 in `reader.ts` loads entire `history.jsonl` into memory with `readFileSync().split('\n')` before parsing. For large history files, this could spike memory.
- Files: `src/lib/claude-data/reader.ts:53`
- Impact: Users with very large prompt history (years of usage) could see performance degradation or crashes when loading `/sessions` page.
- Fix approach: Stream `history.jsonl` using readline (already used elsewhere in reader.ts) instead of loading into memory. Only parse lines needed for the current view.

## Known Bugs

**Missing error handling in import/export streaming:**
- Symptoms: Archive error during ZIP export (line 21-22 in `export/route.ts`) throws inside the archiver but may not properly propagate to client. Network timeout during large export won't show graceful error.
- Files: `src/app/api/export/route.ts:21-22`, `src/app/data/page.tsx:54-67`
- Trigger: Large `.claude` directory (100+ MB) or slow filesystem, network interruption during download
- Workaround: Retry export, check browser console for errors. Consider exporting smaller projects individually.

**Search limit doesn't respect offset in sessions API:**
- Symptoms: When using `?q=search&limit=50`, the `offset` parameter is ignored (line 15 in `sessions/route.ts` doesn't pass offset to `searchSessions`). Users can only see first 50 results of a search.
- Files: `src/app/api/sessions/route.ts:14-16`, `src/lib/claude-data/reader.ts:396`
- Trigger: Perform a search that returns more than 50 results, try to paginate
- Workaround: Refine search query to reduce results under 50

## Security Considerations

**Home directory enumeration via stats-cache.json:**
- Risk: Export includes `stats-cache.json` which contains hostnames and potentially system paths. If ZIP is shared publicly, it reveals system architecture.
- Files: `src/app/api/export/route.ts:28-31`, `src/config/pricing.ts` (hostname exposed in export metadata)
- Current mitigation: Users must explicitly export—no automatic syncing
- Recommendations: Add option to sanitize export (remove hostname, timestamps) before download. Add warning on export page that archive contains identifying information.

**No validation of imported ZIP structure:**
- Risk: Archive is extracted directly to filesystem (line 49-59 in `import/route.ts`) with minimal validation. Symlink attacks or path traversal (e.g., `../../../etc/passwd`) aren't explicitly prevented by JSZip but should be verified.
- Files: `src/app/api/import/route.ts:46-60`
- Current mitigation: `path.join()` handles most traversal, JSZip doesn't follow symlinks, but directory structure isn't validated
- Recommendations: Validate that all extracted paths stay within `importDir`. Reject archives with suspicious paths containing `..`, absolute paths, or symlinks.

**Timestamp injection in session detail:**
- Risk: `msg.timestamp` from JSONL is passed directly to `new Date()` and `format()` (lines 149, 263 in `sessions/[id]/page.tsx`). Malformed timestamps don't crash but display incorrectly.
- Files: `src/app/sessions/[id]/page.tsx:149,263`, `src/lib/claude-data/reader.ts:280`
- Current mitigation: `date-fns` handles invalid dates gracefully
- Recommendations: Validate ISO timestamps before using. Add defensive parsing: `const ts = new Date(msg.timestamp); if (isNaN(ts.getTime())) return 'Invalid date'`

## Performance Bottlenecks

**Full directory scan for every data operation:**
- Problem: Every call to `getSessions()`, `getProjects()`, `getStatsCache()` scans filesystem from scratch (lines 98, 179, 317 in `reader.ts`). No caching of directory listings.
- Files: `src/lib/claude-data/reader.ts:96-160` (getProjects), `src/lib/claude-data/reader.ts:175-194` (getSessions)
- Cause: `force-dynamic` on API routes prevents Next.js caching. Rapid requests (e.g., user clicking back/forward) rescans entire project directory.
- Improvement path: Implement filesystem watcher or cache directory listings for 5-10 seconds. Use request deduplication (SWR already handles this on frontend). Consider dedicated cache layer separate from stats-cache.json.

**Linear search in searchSessions:**
- Problem: Full-text search scans every session file sequentially (lines 405-453 in `reader.ts`). First match triggers early return, but still reads entire JSONL line-by-line for every file.
- Files: `src/lib/claude-data/reader.ts:396-457`
- Cause: Message content is only available in JSONL files, not cached. No indexing.
- Improvement path: Add optional full-text index to stats-cache.json (just session IDs + metadata of matching terms). For exact search hits, the current approach is acceptable but document the limitation.

**Unoptimized supplemental stats computation:**
- Problem: `computeSupplementalStats()` (lines 497-632 in `reader.ts`) recomputes all statistics for files modified after cache date on every dashboard load, even if data hasn't changed. 30-second TTL is short for stable data.
- Files: `src/lib/claude-data/reader.ts:497-632`
- Cause: `SUPPLEMENTAL_TTL_MS = 30_000` assumes data changes frequently. For users with stable sessions, this is wasteful.
- Improvement path: Extend TTL to 5 minutes. Add cache invalidation endpoint that clears supplemental cache when import/data-source changes. Use SWR's `revalidateOnFocus: false` for dashboard stats to prevent immediate refetch.

**Inefficient hour bucketing in daily stats:**
- Problem: All messages grouped by hour (line 536 in `reader.ts`) but hour buckets never pruned. With years of data, `hourCounts` object grows unbounded.
- Files: `src/lib/claude-data/reader.ts:519-588`
- Cause: No limit on histogram granularity.
- Improvement path: Aggregate by hour-of-day (0-23) instead of absolute hour. `const hourOfDay = msg.timestamp.slice(11, 13)` already correct, but ensure daily reset.

## Fragile Areas

**Data structure evolution without migration:**
- Files: `src/lib/claude-data/types.ts` (type definitions), `src/lib/claude-data/reader.ts` (data reader)
- Why fragile: SessionMessage interface has optional fields (`compactMetadata?`, `microcompactMetadata?`) but they're accessed without optional chaining in some places. If Claude Code adds new JSONL fields, the dashboard may break silently.
- Safe modification: When accessing nested fields from JSONL, always use optional chaining or guard checks. Before changing types.ts, search for all usage sites and add tests.
- Test coverage: Gaps in handling missing fields—add unit tests for parseSessionFile with incomplete messages.

**Stats-cache.json staleness:**
- Files: `src/lib/claude-data/reader.ts:634-751` (getDashboardStats), `src/app/api/stats/route.ts`
- Why fragile: Cache merge logic (lines 690-723) sums data from two sources (cache + fresh JSONL). If cache becomes invalid, totals are wrong until stats-cache.json is regenerated by Claude Code.
- Safe modification: Test getDashboardStats with intentionally corrupted cache files. Verify that supplemental stats bridge the gap correctly.
- Test coverage: No tests for cache staleness scenarios.

**Import/export metadata assumptions:**
- Files: `src/app/api/export/route.ts:83-89`, `src/app/api/import/route.ts:62-67`
- Why fragile: `export-meta.json` fields (`exportedFrom`, `exportedAt`) are assumed to exist and are read without fallback (line 66 in import/route.ts). If an old export doesn't have these fields, JSON.parse will fail.
- Safe modification: Add defensive parsing: `const exportMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : { exportedAt: 'unknown', exportedFrom: 'unknown' }`
- Test coverage: No tests for imports of old-format archives.

## Scaling Limits

**Assumption: Single-machine local filesystem:**
- Current capacity: Works well up to ~1GB of JSONL (typical for 1-2 years of active Claude Code use)
- Limit: With extreme usage (10+ sessions/day, years of history), JSONL files could grow to 5-10GB. Sequential file reads become slow.
- Scaling path: For users with massive datasets, suggest archiving old projects. Consider lazy-loading sessions (only fetch last N days by default). For production deployment (if shared), add database backend (PostgreSQL, SQLite).

**No horizontal scaling:**
- Current capacity: Single process serving all API requests
- Limit: With many concurrent users (if used as shared team dashboard), filesystem access becomes a bottleneck
- Scaling path: For team use case, migrate to a proper backend with caching layers. Add Redis for stats caching. Current implementation is fine for single-user local analytics.

## Dependencies at Risk

**archiver (ZIP creation):**
- Risk: Used only for export (single use case). If vulnerability found in archiver, users can't export data. Package is maintained but relatively low activity.
- Impact: Export feature breaks, users can't backup data
- Migration plan: `tar` + gzip as alternative (cross-platform via node built-ins), or switch to `adm-zip` which has more activity but different API

**JSZip (ZIP parsing):**
- Risk: Used for import with user-provided files (potential attack surface). Last update ~1 year ago, small team.
- Impact: Unzip vulnerability could allow code execution or file access
- Migration plan: Prebuilt binaries of `unzip` or `7z` are more battle-tested. JSZip is suitable for low-risk use case (only imports user's own exports).

**SWR (data fetching):**
- Risk: Actively maintained but smaller adoption than React Query. No breaking changes expected but migration would require refactoring hooks.
- Impact: If SWR is abandoned, cached data fetching and revalidation stop working as expected
- Migration plan: React Query (SWR → useQuery is straightforward) or native fetch + state management

## Missing Critical Features

**No error recovery for corrupted sessions:**
- Problem: If a single JSONL file is corrupted, it's silently skipped. No UI to alert user or allow manual repair.
- Blocks: Users can't recover partial session data if their machine crashed mid-write

**No data versioning:**
- Problem: Export/import has no version field. If dashboard format changes, old exports can't be validated as compatible.
- Blocks: Can't guarantee imports from old exports will work in new dashboard versions

**No session filtering by date range:**
- Problem: Search only works on message content, not dates. No way to isolate "sessions from last week" except scrolling through list.
- Blocks: Users with years of history can't efficiently focus on recent work

## Test Coverage Gaps

**JSONL parsing with edge cases:**
- What's not tested: Malformed lines (missing fields, invalid JSON), partial lines (file truncation), very long message content (100KB+)
- Files: `src/lib/claude-data/reader.ts:21-31` (forEachJsonlLine), `src/lib/claude-data/reader.ts:196-313` (parseSessionFile)
- Risk: Corruption or truncation could cause silent data loss without triggering errors
- Priority: High—core functionality

**Import/export round-trip:**
- What's not tested: Export → import → check totals match, handling of old exports, symlink rejection
- Files: `src/app/api/export/route.ts`, `src/app/api/import/route.ts`
- Risk: Imports could silently drop data or fail to switch data source
- Priority: High—data integrity critical

**Cache staleness and merge logic:**
- What's not tested: Stats merge when cache is days old, supplemental stats with overlapping dates, total calculations with missing cache
- Files: `src/lib/claude-data/reader.ts:634-751` (getDashboardStats)
- Risk: Dashboard totals could be incorrect if cache is stale
- Priority: Medium—users rely on cost/token accuracy

**API error responses:**
- What's not tested: 404 errors (missing session), 500 errors (filesystem errors), malformed query params
- Files: All API routes in `src/app/api/`
- Risk: Unclear error messages, unexpected crashes
- Priority: Medium—poor UX but not data loss

---

*Concerns audit: 2026-03-17*
