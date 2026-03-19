/**
 * Ingest engine — populates SQLite from JSONL files with delta detection.
 *
 * Exports:
 *   runIngestCycle(projectsDir?)  — scan JSONL files, apply delta check, upsert sessions
 *   startIngestScheduler(projectsDir?) — one-time scheduler setup via globalThis guard
 *   getSyncStatus()              — last sync time, session count, running flag
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '@/lib/db';
import { parseSessionFile } from '@/lib/claude-data/reader';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Module-level sync status (ING-04)
// ---------------------------------------------------------------------------

let lastSyncedAt: string | null = null;
let lastSessionCount: number = 0;
let isCurrentlyRunning: boolean = false;

declare global {
  var __claudeometerIngestTimer: ReturnType<typeof setInterval> | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SyncStatus {
  lastSynced: string | null;
  sessionCount: number;
  isRunning: boolean;
}

export function getSyncStatus(): SyncStatus {
  return {
    lastSynced: lastSyncedAt,
    sessionCount: lastSessionCount,
    isRunning: isCurrentlyRunning,
  };
}

/**
 * Resets module-level sync state. Only for use in tests.
 * @internal
 */
export function _resetSyncStateForTesting(): void {
  lastSyncedAt = null;
  lastSessionCount = 0;
  isCurrentlyRunning = false;
}

/**
 * Starts the ingest scheduler. Runs an immediate cycle then schedules repeating
 * cycles every 2 minutes. Safe to call multiple times — subsequent calls are no-ops.
 *
 * @param projectsDir Optional override for testability (defaults to ~/.claude/projects)
 */
export function startIngestScheduler(projectsDir?: string): void {
  if (globalThis.__claudeometerIngestTimer) return;

  // Run immediately on startup
  runIngestCycle(projectsDir).catch(console.error);

  // Schedule repeating cycles
  globalThis.__claudeometerIngestTimer = setInterval(() => {
    runIngestCycle(projectsDir).catch(console.error);
  }, 120_000);
}

/**
 * Scans all .jsonl files in projectsDir, applies two-factor delta check
 * (mtime + file size), parses changed files, and upserts into the sessions table.
 * Recomputes aggregate tables (projects, daily_activity, model_usage) afterward.
 *
 * @param projectsDir Optional override for testability (defaults to ~/.claude/projects)
 */
