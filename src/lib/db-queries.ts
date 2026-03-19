/**
 * db-queries.ts — All DB query functions for API routes.
 *
 * Reads from SQLite (via getDb()) and returns the same TypeScript interfaces
 * (DashboardStats, SessionInfo[], ProjectInfo[], SessionDetail) that reader.ts returns.
 *
 * This is the foundation for Plan 02's API route migration.
 * All historical DB read logic lives here; routes call these when data source is "live".
 */

import { getDb } from '@/lib/db';
import { calculateCost, getModelDisplayName } from '@/config/pricing';
import { getSessionDetail } from '@/lib/claude-data/reader';
import type {
  SessionInfo,
  SessionDetail,
  ProjectInfo,
  DashboardStats,
  DailyActivity,
  DailyModelTokens,
  LongestSession,
  CompactionInfo,
} from '@/lib/claude-data/types';

// ---------------------------------------------------------------------------
// Internal DB row types
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  project_id: string;
  project_name: string;
  timestamp: string;
  duration: number;
  active_time: number;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_call_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  estimated_cost: number;
  model: string;
  models: string;          // JSON array string — stores display names (mapped by parseSessionFile)
  git_branch: string;
  cwd: string;
  version: string;
  tools_used: string;      // JSON object string
  compaction: string;      // JSON object string
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  session_count: number;
  total_messages: number;
  total_tokens: number;
  estimated_cost: number;
  last_active: string;
  models: string;          // Always '[]' from ingest — populated from sessions instead
}

interface TotalsRow {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  estimatedCost: number;
  firstSessionDate: string | null;
}

interface DailyActivityRow {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface DailyModelTokenRow {
  date: string;
  model: string;
  tokens: number;
}

interface ModelUsageRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  context_window: number;
  max_output_tokens: number;
  web_search_requests: number;
}

interface HourCountRow {
  hour: string;
  count: number;
}

interface LongestSessionRow {
  id: string;
  duration: number;
  message_count: number;
  timestamp: string;
}

interface ProjectCountRow {
  count: number;
}

interface ModelRow {
  project_id: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Internal helper — maps a DB session row to SessionInfo
// ---------------------------------------------------------------------------

function rowToSessionInfo(row: SessionRow): SessionInfo {
  const parsedModels: string[] = (() => {
    try { return JSON.parse(row.models || '[]'); } catch { return []; }
  })();

  const parsedToolsUsed: Record<string, number> = (() => {
    try { return JSON.parse(row.tools_used || '{}'); } catch { return {}; }
  })();

  const parsedCompactionRaw: Partial<CompactionInfo> = (() => {
    try { return JSON.parse(row.compaction || '{}'); } catch { return {}; }
  })();

  const compaction: CompactionInfo = {
    compactions: 0,
    microcompactions: 0,
    totalTokensSaved: 0,
    compactionTimestamps: [],
    ...parsedCompactionRaw,
  };

  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    timestamp: row.timestamp,
    duration: row.duration,
    activeTime: row.active_time,
    messageCount: row.message_count,
    userMessageCount: row.user_message_count,
    assistantMessageCount: row.assistant_message_count,
    toolCallCount: row.tool_call_count,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCacheReadTokens: row.total_cache_read_tokens,
    totalCacheWriteTokens: row.total_cache_write_tokens,
    estimatedCost: row.estimated_cost,
    model: row.model,
    models: parsedModels,
    gitBranch: row.git_branch,
    cwd: row.cwd,
    version: row.version,
    toolsUsed: parsedToolsUsed,
    compaction,
  };
}

// ---------------------------------------------------------------------------
// Exported query functions
// ---------------------------------------------------------------------------

/**
 * Returns aggregated dashboard stats from all DB tables.
 * Returns zero totals and empty arrays on an empty DB — never throws.
 */
