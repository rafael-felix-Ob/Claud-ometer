# External Integrations

**Analysis Date:** 2026-03-17

## APIs & External Services

**Claude Code (Local):**
- Service: Claude Code local session data
- What it's used for: Reading JSONL session files from `~/.claude/projects/`
  - Client: Node.js `fs` + `readline` modules
  - Auth: File system access (no authentication)
  - Path: `src/lib/claude-data/reader.ts` parses JSONL files from `os.homedir()/.claude/`

## Data Storage

**Filesystem (Local Only):**
- Primary data source: `~/.claude/projects/<projectId>/<sessionId>.jsonl`
- Cache: `~/.claude/stats-cache.json`
- History: `~/.claude/history.jsonl`
- Settings: `~/.claude/settings.json`
- Subdirectories: `plans/`, `todos/`, `memory/` (in project folders)

**Imported Data:**
- Location: `.dashboard-data/` (project root)
- Purpose: Toggle between live (real-time) and imported (historical) data
- Toggle control: `src/lib/claude-data/data-source.ts`
  - Active source flag: `.dashboard-data/.use-imported`
  - Metadata: `.dashboard-data/meta.json`

**Data Access Method:**
- Client: Node.js `fs` module (`fs.readdirSync`, `fs.readFileSync`, `fs.openSync`)
- Parser: `readline` interface for streaming JSONL lines
- Type validation: Runtime JSON parsing with try-catch

## Caching Strategy

**Stats Cache:**
- File: `~/.claude/stats-cache.json`
- Populated by: Claude Code external to this dashboard
- Used by: `src/lib/claude-data/reader.ts` via `getStatsCache()`
- Fallback: Computed on-the-fly if cache stale/missing

**SWR Client-Side Caching:**
- Library: SWR 2.4.0 (`src/lib/hooks.ts`)
- Strategy: Automatic revalidation on window focus
- Hooks:
  - `useStats()` → `/api/stats`
  - `useProjects()` → `/api/projects`
  - `useSessions()` → `/api/sessions?q=&limit=&offset=`
  - `useSessionDetail()` → `/api/sessions/[id]`
  - `useProjectSessions()` → `/api/sessions?projectId=`

## Authentication & Identity

**Auth Provider:**
- None - Local-first application with no user authentication
- Assumption: Single user running Claude Code on local machine

**Access Control:**
- Implicit: Unix file permissions on `~/.claude/` directory
- No role-based or permission system implemented

## Monitoring & Observability

**Error Tracking:**
- None - No error reporting service integrated

**Logging:**
- Console logging only
- Used in: `src/app/api/export/route.ts` for error debugging
- Level: Basic error logging (no structured logging)

**Performance:**
- No APM/metrics collection
- No usage analytics sent externally

## CI/CD & Deployment

**Hosting:**
- Local development: `npm run dev` (Turbopack development server)
- Production: `npm run build` + `npm start`
- Runtime: Node.js server on local machine

**CI Pipeline:**
- None detected - No GitHub Actions, Jenkins, or other CI configured

**Build Outputs:**
- Turbopack: `.next/` directory (optimized Next.js build)

## Import/Export System

**Export Mechanism:**
- Endpoint: `GET /api/export` (`src/app/api/export/route.ts`)
- Format: ZIP archive containing entire `~/.claude/` structure
- Contents:
  - `stats-cache.json`
  - `history.jsonl`
  - `settings.json`
  - `projects/*/` (all JSONL session files)
  - `projects/*/memory/` (if exists)
  - `plans/` (if exists)
  - `todos/` (if exists)
  - `export-meta.json` with timestamp, hostname, platform
- Compression: ZIP with zlib compression level 6
- Filename: `claude-code-data-{timestamp}.zip`

**Import Mechanism:**
- Endpoint: `POST /api/import` (`src/app/api/import/route.ts`)
- Input: ZIP file upload (multipart/form-data)
- Validation: Must contain `claude-data/` directory structure
- Extraction: Unzips to `.dashboard-data/` directory
- Metadata: Extracts `export-meta.json` and counts projects/sessions
- Library: jszip 3.10.1 for ZIP parsing

**Data Source Toggle:**
- Endpoint: `GET/PUT /api/data-source` (`src/app/api/data-source/route.ts`)
- Controls: Switch between live `~/.claude/` and imported `.dashboard-data/`
- Delete: `DELETE /api/import` clears imported data

## Pricing & Cost Calculation

**Model Pricing (Hardcoded):**
- File: `src/config/pricing.ts`
- Supported models:
  - Claude Opus 4.6: $15/1M input, $75/1M output, $18.75/1M cache-write, $1.50/1M cache-read
  - Claude Sonnet 4.6: $3/1M input, $15/1M output, $3.75/1M cache-write, $0.30/1M cache-read
  - Claude Haiku 4.5: $0.80/1M input, $4/1M output, $1.00/1M cache-write, $0.08/1M cache-read
- Fallback: Searches for model family (opus/sonnet/haiku) if exact version not found
- Usage: Called in API routes to calculate `estimatedCost` for sessions and projects

## Webhooks & Callbacks

**Incoming:**
- None - Application is data read-only from local files

**Outgoing:**
- None - No external notifications or callbacks

## Session Data Format (JSONL)

**Source Format:**
- File format: JSON Lines (one JSON object per line)
- Location: `~/.claude/projects/<projectId>/<sessionId>.jsonl`
- Structure: Array of SessionMessage objects containing:
  - Message metadata: type, sessionId, timestamp, uuid, cwd, version, gitBranch
  - Token usage: input/output/cache tokens
  - Model information: model name
  - Tool call tracking: toolName, tool invocations
  - Compaction metadata: pre-tokens, tokens saved
  - Git context: branch name and working directory

**Parsed Types:**
- `SessionMessage` - Raw JSONL message object
- `SessionInfo` - Aggregated session metadata
- `SessionDetail` - Full session with message replay
- `SessionMessageDisplay` - Formatted message for UI display

## Environment Variables

**Not Used:**
- Application reads directly from filesystem
- No `.env` file or environment configuration
- No API keys, secrets, or credentials in environment

---

*Integration audit: 2026-03-17*
