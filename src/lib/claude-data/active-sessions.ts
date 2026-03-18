/**
 * Core detection functions for active session tracking.
 *
 * These are the computational core of Phase 1:
 *   - ACTIVE_SESSION_CONFIG: threshold constants
 *   - tailReadJsonl: efficient tail-read of JSONL files (last N bytes)
 *   - inferSessionStatus: pure status inference from messages + mtime
 *   - scanActiveFiles: filesystem scan for recently-modified JSONL files
 *
 * NOTE: Do NOT import full-file parsing functions from reader.ts here.
 * Only getProjectsDir is imported (directory path, no I/O).
 */

import * as fs from 'fs';
import * as path from 'path';

import { getProjectsDir } from './reader';
import type { SessionMessage, SessionStatus } from './types';

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

export const ACTIVE_SESSION_CONFIG = {
  ACTIVE_WINDOW_MS:   30 * 60 * 1000,  // 30 minutes — cutoff for "active" file scan
  IDLE_CUTOFF_MS:      5 * 60 * 1000,  //  5 minutes — above this → idle regardless of messages
  WORKING_SIGNAL_MS:       10 * 1000,  // 10 seconds — below this → always working (very recent write)
  TAIL_READ_BYTES:         16 * 1024,  // 16 KB — max bytes to read from file tail
  CACHE_TTL_MS:             4 * 1000,  //  4 seconds — cache TTL (under 5s poll cadence)
} as const;

// ---------------------------------------------------------------------------
// tailReadJsonl
// ---------------------------------------------------------------------------

export interface TailReadResult {
  messages: SessionMessage[];
  hasIncompleteWrite: boolean;
}

/**
 * Reads the last `maxBytes` bytes of a JSONL file using a byte-offset seek.
 * Returns parsed messages and an incomplete-write flag.
 *
 * - If file > maxBytes, skips the first (potentially partial) line.
 * - Sets hasIncompleteWrite=true only when the LAST non-empty line fails JSON.parse.
 * - Interior malformed lines are silently skipped.
 */
export function tailReadJsonl(filePath: string, maxBytes = ACTIVE_SESSION_CONFIG.TAIL_READ_BYTES): TailReadResult {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(stat.size, maxBytes);

  const buffer = Buffer.alloc(readSize);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
  } finally {
    fs.closeSync(fd);
  }

  const rawLines = buffer.toString('utf8').split('\n');

  // If we started reading from mid-file, skip the first line (partial from byte cut)
  const startIdx = stat.size > maxBytes ? 1 : 0;
  const candidates = rawLines.slice(startIdx).filter(line => line.trim().length > 0);

  const messages: SessionMessage[] = [];
  let hasIncompleteWrite = false;

  for (let i = 0; i < candidates.length; i++) {
    const line = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
      const msg = JSON.parse(line) as SessionMessage;
      messages.push(msg);
    } catch {
      if (isLast) {
        // Only the last non-empty line failing counts as an incomplete write
        hasIncompleteWrite = true;
      }
      // Interior malformed lines are silently skipped
    }
  }

  return { messages, hasIncompleteWrite };
}

// ---------------------------------------------------------------------------
// inferSessionStatus
// ---------------------------------------------------------------------------

/**
 * Pure function — no I/O. Infers session status from messages, file mtime,
 * and incomplete-write flag.
 *
 * Decision tree (evaluated in order):
 *   1. age > IDLE_CUTOFF_MS  → 'idle'
 *   2. age <= WORKING_SIGNAL_MS → 'working'  (very fresh write)
 *   3. hasIncompleteWrite    → 'working'     (active write in progress)
 *   4. Walk messages backward, skip system/file-history-snapshot
 *   5. No relevant message   → 'idle'
 *   6. compactMetadata or microcompactMetadata → 'working'
 *   7. type === 'progress'   → 'working'
 *   8. type === 'user'       → 'working'
 *   9. type === 'assistant' with tool_use content → 'working'
 *  10. type === 'assistant' without tool_use     → 'waiting'
 *  11. default fallback      → 'idle'
 */
export function inferSessionStatus(
  messages: SessionMessage[],
  fileMtimeMs: number,
  hasIncompleteWrite: boolean,
): SessionStatus {
  const ageMs = Date.now() - fileMtimeMs;

  if (ageMs > ACTIVE_SESSION_CONFIG.IDLE_CUTOFF_MS) {
    return 'idle';
  }

  if (ageMs <= ACTIVE_SESSION_CONFIG.WORKING_SIGNAL_MS) {
    return 'working';
  }

  if (hasIncompleteWrite) {
    return 'working';
  }

  // Find the last "relevant" message (skip system and file-history-snapshot)
  let lastRelevant: SessionMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'system' || msg.type === 'file-history-snapshot') {
      continue;
    }
    lastRelevant = msg;
    break;
  }

  if (!lastRelevant) {
    return 'idle';
  }

  // Compaction signals — Claude is reorganising context (active work)
  if (lastRelevant.compactMetadata || lastRelevant.microcompactMetadata) {
    return 'working';
  }

  if (lastRelevant.type === 'progress') {
    return 'working';
  }

  if (lastRelevant.type === 'user') {
    return 'working';
  }

  if (lastRelevant.type === 'assistant') {
    const content = lastRelevant.message?.content;
    if (
      Array.isArray(content) &&
      content.some(
        (c): boolean =>
          c !== null &&
          typeof c === 'object' &&
          'type' in c &&
          (c as { type: unknown }).type === 'tool_use',
      )
    ) {
      return 'working';
    }
    return 'waiting';
  }

  return 'idle';
}

// ---------------------------------------------------------------------------
// scanActiveFiles
// ---------------------------------------------------------------------------

export interface ActiveFileEntry {
  filePath: string;
  sessionId: string;
  projectId: string;
  mtimeMs: number;
}

/**
 * Scans the Claude projects directory for JSONL files modified within
 * ACTIVE_WINDOW_MS. Returns an array of file entries — one per file.
 *
 * Does NOT parse file contents (that is Plan 03's job).
 */
export function scanActiveFiles(): ActiveFileEntry[] {
  const projectsDir = getProjectsDir();

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const now = Date.now();
  const cutoff = now - ACTIVE_SESSION_CONFIG.ACTIVE_WINDOW_MS;
  const results: ActiveFileEntry[] = [];

  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(projectsDir);
  } catch {
    return [];
  }

  for (const projectId of projectDirs) {
    const projectPath = path.join(projectsDir, projectId);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = fs.readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const filePath = path.join(projectPath, file);
      let fileStat: fs.Stats;
      try {
        fileStat = fs.statSync(filePath);
      } catch {
        continue;
      }

      if (fileStat.mtimeMs > cutoff) {
        results.push({
          filePath,
          sessionId: file.replace(/\.jsonl$/, ''),
          projectId,
          mtimeMs: fileStat.mtimeMs,
        });
      }
    }
  }

  return results;
}
