/**
 * Tests for src/lib/ingest.ts — delta check, bulk import, idempotency, scheduler guard.
 * Covers ING-01 through ING-03.
 *
 * All tests use a temporary directory to avoid polluting ~/.claude/ or the real DB.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { createDb } from '@/lib/db';
import { runIngestCycle, startIngestScheduler, getSyncStatus } from '@/lib/ingest';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: ReturnType<typeof createDb>;
let tmpDbPath: string;

/** Creates a minimal valid JSONL file at {tmpDir}/projects/{projectId}/{sessionId}.jsonl */
function createTestJsonl(
  projectId: string,
  sessionId: string,
  messageCount = 2,
  timestamp = '2024-03-01T10:00:00.000Z',
): string {
  const projectDir = path.join(tmpDir, 'projects', projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);

  const lines: object[] = [];
  for (let i = 0; i < messageCount; i++) {
    const isUser = i % 2 === 0;
    lines.push({
      type: isUser ? 'user' : 'assistant',
      sessionId,
      timestamp,
      uuid: `uuid-${i}`,
      parentUuid: i === 0 ? null : `uuid-${i - 1}`,
      cwd: `/home/test/projects/${projectId}`,
      version: '1.0.0',
      gitBranch: 'main',
      message: isUser
        ? { role: 'user', content: `Test message ${i}` }
        : {
            role: 'assistant',
            model: 'claude-opus-4-5',
            content: [{ type: 'text', text: `Response ${i}` }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
    });
  }

  fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n'));
  return filePath;
}

beforeEach(() => {
  // Fresh tmp dir and DB for each test
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-test-'));
  tmpDbPath = path.join(tmpDir, 'test.db');
  db = createDb(tmpDbPath);
  // Override the global singleton so ingest.ts uses our test DB
  globalThis.__claudeometerDb = db;
  // Reset ingest timer guard
  globalThis.__claudeometerIngestTimer = undefined;
});

afterEach(() => {
  // Clean up timer
  if (globalThis.__claudeometerIngestTimer) {
    clearInterval(globalThis.__claudeometerIngestTimer);
    globalThis.__claudeometerIngestTimer = undefined;
  }
  // Close DB
  try { db.close(); } catch { /* ignore */ }
  globalThis.__claudeometerDb = undefined;
  // Remove tmp dir
  try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// describe("startIngestScheduler")
// ---------------------------------------------------------------------------

describe('startIngestScheduler', () => {
  test('does not create duplicate timers on second call', async () => {
    const projectsDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });

    startIngestScheduler(projectsDir);
    const firstTimer = globalThis.__claudeometerIngestTimer;
    expect(firstTimer).toBeDefined();

    startIngestScheduler(projectsDir);
    const secondTimer = globalThis.__claudeometerIngestTimer;
    // Timer reference must NOT change — second call is a no-op
    expect(secondTimer).toBe(firstTimer);
  });
});

// ---------------------------------------------------------------------------
// describe("delta check")
// ---------------------------------------------------------------------------

describe('delta check', () => {
  test('skips file when mtime and size match ingested_files (ING-02)', async () => {
    const filePath = createTestJsonl('proj1', 'session1');
    const stat = fs.statSync(filePath);
    const mtime = Math.floor(stat.mtimeMs);

    // Pre-populate ingested_files with matching mtime + size
    db.prepare(
      'INSERT INTO ingested_files (file_path, mtime, file_size, ingested_at) VALUES (?, ?, ?, ?)',
    ).run(filePath, mtime, stat.size, new Date().toISOString());

    const projectsDir = path.join(tmpDir, 'projects');
    await runIngestCycle(projectsDir);

    const sessionCount = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    expect(sessionCount).toBe(0); // File was skipped
  });

  test('re-ingests file when mtime changes (ING-02)', async () => {
    const filePath = createTestJsonl('proj1', 'session1', 2);
    const projectsDir = path.join(tmpDir, 'projects');

    // First ingest
    await runIngestCycle(projectsDir);
    const countAfterFirst = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    expect(countAfterFirst).toBe(1);

    // Append a new line to change mtime + size
    const extraLine = JSON.stringify({
      type: 'user',
      sessionId: 'session1',
      timestamp: '2024-03-01T11:00:00.000Z',
      uuid: 'uuid-extra',
      parentUuid: 'uuid-1',
      cwd: '/home/test/projects/proj1',
      version: '1.0.0',
      gitBranch: 'main',
      message: { role: 'user', content: 'Extra message' },
    });
    fs.appendFileSync(filePath, '\n' + extraLine);

    // Second ingest — should re-process the file
    await runIngestCycle(projectsDir);
    const countAfterSecond = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    // Still 1 session (same session ID, updated row)
    expect(countAfterSecond).toBe(1);

    // Message count should be updated (now 3 messages)
    const session = db.prepare('SELECT message_count FROM sessions WHERE id = ?').get('session1') as { message_count: number } | undefined;
    expect(session).toBeDefined();
    expect(session!.message_count).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// describe("bulk import (first run)")
// ---------------------------------------------------------------------------

describe('bulk import (first run)', () => {
  test('imports all files when ingested_files is empty (ING-01)', async () => {
    createTestJsonl('proj1', 'session-a');
    createTestJsonl('proj1', 'session-b');
    createTestJsonl('proj2', 'session-c');

    const projectsDir = path.join(tmpDir, 'projects');
    await runIngestCycle(projectsDir);

    const sessionCount = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    const fileCount = (db.prepare('SELECT COUNT(*) as count FROM ingested_files').get() as { count: number }).count;

    expect(sessionCount).toBe(3);
    expect(fileCount).toBe(3);
  });

  test('is idempotent — running twice produces same row counts (ING-03)', async () => {
    createTestJsonl('proj1', 'session-a');
    createTestJsonl('proj1', 'session-b');
    createTestJsonl('proj2', 'session-c');

    const projectsDir = path.join(tmpDir, 'projects');

    await runIngestCycle(projectsDir);
    const sessionsAfterFirst = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    const filesAfterFirst = (db.prepare('SELECT COUNT(*) as count FROM ingested_files').get() as { count: number }).count;

    await runIngestCycle(projectsDir);
    const sessionsAfterSecond = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    const filesAfterSecond = (db.prepare('SELECT COUNT(*) as count FROM ingested_files').get() as { count: number }).count;

    expect(sessionsAfterSecond).toBe(sessionsAfterFirst);
    expect(filesAfterSecond).toBe(filesAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// describe("aggregate recompute")
// ---------------------------------------------------------------------------

describe('aggregate recompute', () => {
  test('populates projects table from sessions', async () => {
    createTestJsonl('proj1', 'session-a');
    createTestJsonl('proj1', 'session-b');
    createTestJsonl('proj2', 'session-c');

    const projectsDir = path.join(tmpDir, 'projects');
    await runIngestCycle(projectsDir);

    const projectCount = (db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number }).count;
    expect(projectCount).toBe(2);

    const proj1 = db.prepare('SELECT session_count FROM projects WHERE id = ?').get('proj1') as { session_count: number } | undefined;
    expect(proj1?.session_count).toBe(2);

    const proj2 = db.prepare('SELECT session_count FROM projects WHERE id = ?').get('proj2') as { session_count: number } | undefined;
    expect(proj2?.session_count).toBe(1);
  });

  test('populates daily_activity from sessions', async () => {
    createTestJsonl('proj1', 'session-a', 2, '2024-03-01T10:00:00.000Z');
    createTestJsonl('proj2', 'session-b', 2, '2024-03-02T10:00:00.000Z');

    const projectsDir = path.join(tmpDir, 'projects');
    await runIngestCycle(projectsDir);

    const activityCount = (db.prepare('SELECT COUNT(*) as count FROM daily_activity').get() as { count: number }).count;
    expect(activityCount).toBeGreaterThanOrEqual(1);

    const dates = (db.prepare('SELECT DISTINCT date FROM daily_activity ORDER BY date').all() as { date: string }[]).map(r => r.date);
    expect(dates.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// describe("getSyncStatus")
// ---------------------------------------------------------------------------

describe('getSyncStatus', () => {
  test('returns null lastSynced before first cycle', () => {
    const status = getSyncStatus();
    expect(status.lastSynced).toBeNull();
  });

  test('returns ISO timestamp and session count after cycle', async () => {
    createTestJsonl('proj1', 'session-a');
    createTestJsonl('proj1', 'session-b');

    const projectsDir = path.join(tmpDir, 'projects');
    await runIngestCycle(projectsDir);

    const status = getSyncStatus();
    expect(status.lastSynced).not.toBeNull();
    // Should be a valid ISO string
    expect(new Date(status.lastSynced!).toISOString()).toBe(status.lastSynced);
    expect(status.sessionCount).toBe(2);
    expect(status.isRunning).toBe(false);
  });
});
