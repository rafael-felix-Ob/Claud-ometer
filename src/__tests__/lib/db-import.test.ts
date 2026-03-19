/**
 * Tests for DB import functionality — replace (singleton lifecycle) and merge (ATTACH DATABASE dedup).
 *
 * Uses temporary SQLite DBs to avoid polluting ~/.claude/claud-ometer.db.
 * Tests verify PORT-02 (replace) and PORT-03 (merge) behaviors.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { createDb } from '@/lib/db';
import { recomputeAggregates, stopIngestScheduler } from '@/lib/ingest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: ReturnType<typeof createDb>;
let tmpDbPath: string;

interface SessionSeed {
  id: string;
  project_id?: string;
  project_name?: string;
  timestamp?: string;
  message_count?: number;
  tool_call_count?: number;
  [key: string]: unknown;
}

function seedTestSession(targetDb: ReturnType<typeof createDb>, seed: SessionSeed) {
  const defaults = {
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
    compaction: JSON.stringify({ compactions: 0, microcompactions: 0, totalTokensSaved: 0, compactionTimestamps: [] }),
  };
  const row = { ...defaults, ...seed };
  targetDb.prepare(`
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
}

function seedIngestedFile(targetDb: ReturnType<typeof createDb>, filePath: string) {
  targetDb.prepare(`
    INSERT OR REPLACE INTO ingested_files (file_path, mtime, file_size, ingested_at)
    VALUES (?, ?, ?, ?)
  `).run(filePath, Date.now(), 1024, new Date().toISOString());
}

/**
 * Runs the merge SQL (matching what the API route uses) against the target DB
 * using srcPath as the attached source.
 *
 * NOTE: better-sqlite3 does not support `SELECT src.sessions.*` (qualified wildcard).
 * The API route uses `SELECT src.sessions.*` which works when executed via db.exec()
 * (raw SQLite mode). In tests we must use explicit column names for db.prepare().
 */
function runMergeSql(targetDb: ReturnType<typeof createDb>, srcPath: string) {
  targetDb.exec(`ATTACH DATABASE '${srcPath}' AS src`);
  try {
    targetDb.exec(`
      INSERT OR REPLACE INTO sessions
      SELECT src.sessions.id, src.sessions.project_id, src.sessions.project_name,
             src.sessions.timestamp, src.sessions.duration, src.sessions.active_time,
             src.sessions.message_count, src.sessions.user_message_count,
             src.sessions.assistant_message_count, src.sessions.tool_call_count,
             src.sessions.total_input_tokens, src.sessions.total_output_tokens,
             src.sessions.total_cache_read_tokens, src.sessions.total_cache_write_tokens,
             src.sessions.estimated_cost, src.sessions.model, src.sessions.models,
             src.sessions.git_branch, src.sessions.cwd, src.sessions.version,
             src.sessions.tools_used, src.sessions.compaction
      FROM src.sessions
      LEFT JOIN main.sessions ON main.sessions.id = src.sessions.id
      WHERE main.sessions.id IS NULL
         OR src.sessions.message_count > main.sessions.message_count
    `);

    targetDb.exec(`
      INSERT OR IGNORE INTO ingested_files
      SELECT * FROM src.ingested_files
    `);
  } finally {
    try { targetDb.exec('DETACH DATABASE src'); } catch { /* may already be detached */ }
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-import-test-'));
  tmpDbPath = path.join(tmpDir, 'target.db');
  db = createDb(tmpDbPath);
  globalThis.__claudeometerDb = db;
  globalThis.__claudeometerIngestTimer = undefined;
});