export async function getDashboardStatsFromDb(): Promise<DashboardStats> {
  const db = getDb();

  // Totals from sessions table
  const totals = db.prepare(`
    SELECT
      COUNT(*) as totalSessions,
      COALESCE(SUM(message_count), 0) as totalMessages,
      COALESCE(SUM(total_input_tokens + total_output_tokens + total_cache_read_tokens + total_cache_write_tokens), 0) as totalTokens,
      COALESCE(SUM(estimated_cost), 0) as estimatedCost,
      MIN(timestamp) as firstSessionDate
    FROM sessions
  `).get() as TotalsRow;

  // Project count
  const projectCount = (db.prepare('SELECT COUNT(*) as count FROM projects').get() as ProjectCountRow).count;

  // Daily activity — GROUP BY date to aggregate across project_ids
  const dailyActivityRows = db.prepare(`
    SELECT
      date,
      SUM(message_count) as messageCount,
      SUM(session_count) as sessionCount,
      SUM(tool_call_count) as toolCallCount
    FROM daily_activity
    GROUP BY date
    ORDER BY date ASC
  `).all() as DailyActivityRow[];

  const dailyActivity: DailyActivity[] = dailyActivityRows.map(r => ({
    date: r.date,
    messageCount: r.messageCount,
    sessionCount: r.sessionCount,
    toolCallCount: r.toolCallCount,
  }));

  // Daily model tokens — from sessions table, grouped by date+model
  // SQLite substr is 1-indexed: substr('2024-03-01T10:30:00Z', 1, 10) = '2024-03-01'
  const dailyModelTokenRows = db.prepare(`
    SELECT
      substr(timestamp, 1, 10) as date,
      model,
      SUM(total_input_tokens + total_output_tokens + total_cache_read_tokens + total_cache_write_tokens) as tokens
    FROM sessions
    WHERE model != '' AND model != 'unknown'
    GROUP BY date, model
    ORDER BY date ASC
  `).all() as DailyModelTokenRow[];

  // Transform flat rows into DailyModelTokens[] grouped by date
  const dailyModelMap = new Map<string, Record<string, number>>();
  for (const row of dailyModelTokenRows) {
    let dayMap = dailyModelMap.get(row.date);
    if (!dayMap) {
      dayMap = {};
      dailyModelMap.set(row.date, dayMap);
    }
    dayMap[row.model] = (dayMap[row.model] || 0) + row.tokens;
  }
  const dailyModelTokens: DailyModelTokens[] = Array.from(dailyModelMap.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Model usage from model_usage table
  const modelUsageRows = db.prepare('SELECT * FROM model_usage').all() as ModelUsageRow[];
  const modelUsage: DashboardStats['modelUsage'] = {};
  for (const row of modelUsageRows) {
    const estimatedCost = calculateCost(
      row.model,
      row.input_tokens,
      row.output_tokens,
      row.cache_creation_input_tokens,
      row.cache_read_input_tokens,
    );
    modelUsage[row.model] = {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadInputTokens: row.cache_read_input_tokens,
      cacheCreationInputTokens: row.cache_creation_input_tokens,
      costUSD: calculateCost(row.model, row.input_tokens, row.output_tokens, row.cache_creation_input_tokens, row.cache_read_input_tokens),
      contextWindow: row.context_window || 0,
      maxOutputTokens: row.max_output_tokens || 0,
      webSearchRequests: row.web_search_requests || 0,
      estimatedCost,
    };
  }

  // Hour counts — SQLite substr is 1-indexed; position 12, length 2 gives chars at index 11-12
  // For '2024-03-01T10:30:00Z', substr(timestamp, 12, 2) = '10'
  const hourCountRows = db.prepare(`
    SELECT substr(timestamp, 12, 2) as hour, COUNT(*) as count
    FROM sessions
    GROUP BY hour
  `).all() as HourCountRow[];

  const hourCounts: Record<string, number> = {};
  for (const row of hourCountRows) {
    if (row.hour) {
      hourCounts[row.hour] = row.count;
    }
  }

  // Longest session
  const longestRow = db.prepare(`
    SELECT id, duration, message_count, timestamp
    FROM sessions
    ORDER BY duration DESC
    LIMIT 1
  `).get() as LongestSessionRow | undefined;

  const longestSession: LongestSession = longestRow
    ? {
        sessionId: longestRow.id,
        duration: longestRow.duration,
        messageCount: longestRow.message_count,
        timestamp: longestRow.timestamp,
      }
    : { sessionId: '', duration: 0, messageCount: 0, timestamp: '' };

  // Recent sessions (10 most recent)
  const recentRows = db.prepare(`
    SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 10
  `).all() as SessionRow[];
  const recentSessions: SessionInfo[] = recentRows.map(rowToSessionInfo);

  return {
    totalSessions: totals.totalSessions,
    totalMessages: totals.totalMessages,
    totalTokens: totals.totalTokens,
    estimatedCost: totals.estimatedCost,
    dailyActivity,
    dailyModelTokens,
    modelUsage,
    hourCounts,
    firstSessionDate: totals.firstSessionDate || '',
    longestSession,
    projectCount,
    recentSessions,
  };
}

/**
 * Returns paginated sessions sorted by timestamp DESC.
 */
export async function getSessionsFromDb(limit = 50, offset = 0): Promise<SessionInfo[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM sessions ORDER BY timestamp DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as SessionRow[];
  return rows.map(rowToSessionInfo);
}

/**
 * Returns all sessions for a specific project, sorted by timestamp DESC.
 */
export async function getProjectSessionsFromDb(projectId: string): Promise<SessionInfo[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM sessions WHERE project_id = ? ORDER BY timestamp DESC
  `).all(projectId) as SessionRow[];
  return rows.map(rowToSessionInfo);
}

/**
 * Searches sessions by project_name, git_branch, or cwd using LIKE.
 */
export async function searchSessionsFromDb(query: string, limit = 50): Promise<SessionInfo[]> {
  const db = getDb();
  const likeQuery = `%${query}%`;
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE project_name LIKE ? OR git_branch LIKE ? OR cwd LIKE ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(likeQuery, likeQuery, likeQuery, limit) as SessionRow[];
  return rows.map(rowToSessionInfo);
}

/**
 * Returns all projects with models populated from the sessions table.
 * The projects.models column is always '[]' from ingest; we fix it here by
 * querying distinct model values from sessions and mapping to display names.
 */
export async function getProjectsFromDb(): Promise<ProjectInfo[]> {
  const db = getDb();

  // Base project rows
  const projectRows = db.prepare(`
    SELECT * FROM projects ORDER BY last_active DESC
  `).all() as ProjectRow[];

  if (projectRows.length === 0) return [];

  // Build models map from sessions: project_id -> display name[]
  // sessions.model stores raw model IDs (e.g. 'claude-opus-4-6')
  const modelRows = db.prepare(`
    SELECT DISTINCT project_id, model FROM sessions
    WHERE model != '' AND model != 'unknown'
    ORDER BY project_id, model
  `).all() as ModelRow[];

  const modelsMap = new Map<string, Set<string>>();
  for (const row of modelRows) {
    let set = modelsMap.get(row.project_id);
    if (!set) {
      set = new Set();
      modelsMap.set(row.project_id, set);
    }
    set.add(getModelDisplayName(row.model));
  }

  return projectRows.map(row => ({
    id: row.id,
    name: row.name,
    path: row.path,
    sessionCount: row.session_count,
    totalMessages: row.total_messages,
    totalTokens: row.total_tokens,
    estimatedCost: row.estimated_cost,
    lastActive: row.last_active,
    models: Array.from(modelsMap.get(row.id) || []),
  }));
}

/**
 * Returns daily activity for a specific project over the last N days.
 * Filters by project_id and date >= N days ago, ordered by date ASC.
 * Used by the /api/projects/[id]/activity route for the project activity chart (UI-01).
 */
export function getProjectActivityFromDb(projectId: string, days = 30): DailyActivity[] {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const rows = db.prepare(`
    SELECT date,
           message_count as messageCount,
           session_count as sessionCount,
           tool_call_count as toolCallCount
    FROM daily_activity
    WHERE project_id = ? AND date >= ?
    ORDER BY date ASC
  `).all(projectId, since) as DailyActivity[];

  return rows;
}

/**
 * Returns DB aggregates merged with JSONL messages (hybrid pattern).
 * If the session row does not exist in DB, returns null.
 * If the JSONL file is missing, returns DB aggregates with empty messages[].
 */
export async function getSessionDetailFromDb(sessionId: string): Promise<SessionDetail | null> {
  const db = getDb();

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!row) return null;

  const sessionInfo = rowToSessionInfo(row);

  // Try to get messages from JSONL reader (hybrid: DB aggregates + JSONL messages)
  let messages: SessionDetail['messages'] = [];
  try {
    const detail = await getSessionDetail(sessionId);
    if (detail) {
      messages = detail.messages;
    }
  } catch {
    // JSONL file missing or unreadable — return DB aggregates with empty messages
  }

  return { ...sessionInfo, messages };
}
