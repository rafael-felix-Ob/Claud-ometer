import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

declare global {
  // eslint-disable-next-line no-var
  var __claudeometerDb: Database.Database | undefined;
}

export const DB_PATH = path.join(os.homedir(), '.claude', 'claud-ometer.db');

/**
 * Returns the singleton Database instance. Creates it on first call using
 * the default DB_PATH (~/.claude/claud-ometer.db on Linux ext4).
 */
export function getDb(): Database.Database {
  if (!globalThis.__claudeometerDb) {
    globalThis.__claudeometerDb = createDb(DB_PATH);
  }
  return globalThis.__claudeometerDb;
}

/**
 * Creates a new Database instance at the given path.
 * Applies WAL mode, performance pragmas, and ensures the full schema exists.
 * Exported for testability — tests pass a tmpdir path to avoid polluting ~/.claude/.
 */
export function createDb(dbPath: string): Database.Database {
  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  applyPragmas(db);
  ensureSchema(db);
  return db;
}

function applyPragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -65536');
  db.pragma('temp_store = MEMORY');
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                       TEXT PRIMARY KEY,
      project_id               TEXT NOT NULL,
      project_name             TEXT NOT NULL,
      timestamp                TEXT NOT NULL,
      duration                 INTEGER NOT NULL DEFAULT 0,
      active_time              INTEGER NOT NULL DEFAULT 0,
      message_count            INTEGER NOT NULL DEFAULT 0,
      user_message_count       INTEGER NOT NULL DEFAULT 0,
      assistant_message_count  INTEGER NOT NULL DEFAULT 0,
      tool_call_count          INTEGER NOT NULL DEFAULT 0,
      total_input_tokens       INTEGER NOT NULL DEFAULT 0,
      total_output_tokens      INTEGER NOT NULL DEFAULT 0,
      total_cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
      total_cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost           REAL NOT NULL DEFAULT 0,
      model                    TEXT NOT NULL DEFAULT '',
      models                   TEXT NOT NULL DEFAULT '[]',
      git_branch               TEXT NOT NULL DEFAULT '',
      cwd                      TEXT NOT NULL DEFAULT '',
      version                  TEXT NOT NULL DEFAULT '',
      tools_used               TEXT NOT NULL DEFAULT '{}',
      compaction               TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      path           TEXT NOT NULL,
      session_count  INTEGER NOT NULL DEFAULT 0,
      total_messages INTEGER NOT NULL DEFAULT 0,
      total_tokens   INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      last_active    TEXT NOT NULL DEFAULT '',
      models         TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS daily_activity (
      date            TEXT NOT NULL,
      project_id      TEXT NOT NULL,
      message_count   INTEGER NOT NULL DEFAULT 0,
      session_count   INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, project_id)
    );

    CREATE TABLE IF NOT EXISTS model_usage (
      model                       TEXT PRIMARY KEY,
      input_tokens                INTEGER NOT NULL DEFAULT 0,
      output_tokens               INTEGER NOT NULL DEFAULT 0,
      cache_read_input_tokens     INTEGER NOT NULL DEFAULT 0,
      cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd                    REAL NOT NULL DEFAULT 0,
      context_window              INTEGER NOT NULL DEFAULT 0,
      max_output_tokens           INTEGER NOT NULL DEFAULT 0,
      web_search_requests         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ingested_files (
      file_path   TEXT PRIMARY KEY,
      mtime       INTEGER NOT NULL,
      file_size   INTEGER NOT NULL,
      ingested_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_timestamp   ON sessions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_daily_activity_date  ON daily_activity(date);
  `);
}