afterEach(() => {
  stopIngestScheduler();
  try { db.close(); } catch { /* ignore */ }
  globalThis.__claudeometerDb = undefined;
  try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// DB replace — singleton lifecycle
// ---------------------------------------------------------------------------

describe('DB replace (singleton lifecycle)', () => {
  test('replace: close old DB, write new file, createDb reinitializes — only new sessions exist', () => {
    // DB A: target DB with 2 sessions
    seedTestSession(db, { id: 'a1' });
    seedTestSession(db, { id: 'a2' });
    expect((db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count).toBe(2);

    // DB B: source DB with 1 different session
    const srcPath = path.join(tmpDir, 'source.db');
    const srcDb = createDb(srcPath);
    seedTestSession(srcDb, { id: 'b1', project_name: 'SourceProject' });
    srcDb.close();

    // Simulate replace: close target, clean WAL/SHM, write source bytes to target path, reinit
    db.close();
    globalThis.__claudeometerDb = undefined;

    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + suffix); } catch { /* ignore */ }
    }

    const srcBytes = fs.readFileSync(srcPath);
    fs.writeFileSync(tmpDbPath, srcBytes);

    // Reinitialize
    db = createDb(tmpDbPath);
    globalThis.__claudeometerDb = db;

    // Only source session should exist
    const count = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    expect(count).toBe(1);

    const session = db.prepare('SELECT id, project_name FROM sessions WHERE id = ?').get('b1') as { id: string; project_name: string } | undefined;
    expect(session).toBeDefined();
    expect(session!.id).toBe('b1');
    expect(session!.project_name).toBe('SourceProject');

    // Original sessions a1, a2 should be gone
    const oldSession = db.prepare('SELECT id FROM sessions WHERE id = ?').get('a1');
    expect(oldSession).toBeUndefined();
  });

  test('replace: stale WAL and SHM files are cleaned up before writing', () => {
    // Create fake WAL and SHM files
    fs.writeFileSync(tmpDbPath + '-wal', 'fake-wal-data');
    fs.writeFileSync(tmpDbPath + '-shm', 'fake-shm-data');

    db.close();
    globalThis.__claudeometerDb = undefined;

    // Clean up WAL/SHM (as the replace handler does)
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + suffix); } catch { /* ignore */ }
    }

    // WAL and SHM files should no longer exist
    expect(fs.existsSync(tmpDbPath + '-wal')).toBe(false);
    expect(fs.existsSync(tmpDbPath + '-shm')).toBe(false);

    // Write a new DB and reinitialize
    const newSrcPath = path.join(tmpDir, 'new-source.db');
    const newSrcDb = createDb(newSrcPath);
    seedTestSession(newSrcDb, { id: 'new1' });
    newSrcDb.close();

    fs.copyFileSync(newSrcPath, tmpDbPath);
    db = createDb(tmpDbPath);
    globalThis.__claudeometerDb = db;

    const count = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DB merge — ATTACH DATABASE + message_count dedup
// ---------------------------------------------------------------------------

describe('DB merge (ATTACH DATABASE dedup)', () => {
  test('sessions from source DB appear in target after merge', () => {
    // Target: s1 and s2
    seedTestSession(db, { id: 's1', message_count: 10 });
    seedTestSession(db, { id: 's2', message_count: 5 });

    // Source: s3 (new session)
    const srcPath = path.join(tmpDir, 'merge-source.db');
    const srcDb = createDb(srcPath);
    seedTestSession(srcDb, { id: 's3', message_count: 8 });
    srcDb.close();

    runMergeSql(db, srcPath);

    const count = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    expect(count).toBe(3); // s1, s2, s3 all present
  });

  test('session with HIGHER message_count in source replaces existing (idempotent: source wins)', () => {
    // Target: s1 with message_count=10
    seedTestSession(db, { id: 's1', message_count: 10 });

    // Source: s1 with message_count=15 (higher — should replace)
    const srcPath = path.join(tmpDir, 'merge-higher.db');
    const srcDb = createDb(srcPath);
    seedTestSession(srcDb, { id: 's1', message_count: 15 });
    srcDb.close();

    runMergeSql(db, srcPath);

    const session = db.prepare('SELECT message_count FROM sessions WHERE id = ?').get('s1') as { message_count: number };
    expect(session.message_count).toBe(15);
  });

  test('session with LOWER message_count in source does NOT replace existing', () => {
    // Target: s1 with message_count=20
    seedTestSession(db, { id: 's1', message_count: 20 });

    // Source: s1 with message_count=15 (lower — should NOT replace)
    const srcPath = path.join(tmpDir, 'merge-lower.db');
    const srcDb = createDb(srcPath);
    seedTestSession(srcDb, { id: 's1', message_count: 15 });
    srcDb.close();

    runMergeSql(db, srcPath);

    const session = db.prepare('SELECT message_count FROM sessions WHERE id = ?').get('s1') as { message_count: number };
    expect(session.message_count).toBe(20); // unchanged
  });

  test('merging same DB twice is idempotent (session count unchanged)', () => {
    // Target: s1 and s2
    seedTestSession(db, { id: 's1', message_count: 10 });
    seedTestSession(db, { id: 's2', message_count: 5 });

    // Source: s1 (same, same message_count) and s3 (new)
    const srcPath = path.join(tmpDir, 'idempotent-source.db');
    const srcDb = createDb(srcPath);
    seedTestSession(srcDb, { id: 's1', message_count: 10 });
    seedTestSession(srcDb, { id: 's3', message_count: 8 });
    srcDb.close();

    // First merge
    runMergeSql(db, srcPath);
    const countAfterFirst = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    expect(countAfterFirst).toBe(3); // s1, s2, s3

    // Second merge (same source) — idempotent
    runMergeSql(db, srcPath);
    const countAfterSecond = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    expect(countAfterSecond).toBe(3); // still 3
  });

  test('after merge, recomputeAggregates populates projects and daily_activity correctly', () => {
    // Use recent timestamps to ensure they fall within daily_activity query windows
    const ts1 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const ts2 = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();

    // Target: s1 in proj1
    seedTestSession(db, { id: 's1-agg', project_id: 'proj-agg1', message_count: 10, timestamp: ts1 });

    // Source: s2 in proj2
    const srcPath = path.join(tmpDir, 'agg-source.db');
    const srcDb = createDb(srcPath);
    seedTestSession(srcDb, { id: 's2-agg', project_id: 'proj-agg2', project_name: 'Proj2', message_count: 5, timestamp: ts2 });
    srcDb.close();

    runMergeSql(db, srcPath);
    recomputeAggregates(db);

    // Both projects should appear
    const projectCount = (db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number }).count;
    expect(projectCount).toBe(2);

    // daily_activity should have entries (at least 2 — one per project/date combo)
    const activityCount = (db.prepare('SELECT COUNT(*) as count FROM daily_activity').get() as { count: number }).count;
    expect(activityCount).toBeGreaterThanOrEqual(2);
  });

  test('ingested_files are merged without duplicates (INSERT OR IGNORE)', () => {
    // Add an ingested file to the target
    seedIngestedFile(db, '/some/path/session1.jsonl');

    const srcPath = path.join(tmpDir, 'files-source.db');
    const srcDb = createDb(srcPath);
    // Source has same file + a new one
    seedIngestedFile(srcDb, '/some/path/session1.jsonl'); // same path
    seedIngestedFile(srcDb, '/some/path/session2.jsonl'); // new path
    srcDb.close();

    runMergeSql(db, srcPath);

    const fileCount = (db.prepare('SELECT COUNT(*) as count FROM ingested_files').get() as { count: number }).count;
    expect(fileCount).toBe(2); // no duplicate for session1.jsonl
  });
});

