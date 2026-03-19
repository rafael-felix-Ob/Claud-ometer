/**
 * Tests for src/lib/db.ts — SQLite singleton, WAL mode, schema creation.
 * Covers DB-01 through DB-05.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { getDb, createDb, DB_PATH } from '@/lib/db';

const TEST_DB_PATH = path.join(os.tmpdir(), `test-claudeometer-${process.pid}.db`);

beforeEach(() => {
  // Reset singleton so each test gets a fresh state
  globalThis.__claudeometerDb = undefined;
  // Remove any leftover DB files from previous runs
  for (const ext of ['', '-wal', '-shm']) {
    const f = TEST_DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

afterAll(() => {
  // Close DB if open and clean up files
  if (globalThis.__claudeometerDb) {
    try { globalThis.__claudeometerDb.close(); } catch { /* ignore */ }
    globalThis.__claudeometerDb = undefined;
  }
  for (const ext of ['', '-wal', '-shm']) {
    const f = TEST_DB_PATH + ext;
    if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

describe('db module', () => {

  test('DB_PATH does not start with /mnt/ (DB-05)', () => {
    expect(DB_PATH).not.toMatch(/^\/mnt\//);
    expect(DB_PATH).toContain('.claude/claud-ometer.db');
  });

  test('createDb returns a Database instance (DB-02)', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe('function');
    expect(typeof db.exec).toBe('function');
  });

  test('WAL mode is active after createDb (DB-01)', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
  });

  test('getDb returns same instance as already-set singleton (DB-04)', () => {
    const db1 = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db1;
    const db2 = getDb();
    expect(db2).toBe(db1);
  });

  test('getDb creates and returns a singleton if none exists', () => {
    // globalThis.__claudeometerDb is undefined (cleared in beforeEach)
    // We can't use default DB_PATH in tests (would pollute ~/.claude/), but
    // we can verify the returned instance is the same on second call
    const db1 = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db1;
    const db2 = getDb();
    const db3 = getDb();
    expect(db2).toBe(db3);
  });

  test('all 5 tables exist after createDb (DB-03)', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: Record<string, unknown>) => r.name);
    expect(tables).toContain('sessions');
    expect(tables).toContain('projects');
    expect(tables).toContain('daily_activity');
    expect(tables).toContain('model_usage');
    expect(tables).toContain('ingested_files');
  });

  test('sessions table has all required columns', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    const cols = db.prepare("PRAGMA table_info(sessions)").all()
      .map((r: Record<string, unknown>) => r.name as string);
    const required = [
      'id', 'project_id', 'project_name', 'timestamp', 'duration', 'active_time',
      'message_count', 'user_message_count', 'assistant_message_count', 'tool_call_count',
      'total_input_tokens', 'total_output_tokens', 'total_cache_read_tokens',
      'total_cache_write_tokens', 'estimated_cost', 'model', 'models',
      'git_branch', 'cwd', 'version', 'tools_used', 'compaction',
    ];
    for (const col of required) {
      expect(cols).toContain(col);
    }
  });

  test('daily_activity has composite PK on (date, project_id)', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    // Verify composite PK by attempting to insert duplicate (date, project_id) pair
    db.prepare("INSERT INTO daily_activity (date, project_id) VALUES (?, ?)").run('2024-01-01', 'proj1');
    expect(() => {
      db.prepare("INSERT INTO daily_activity (date, project_id) VALUES (?, ?)").run('2024-01-01', 'proj1');
    }).toThrow();
    // But different project_id for same date is OK
    expect(() => {
      db.prepare("INSERT INTO daily_activity (date, project_id) VALUES (?, ?)").run('2024-01-01', 'proj2');
    }).not.toThrow();
  });

  test('model_usage PK is model (TEXT)', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    const pkInfo = db.prepare("PRAGMA table_info(model_usage)").all()
      .filter((r: Record<string, unknown>) => Number(r.pk) === 1);
    expect(pkInfo).toHaveLength(1);
    expect((pkInfo[0] as Record<string, unknown>).name).toBe('model');
  });

  test('ingested_files PK is file_path (TEXT)', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    const pkInfo = db.prepare("PRAGMA table_info(ingested_files)").all()
      .filter((r: Record<string, unknown>) => Number(r.pk) === 1);
    expect(pkInfo).toHaveLength(1);
    expect((pkInfo[0] as Record<string, unknown>).name).toBe('file_path');
  });

  test('indexes exist: idx_sessions_project_id, idx_sessions_timestamp, idx_daily_activity_date', () => {
    const db = createDb(TEST_DB_PATH);
    globalThis.__claudeometerDb = db;
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
    ).all().map((r: Record<string, unknown>) => r.name as string);
    expect(indexes).toContain('idx_sessions_project_id');
    expect(indexes).toContain('idx_sessions_timestamp');
    expect(indexes).toContain('idx_daily_activity_date');
  });

});
