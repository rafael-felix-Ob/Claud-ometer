/**
 * Tests for src/lib/db-queries.ts — all DB query functions.
 *
 * Uses a temporary SQLite DB to avoid polluting ~/.claude/claud-ometer.db.
 * Follows the same pattern as ingest.test.ts: createDb(tmpPath) + globalThis override.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { createDb } from '@/lib/db';
import {
  getDashboardStatsFromDb,
  getSessionsFromDb,
  getProjectSessionsFromDb,
  searchSessionsFromDb,
  getProjectsFromDb,
  getSessionDetailFromDb,
  getProjectActivityFromDb,
} from '@/lib/db-queries';
import { recomputeAggregates } from '@/lib/ingest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: ReturnType<typeof createDb>;
let tmpDbPath: string;

interface SessionSeed {
  id?: string;
  project_id?: string;
  project_name?: string;
  timestamp?: string;
  duration?: number;
  active_time?: number;
  message_count?: number;
  user_message_count?: number;
  assistant_message_count?: number;
  tool_call_count?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cache_read_tokens?: number;
  total_cache_write_tokens?: number;
  estimated_cost?: number;
  model?: string;
  models?: string;
  git_branch?: string;
  cwd?: string;
  version?: string;
  tools_used?: string;
  compaction?: string;
}

function seedTestSession(db: ReturnType<typeof createDb>, overrides: SessionSeed = {}) {
  const defaults: Required<SessionSeed> = {
    id: 'session-test-1',
    project_id: 'proj1',
    project_name: 'TestProject',
    timestamp: '2024-03-15T10:00:00.000Z',
    duration: 3600000,
    active_time: 1800000,
    message_count: 10,
    user_message_count: 5,
    assistant_message_count: 5,
    tool_call_count: 3,
    total_input_tokens: 1000,
    total_output_tokens: 500,
    total_cache_read_tokens: 200,
    total_cache_write_tokens: 100,
    estimated_cost: 0.025,
    model: 'claude-opus-4-5',
    models: JSON.stringify(['Opus']),
    git_branch: 'main',
    cwd: '/home/user/projects/test',
    version: '1.0.0',
    tools_used: JSON.stringify({ Read: 2, Write: 1 }),
    compaction: JSON.stringify({ compactions: 1, microcompactions: 0, totalTokensSaved: 500, compactionTimestamps: ['2024-03-15T10:30:00.000Z'] }),
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, project_id, project_name, timestamp, duration, active_time,
      message_count, user_message_count, assistant_message_count, tool_call_count,
      total_input_tokens, total_output_tokens, total_cache_read_tokens,
      total_cache_write_tokens, estimated_cost, model, models,
      git_branch, cwd, version, tools_used, compaction
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.project_id, row.project_name, row.timestamp, row.duration, row.active_time,
    row.message_count, row.user_message_count, row.assistant_message_count, row.tool_call_count,
    row.total_input_tokens, row.total_output_tokens, row.total_cache_read_tokens,
    row.total_cache_write_tokens, row.estimated_cost, row.model, row.models,
    row.git_branch, row.cwd, row.version, row.tools_used, row.compaction,
  );
  return row;
}

interface ProjectSeed {
  id?: string;
  name?: string;
  path?: string;
  session_count?: number;
  total_messages?: number;
  total_tokens?: number;
  estimated_cost?: number;
  last_active?: string;
  models?: string;
}

function seedTestProject(db: ReturnType<typeof createDb>, overrides: ProjectSeed = {}) {
  const defaults: Required<ProjectSeed> = {
    id: 'proj1',
    name: 'TestProject',
    path: '/home/user/projects/test',
    session_count: 1,
    total_messages: 10,
    total_tokens: 1800,
    estimated_cost: 0.025,
    last_active: '2024-03-15T10:00:00.000Z',
    models: '[]',
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, path, session_count, total_messages, total_tokens, estimated_cost, last_active, models)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.name, row.path, row.session_count, row.total_messages, row.total_tokens, row.estimated_cost, row.last_active, row.models);
  return row;
}

interface DailyActivitySeed {
  date?: string;
  project_id?: string;
  message_count?: number;
  session_count?: number;
  tool_call_count?: number;
}

function seedDailyActivity(db: ReturnType<typeof createDb>, overrides: DailyActivitySeed = {}) {
  const defaults: Required<DailyActivitySeed> = {
    date: '2024-03-15',
    project_id: 'proj1',
    message_count: 10,
    session_count: 1,
    tool_call_count: 3,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT OR REPLACE INTO daily_activity (date, project_id, message_count, session_count, tool_call_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.date, row.project_id, row.message_count, row.session_count, row.tool_call_count);
  return row;
}

interface ModelUsageSeed {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
  context_window?: number;
  max_output_tokens?: number;
  web_search_requests?: number;
}

function seedModelUsage(db: ReturnType<typeof createDb>, overrides: ModelUsageSeed = {}) {
  const defaults: Required<ModelUsageSeed> = {
    model: 'claude-opus-4-5',
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 200,
    cache_creation_input_tokens: 100,
    cost_usd: 0.025,
    context_window: 200000,
    max_output_tokens: 32000,
    web_search_requests: 0,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT OR REPLACE INTO model_usage (model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd, context_window, max_output_tokens, web_search_requests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.model, row.input_tokens, row.output_tokens, row.cache_read_input_tokens, row.cache_creation_input_tokens, row.cost_usd, row.context_window, row.max_output_tokens, row.web_search_requests);
  return row;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-queries-test-'));
  tmpDbPath = path.join(tmpDir, 'test.db');
  db = createDb(tmpDbPath);
  globalThis.__claudeometerDb = db;
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  globalThis.__claudeometerDb = undefined;
  try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// getDashboardStatsFromDb
// ---------------------------------------------------------------------------

describe('getDashboardStatsFromDb', () => {
  test('returns correct totals from seeded DB', async () => {
    seedTestSession(db, { total_input_tokens: 1000, total_output_tokens: 500, total_cache_read_tokens: 200, total_cache_write_tokens: 100, estimated_cost: 0.025, message_count: 10 });
    seedTestProject(db);
    seedDailyActivity(db);
    seedModelUsage(db);

    const stats = await getDashboardStatsFromDb();
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalMessages).toBe(10);
    expect(stats.estimatedCost).toBeGreaterThan(0);
    expect(stats.totalTokens).toBe(1800); // 1000 + 500 + 200 + 100
  });

  test('returns dailyActivity with one entry per date (GROUP BY date)', async () => {
    // Two sessions on same date, different projects — should merge into one dailyActivity entry
    seedTestSession(db, { id: 's1', project_id: 'proj1', timestamp: '2024-03-15T10:00:00.000Z' });
    seedTestSession(db, { id: 's2', project_id: 'proj2', timestamp: '2024-03-15T12:00:00.000Z' });
    // daily_activity has composite PK (date, project_id) so two rows exist
    seedDailyActivity(db, { date: '2024-03-15', project_id: 'proj1', message_count: 10 });
    seedDailyActivity(db, { date: '2024-03-15', project_id: 'proj2', message_count: 5 });
    seedModelUsage(db);
    seedTestProject(db);

    const stats = await getDashboardStatsFromDb();
    // Both daily_activity rows for 2024-03-15 must be grouped into ONE entry
    const marchEntry = stats.dailyActivity.find(d => d.date === '2024-03-15');
    expect(marchEntry).toBeDefined();
    expect(marchEntry!.messageCount).toBe(15); // 10 + 5
  });

  test('returns dailyModelTokens grouped by date and model', async () => {
    seedTestSession(db, { id: 's1', timestamp: '2024-03-15T10:00:00.000Z', model: 'claude-opus-4-5', total_input_tokens: 1000, total_output_tokens: 500, total_cache_read_tokens: 0, total_cache_write_tokens: 0 });
    seedTestProject(db);
    seedDailyActivity(db);
    seedModelUsage(db);

    const stats = await getDashboardStatsFromDb();
    expect(stats.dailyModelTokens.length).toBeGreaterThan(0);
    const dayTokens = stats.dailyModelTokens.find(d => d.date === '2024-03-15');
    expect(dayTokens).toBeDefined();
    expect(typeof dayTokens!.tokensByModel).toBe('object');
  });

  test('returns modelUsage with estimatedCost per model from model_usage table', async () => {
    seedTestSession(db);
    seedTestProject(db);
    seedDailyActivity(db);
    seedModelUsage(db, { model: 'claude-opus-4-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 });

    const stats = await getDashboardStatsFromDb();
    expect(Object.keys(stats.modelUsage).length).toBeGreaterThan(0);
    const modelEntry = Object.values(stats.modelUsage)[0];
    expect(typeof modelEntry.estimatedCost).toBe('number');
  });

  test('returns hourCounts with two-digit string keys', async () => {
    seedTestSession(db, { timestamp: '2024-03-15T09:00:00.000Z' });
    seedTestProject(db);
    seedDailyActivity(db);
    seedModelUsage(db);

    const stats = await getDashboardStatsFromDb();
    const keys = Object.keys(stats.hourCounts);
    expect(keys.length).toBeGreaterThan(0);
    // All keys must be two-digit strings
    for (const key of keys) {
      expect(key).toMatch(/^\d{2}$/);
    }
  });

  test('returns longestSession from sessions ORDER BY duration DESC LIMIT 1', async () => {
    seedTestSession(db, { id: 's-short', duration: 1000 });
    seedTestSession(db, { id: 's-long', duration: 999999 });
    seedTestProject(db);
    seedDailyActivity(db);
    seedModelUsage(db);

    const stats = await getDashboardStatsFromDb();
    expect(stats.longestSession.sessionId).toBe('s-long');
    expect(stats.longestSession.duration).toBe(999999);
  });

  test('returns recentSessions (10 most recent) as SessionInfo[]', async () => {
    // Seed 12 sessions with different timestamps
    for (let i = 1; i <= 12; i++) {
      const ts = `2024-03-${String(i).padStart(2, '0')}T10:00:00.000Z`;
      seedTestSession(db, { id: `s-${i}`, timestamp: ts });
    }
    seedTestProject(db);
    seedDailyActivity(db);
    seedModelUsage(db);

    const stats = await getDashboardStatsFromDb();
    expect(stats.recentSessions.length).toBe(10);
    // Must be sorted by timestamp DESC — first item is the most recent
    expect(stats.recentSessions[0].timestamp).toBe('2024-03-12T10:00:00.000Z');
  });

  test('on empty DB returns zero totals and empty arrays (no crash)', async () => {
    const stats = await getDashboardStatsFromDb();
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.estimatedCost).toBe(0);
    expect(stats.dailyActivity).toEqual([]);
    expect(stats.dailyModelTokens).toEqual([]);
    expect(stats.recentSessions).toEqual([]);
    expect(stats.longestSession).toEqual({ sessionId: '', duration: 0, messageCount: 0, timestamp: '' });
  });
});

// ---------------------------------------------------------------------------
// getSessionsFromDb
// ---------------------------------------------------------------------------

describe('getSessionsFromDb', () => {
  test('returns SessionInfo[] sorted by timestamp DESC with JSON fields parsed', async () => {
    seedTestSession(db, { id: 's1', timestamp: '2024-03-01T10:00:00.000Z' });
    seedTestSession(db, { id: 's2', timestamp: '2024-03-15T10:00:00.000Z' });

    const sessions = await getSessionsFromDb();
    expect(sessions.length).toBe(2);
    // Most recent first
    expect(sessions[0].id).toBe('s2');
    // JSON fields must be parsed
    expect(Array.isArray(sessions[0].models)).toBe(true);
    expect(typeof sessions[0].toolsUsed).toBe('object');
    expect(typeof sessions[0].compaction).toBe('object');
    expect(typeof sessions[0].compaction.compactions).toBe('number');
  });

  test('respects limit and offset', async () => {
    for (let i = 1; i <= 5; i++) {
      seedTestSession(db, { id: `s-${i}`, timestamp: `2024-03-${String(i).padStart(2, '0')}T10:00:00.000Z` });
    }
    const page1 = await getSessionsFromDb(2, 0);
    const page2 = await getSessionsFromDb(2, 2);
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  test('compaction defaults set when compaction JSON is missing fields', async () => {
    seedTestSession(db, { id: 's1', compaction: '{}' });
    const sessions = await getSessionsFromDb();
    expect(sessions[0].compaction.compactions).toBe(0);
    expect(sessions[0].compaction.microcompactions).toBe(0);
    expect(sessions[0].compaction.totalTokensSaved).toBe(0);
    expect(Array.isArray(sessions[0].compaction.compactionTimestamps)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getProjectSessionsFromDb
// ---------------------------------------------------------------------------

describe('getProjectSessionsFromDb', () => {
  test('returns only sessions for the specified project', async () => {
    seedTestSession(db, { id: 's1', project_id: 'proj1' });
    seedTestSession(db, { id: 's2', project_id: 'proj2' });

    const sessions = await getProjectSessionsFromDb('proj1');
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('s1');
    expect(sessions[0].projectId).toBe('proj1');
  });

  test('returns empty array for unknown project', async () => {
    const sessions = await getProjectSessionsFromDb('does-not-exist');
    expect(sessions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchSessionsFromDb
// ---------------------------------------------------------------------------

describe('searchSessionsFromDb', () => {
  test('matches on project_name using LIKE', async () => {
    seedTestSession(db, { id: 's1', project_name: 'MyAwesomeProject' });
    seedTestSession(db, { id: 's2', project_name: 'AnotherProject' });

    const results = await searchSessionsFromDb('Awesome');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('s1');
  });

  test('matches on git_branch using LIKE', async () => {
    seedTestSession(db, { id: 's1', git_branch: 'feature/my-feature' });
    seedTestSession(db, { id: 's2', git_branch: 'main' });

    const results = await searchSessionsFromDb('my-feature');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('s1');
  });

  test('matches on cwd using LIKE', async () => {
    seedTestSession(db, { id: 's1', cwd: '/home/user/special-project' });
    seedTestSession(db, { id: 's2', cwd: '/home/user/other' });

    const results = await searchSessionsFromDb('special-project');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('s1');
  });

  test('returns empty array when no match', async () => {
    seedTestSession(db, { id: 's1', project_name: 'MyProject' });

    const results = await searchSessionsFromDb('xyz-no-match');
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getProjectsFromDb
// ---------------------------------------------------------------------------

describe('getProjectsFromDb', () => {
  test('returns ProjectInfo[] with models populated from sessions table (not empty [])', async () => {
    seedTestProject(db, { id: 'proj1', models: '[]' }); // empty models in projects table
    seedTestSession(db, { id: 's1', project_id: 'proj1', model: 'claude-opus-4-5' });
    seedTestSession(db, { id: 's2', project_id: 'proj1', model: 'claude-sonnet-4-5' });

    const projects = await getProjectsFromDb();
    expect(projects.length).toBe(1);
    expect(projects[0].models.length).toBeGreaterThan(0);
    // Models should be display names (Opus, Sonnet, Haiku)
    expect(projects[0].models).toContain('Opus');
  });

  test('returns projects sorted by last_active DESC', async () => {
    seedTestProject(db, { id: 'proj-old', last_active: '2024-01-01T00:00:00.000Z' });
    seedTestProject(db, { id: 'proj-new', last_active: '2024-12-31T00:00:00.000Z' });

    const projects = await getProjectsFromDb();
    expect(projects.length).toBe(2);
    expect(projects[0].id).toBe('proj-new');
  });

  test('returns empty array for empty DB', async () => {
    const projects = await getProjectsFromDb();
    expect(projects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSessionDetailFromDb
// ---------------------------------------------------------------------------

describe('getSessionDetailFromDb', () => {
  test('returns null for non-existent session', async () => {
    const detail = await getSessionDetailFromDb('does-not-exist');
    expect(detail).toBeNull();
  });

  test('returns DB aggregates with empty messages when JSONL file is missing', async () => {
    // Seed DB session but no JSONL file exists (JSONL reader will return null)
    seedTestSession(db, { id: 's1', project_id: 'proj1', message_count: 5 });

    const detail = await getSessionDetailFromDb('s1');
    // Should still return session info from DB
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('s1');
    expect(detail!.messageCount).toBe(5);
    // Messages empty because JSONL not found
    expect(Array.isArray(detail!.messages)).toBe(true);
  });

  test('maps DB row fields to SessionInfo correctly', async () => {
    seedTestSession(db, {
      id: 's1',
      project_id: 'proj-abc',
      project_name: 'AbcProject',
      total_input_tokens: 1234,
      total_output_tokens: 567,
      estimated_cost: 0.0999,
      compaction: JSON.stringify({ compactions: 2, microcompactions: 1, totalTokensSaved: 1000, compactionTimestamps: [] }),
    });

    const detail = await getSessionDetailFromDb('s1');
    expect(detail).not.toBeNull();
    expect(detail!.projectId).toBe('proj-abc');
    expect(detail!.projectName).toBe('AbcProject');
    expect(detail!.totalInputTokens).toBe(1234);
    expect(detail!.totalOutputTokens).toBe(567);
    expect(detail!.compaction.compactions).toBe(2);
    expect(detail!.compaction.microcompactions).toBe(1);
    expect(detail!.compaction.totalTokensSaved).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// getProjectActivityFromDb
// ---------------------------------------------------------------------------

describe('getProjectActivityFromDb', () => {
  test('returns DailyActivity[] filtered by project_id', () => {
    // Use recent timestamps within the 30-day window
    const recentTs = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    // Seed sessions for two projects, then recompute aggregates to populate daily_activity
    seedTestSession(db, { id: 's1-activity', project_id: 'proj-a', project_name: 'ProjA', timestamp: recentTs });
    seedTestSession(db, { id: 's2-activity', project_id: 'proj-b', project_name: 'ProjB', timestamp: recentTs });
    recomputeAggregates(db);

    const activity = getProjectActivityFromDb('proj-a');
    expect(Array.isArray(activity)).toBe(true);
    // Should only return activity for proj-a
    for (const entry of activity) {
      expect(entry.date).toBeDefined();
      expect(typeof entry.messageCount).toBe('number');
      expect(typeof entry.sessionCount).toBe('number');
      expect(typeof entry.toolCallCount).toBe('number');
    }
  });

  test('returns empty array for unknown project_id', () => {
    seedTestSession(db, { id: 's1', project_id: 'proj-x', project_name: 'ProjX', timestamp: '2024-03-15T10:00:00.000Z' });
    recomputeAggregates(db);

    const activity = getProjectActivityFromDb('proj-does-not-exist');
    expect(activity).toEqual([]);
  });

  test('results are ordered by date ASC', () => {
    // Use recent dates within the 30-day window
    const d1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const d2 = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const d3 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    seedTestSession(db, { id: 's1-ordered', project_id: 'proj-ordered', project_name: 'ProjOrdered', timestamp: d3 });
    seedTestSession(db, { id: 's2-ordered', project_id: 'proj-ordered', project_name: 'ProjOrdered', timestamp: d1 });
    seedTestSession(db, { id: 's3-ordered', project_id: 'proj-ordered', project_name: 'ProjOrdered', timestamp: d2 });
    recomputeAggregates(db);

    const activity = getProjectActivityFromDb('proj-ordered');
    expect(activity.length).toBe(3);
    // Dates should be in ascending order
    for (let i = 1; i < activity.length; i++) {
      expect(activity[i].date >= activity[i - 1].date).toBe(true);
    }
  });

  test('respects 30-day window (excludes records older than 30 days)', () => {
    // Seed a very old session (more than 30 days ago)
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    seedTestSession(db, { id: 's-old', project_id: 'proj-window', project_name: 'ProjWindow', timestamp: oldDate });
    seedTestSession(db, { id: 's-recent', project_id: 'proj-window', project_name: 'ProjWindow', timestamp: recentDate });
    recomputeAggregates(db);

    const activity = getProjectActivityFromDb('proj-window', 30);
    // Old session should be excluded
    const oldDateStr = oldDate.slice(0, 10);
    const oldEntry = activity.find(a => a.date === oldDateStr);
    expect(oldEntry).toBeUndefined();

    // Recent session should be included
    const recentDateStr = recentDate.slice(0, 10);
    const recentEntry = activity.find(a => a.date === recentDateStr);
    expect(recentEntry).toBeDefined();
  });
});
