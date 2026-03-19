/**
 * Tests for DB export functionality — WAL checkpoint + copy produces valid readable SQLite DB.
 *
 * Uses a temporary SQLite DB to avoid polluting ~/.claude/claud-ometer.db.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createDb } from '@/lib/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: ReturnType<typeof createDb>;
let tmpDbPath: string;

function seedTestSession(db: ReturnType<typeof createDb>, overrides: Record<string, unknown> = {}) {
  const defaults = {
    id: 'session-export-1',
    project_id: 'proj-export',
    project_name: 'ExportProject',
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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-export-test-'));
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
// DB export — wal_checkpoint + copyFileSync produces valid SQLite DB
// ---------------------------------------------------------------------------

describe('DB export via wal_checkpoint + copyFileSync', () => {
  test('wal_checkpoint(TRUNCATE) + copyFileSync produces a valid readable SQLite file', () => {
    // Seed some sessions
    seedTestSession(db, { id: 's1' });
    seedTestSession(db, { id: 's2', project_id: 'proj2' });

    // Simulate what the export route does: checkpoint WAL then copy
    db.pragma('wal_checkpoint(TRUNCATE)');

    const copyPath = path.join(tmpDir, 'exported.db');
    fs.copyFileSync(tmpDbPath, copyPath);

    // The copy should be a valid SQLite file
    expect(fs.existsSync(copyPath)).toBe(true);
    expect(fs.statSync(copyPath).size).toBeGreaterThan(0);

    // Open the copy with a fresh connection and verify sessions are readable
    const copyDb = new Database(copyPath, { readonly: true });
    try {
      const count = (copyDb.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
      expect(count).toBe(2);
    } finally {
      copyDb.close();
    }
  });

  test('exported copy contains all session data correctly', () => {
    seedTestSession(db, { id: 'session-abc', project_id: 'proj-x', message_count: 42 });

    db.pragma('wal_checkpoint(TRUNCATE)');

    const copyPath = path.join(tmpDir, 'export-data.db');
    fs.copyFileSync(tmpDbPath, copyPath);

    const copyDb = new Database(copyPath, { readonly: true });
    try {
      const session = copyDb.prepare('SELECT id, project_id, message_count FROM sessions WHERE id = ?').get('session-abc') as { id: string; project_id: string; message_count: number } | undefined;
      expect(session).toBeDefined();
      expect(session!.id).toBe('session-abc');
      expect(session!.project_id).toBe('proj-x');
      expect(session!.message_count).toBe(42);
    } finally {
      copyDb.close();
    }
  });

  test('copy opens without error even when original DB has WAL mode enabled', () => {
    // WAL mode is set by createDb() via applyPragmas
    // Confirm WAL mode is active
    const journalMode = db.pragma('journal_mode', { simple: true }) as string;
    expect(journalMode).toBe('wal');

    seedTestSession(db);

    // WAL checkpoint + copy should still succeed
    db.pragma('wal_checkpoint(TRUNCATE)');
    const copyPath = path.join(tmpDir, 'wal-copy.db');
    expect(() => {
      fs.copyFileSync(tmpDbPath, copyPath);
    }).not.toThrow();

    // Verify copy is readable
    const copyDb = new Database(copyPath, { readonly: true });
    try {
      expect(() => copyDb.prepare('SELECT COUNT(*) FROM sessions').run()).not.toThrow();
    } finally {
      copyDb.close();
    }
  });

  test('buffer read from exported copy matches file size', () => {
    seedTestSession(db);
    db.pragma('wal_checkpoint(TRUNCATE)');

    const copyPath = path.join(tmpDir, 'buffer-test.db');
    fs.copyFileSync(tmpDbPath, copyPath);

    const buffer = fs.readFileSync(copyPath);
    const fileSize = fs.statSync(copyPath).size;
    expect(buffer.length).toBe(fileSize);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