export async function runIngestCycle(projectsDir?: string): Promise<void> {
  // Concurrency guard — skip if already running
  if (isCurrentlyRunning) return;
  isCurrentlyRunning = true;

  try {
    const db = getDb();
    const resolvedProjectsDir = projectsDir ?? path.join(os.homedir(), '.claude', 'projects');

    if (!fs.existsSync(resolvedProjectsDir)) {
      return;
    }

    // Collect all .jsonl files and their stat info
    const changedFiles: Array<{
      filePath: string;
      projectId: string;
      projectName: string;
      mtime: number;
      size: number;
    }> = [];

    const projectDirs = fs.readdirSync(resolvedProjectsDir);

    for (const projectId of projectDirs) {
      const projectDirPath = path.join(resolvedProjectsDir, projectId);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(projectDirPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const projectName = getProjectName(projectDirPath, projectId);
      let files: string[];
      try {
        files = fs.readdirSync(projectDirPath).filter(f => f.endsWith('.jsonl'));
      } catch {
        continue;
      }

      for (const fileName of files) {
        const filePath = path.join(projectDirPath, fileName);

        let fileStat: fs.Stats;
        try {
          fileStat = fs.statSync(filePath);
        } catch {
          continue;
        }

        const mtime = Math.floor(fileStat.mtimeMs);
        const size = fileStat.size;

        // Delta check — skip if mtime and size unchanged
        const existing = db
          .prepare('SELECT mtime, file_size FROM ingested_files WHERE file_path = ?')
          .get(filePath) as { mtime: number; file_size: number } | undefined;

        if (existing && existing.mtime === mtime && existing.file_size === size) {
          continue; // No change — skip
        }

        changedFiles.push({ filePath, projectId, projectName, mtime, size });
      }
    }

    if (changedFiles.length === 0) {
      // Still update sync status even if nothing changed
      lastSyncedAt = new Date().toISOString();
      lastSessionCount = (
        db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }
      ).count;
      return;
    }

    // Parse all changed files (outside the transaction — async IO)
    const parsedSessions: Array<{
      session: Awaited<ReturnType<typeof parseSessionFile>>;
      filePath: string;
      mtime: number;
      size: number;
    }> = [];

    for (const { filePath, projectId, projectName, mtime, size } of changedFiles) {
      try {
        const session = await parseSessionFile(filePath, projectId, projectName);
        parsedSessions.push({ session, filePath, mtime, size });
      } catch (err) {
        console.warn(`[ingest] Skipping ${filePath}: ${(err as Error).message}`);
      }
    }

    // Upsert all sessions + ingested_files in a single atomic transaction
    const insertSession = db.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, project_id, project_name, timestamp, duration, active_time,
        message_count, user_message_count, assistant_message_count, tool_call_count,
        total_input_tokens, total_output_tokens, total_cache_read_tokens,
        total_cache_write_tokens, estimated_cost, model, models,
        git_branch, cwd, version, tools_used, compaction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFile = db.prepare(`
      INSERT OR REPLACE INTO ingested_files (file_path, mtime, file_size, ingested_at)
      VALUES (?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    const runInsertTransaction = db.transaction(() => {
      for (const { session: s, filePath, mtime, size } of parsedSessions) {
        insertSession.run(
          s.id,
          s.projectId,
          s.projectName,
          s.timestamp,
          s.duration,
          s.activeTime,
          s.messageCount,
          s.userMessageCount,
          s.assistantMessageCount,
          s.toolCallCount,
          s.totalInputTokens,
          s.totalOutputTokens,
          s.totalCacheReadTokens,
          s.totalCacheWriteTokens,
          s.estimatedCost,
          s.model,
          JSON.stringify(s.models || []),
          s.gitBranch,
          s.cwd,
          s.version,
          JSON.stringify(s.toolsUsed || {}),
          JSON.stringify(s.compaction || {}),
        );

        insertFile.run(filePath, mtime, size, now);
      }
    });

    runInsertTransaction();

    // Recompute aggregate tables in a separate transaction
    recomputeAggregates(db);

    // Update sync status
    lastSyncedAt = new Date().toISOString();
    lastSessionCount = (
      db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }
    ).count;

    console.log(
      `[ingest] Cycle complete: ${changedFiles.length} files processed, ${lastSessionCount} total sessions`,
    );
  } finally {
    isCurrentlyRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives a human-readable project name from the project directory.
 * Reads cwd from the first JSONL file to get the real path basename,
 * falling back to the directory name (project ID).
 */
function getProjectName(projectDirPath: string, projectId: string): string {
  try {
    const jsonlFiles = fs.readdirSync(projectDirPath).filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length > 0) {
      const firstFile = path.join(projectDirPath, jsonlFiles[0]);
      // Read first line to extract cwd
      const content = fs.readFileSync(firstFile, 'utf-8');
      const firstLine = content.split('\n').find(l => l.trim());
      if (firstLine) {
        const msg = JSON.parse(firstLine);
        if (msg.cwd) return path.basename(msg.cwd);
      }
    }
  } catch {
    // Fall through to default
  }
  // Decode project ID heuristic: -mnt-c-...-projectname -> last segment
  const decoded = projectId.replace(/^-/, '/').replace(/-/g, '/');
  const parts = decoded.split('/');
  return parts[parts.length - 1] || projectId;
}

/**
 * Recomputes all aggregate tables (projects, daily_activity, model_usage)
 * from the sessions table. Runs as a single atomic transaction.
 */
function recomputeAggregates(db: Database.Database): void {
  const runAggregates = db.transaction(() => {
    // Projects
    db.prepare('DELETE FROM projects').run();
    db.prepare(`
      INSERT INTO projects (id, name, path, session_count, total_messages, total_tokens, estimated_cost, last_active, models)
      SELECT
        project_id,
        MAX(project_name),
        MAX(cwd),
        COUNT(*),
        SUM(message_count),
        SUM(total_input_tokens + total_output_tokens + total_cache_read_tokens + total_cache_write_tokens),
        SUM(estimated_cost),
        MAX(timestamp),
        '[]'
      FROM sessions
      GROUP BY project_id
    `).run();

    // Daily activity
    db.prepare('DELETE FROM daily_activity').run();
    db.prepare(`
      INSERT INTO daily_activity (date, project_id, message_count, session_count, tool_call_count)
      SELECT
        substr(timestamp, 1, 10),
        project_id,
        SUM(message_count),
        COUNT(*),
        SUM(tool_call_count)
      FROM sessions
      GROUP BY substr(timestamp, 1, 10), project_id
    `).run();

    // Model usage
    db.prepare('DELETE FROM model_usage').run();
    db.prepare(`
      INSERT INTO model_usage (model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd)
      SELECT
        model,
        SUM(total_input_tokens),
        SUM(total_output_tokens),
        SUM(total_cache_read_tokens),
        SUM(total_cache_write_tokens),
        SUM(estimated_cost)
      FROM sessions
      WHERE model != '' AND model != 'unknown'
      GROUP BY model
    `).run();
  });

  runAggregates();
}