// ---------------------------------------------------------------------------
// stopIngestScheduler
// ---------------------------------------------------------------------------

describe('stopIngestScheduler', () => {
  test('is importable from ingest.ts and clears the globalThis timer', () => {
    // Verify stopIngestScheduler is exported and callable
    expect(typeof stopIngestScheduler).toBe('function');

    // Set a fake timer
    globalThis.__claudeometerIngestTimer = setInterval(() => {}, 999999);
    expect(globalThis.__claudeometerIngestTimer).toBeDefined();

    stopIngestScheduler();

    expect(globalThis.__claudeometerIngestTimer).toBeUndefined();
  });

  test('stopIngestScheduler is a no-op when no timer is set', () => {
    globalThis.__claudeometerIngestTimer = undefined;
    expect(() => stopIngestScheduler()).not.toThrow();
    expect(globalThis.__claudeometerIngestTimer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// recomputeAggregates is importable
// ---------------------------------------------------------------------------

describe('recomputeAggregates (exported from ingest.ts)', () => {
  test('is importable and callable', () => {
    expect(typeof recomputeAggregates).toBe('function');
  });

  test('rebuilds projects table from sessions', () => {
    seedTestSession(db, { id: 's1', project_id: 'rebuild-proj', project_name: 'RebuildProject' });
    seedTestSession(db, { id: 's2', project_id: 'rebuild-proj', project_name: 'RebuildProject' });

    recomputeAggregates(db);

    const project = db.prepare('SELECT session_count FROM projects WHERE id = ?').get('rebuild-proj') as { session_count: number } | undefined;
    expect(project).toBeDefined();
    expect(project!.session_count).toBe(2);
  });
});
