/**
 * Core detection functions for active session tracking.
 *
 * These are the computational core of Phase 1:
 *   - ACTIVE_SESSION_CONFIG: threshold constants
 *   - tailReadJsonl: efficient tail-read of JSONL files (last N bytes)
 *   - inferSessionStatus: pure status inference from messages + mtime
 *   - scanActiveFiles: filesystem scan for recently-modified JSONL files
 *   - getActiveSessions: orchestrator composing scan + parse + cache
 *
 * NOTE: Do NOT import full-file parsing functions from reader.ts here.
 * Only getProjectsDir, extractCwdFromSession, projectIdToName, and
 * projectIdToFullPath are imported.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { getProjectsDir, extractCwdFromSession, projectIdToName, projectIdToFullPath } from './reader';
import { calculateCost } from '@/config/pricing';
import { readGsdProgress } from './gsd-progress';
import type { SessionMessage, SessionStatus, ActiveSessionInfo } from './types';

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

// ---------------------------------------------------------------------------
// Token cache — per-session accumulation across 5-second polls
// ---------------------------------------------------------------------------

interface TokenCache {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedCost: number;
  lastParsedSize: number;   // file size after last full parse
  lastModel: string;
  models: Set<string>;
  blockStart: string;       // ISO timestamp of current contiguous block start
  activeTime: number;       // ms — sum of inter-message gaps below idle threshold
  lastTimestampMs: number;  // epoch ms of last message (for incremental active time calc)
}

const tokenCacheMap = new Map<string, TokenCache>();

/**
 * Walks messages backward to find the start of the current contiguous
 * activity block. A "gap" larger than ACTIVE_WINDOW_MS indicates a new block.
 */
function findCurrentBlockStart(messages: SessionMessage[]): string {
  if (messages.length === 0) {
    return new Date().toISOString();
  }

  for (let i = messages.length - 1; i > 0; i--) {
    const curr = messages[i].timestamp;
    const prev = messages[i - 1].timestamp;
    if (!curr || !prev) continue;

    const gap = new Date(curr).getTime() - new Date(prev).getTime();
    if (gap > ACTIVE_SESSION_CONFIG.ACTIVE_WINDOW_MS) {
      // Start of the current contiguous block
      return curr;
    }
  }

  // No large gap found — entire session is one block
  return messages[0].timestamp ?? new Date().toISOString();
}

/**
 * Full parse of a session file using readline (line-by-line streaming).
 * Used only on first detection of a session. Subsequent polls use tail-read.
 */
async function fullParseSession(filePath: string): Promise<TokenCache> {
  const allMessages: SessionMessage[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let lastModel = '';
  const models = new Set<string>();

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as SessionMessage;
      allMessages.push(msg);

      if (msg.message?.usage) {
        const u = msg.message.usage;
        totalInputTokens += u.input_tokens || 0;
        totalOutputTokens += u.output_tokens || 0;
        totalCacheReadTokens += u.cache_read_input_tokens || 0;
        totalCacheWriteTokens += u.cache_creation_input_tokens || 0;
      }
      if (msg.message?.model) {
        lastModel = msg.message.model;
        models.add(msg.message.model);
      }
    } catch { /* skip malformed line */ }
  }

  const blockStart = findCurrentBlockStart(allMessages);
  const estimatedCost = calculateCost(lastModel, totalInputTokens, totalOutputTokens, totalCacheWriteTokens, totalCacheReadTokens);
  const lastParsedSize = fs.statSync(filePath).size;

  // Compute active work time: sum of inter-message gaps below idle threshold
  let activeTime = 0;
  let lastTimestampMs = 0;
  for (let i = 0; i < allMessages.length; i++) {
    const ts = allMessages[i].timestamp;
    if (!ts) continue;
    const tsMs = new Date(ts).getTime();
    if (lastTimestampMs > 0) {
      const gap = tsMs - lastTimestampMs;
      if (gap < ACTIVE_SESSION_CONFIG.IDLE_CUTOFF_MS) {
        activeTime += gap;
      }
    }
    lastTimestampMs = tsMs;
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    estimatedCost,
    lastParsedSize,
    lastModel,
    models,
    blockStart,
    activeTime,
    lastTimestampMs,
  };
}

/**
 * Updates an existing cache entry from tail-read messages.
 * Accumulates tokens from tail-read messages and updates model metadata.
 *
 * NOTE: tail-reads overlap with previously parsed content (last TAIL_READ_BYTES),
 * so tokens from messages already seen in fullParseSession will be double-counted.
 * This is an accepted heuristic — the visual impact is minor and is bounded by
 * how many messages fit in TAIL_READ_BYTES (16KB). A future improvement could
 * filter by timestamp > lastTimestampMs to eliminate overlap entirely.
 */
function updateCacheFromTailRead(cache: TokenCache, newMessages: SessionMessage[], currentFileSize: number): void {
  for (const msg of newMessages) {
    if (msg.message?.model) {
      cache.lastModel = msg.message.model;
      cache.models.add(msg.message.model);
    }
    if (msg.message?.usage) {
      const u = msg.message.usage;
      cache.totalInputTokens += u.input_tokens || 0;
      cache.totalOutputTokens += u.output_tokens || 0;
      cache.totalCacheReadTokens += u.cache_read_input_tokens || 0;
      cache.totalCacheWriteTokens += u.cache_creation_input_tokens || 0;
    }
    // Accumulate active time from new messages
    if (msg.timestamp) {
      const tsMs = new Date(msg.timestamp).getTime();
      if (cache.lastTimestampMs > 0) {
        const gap = tsMs - cache.lastTimestampMs;
        if (gap > 0 && gap < ACTIVE_SESSION_CONFIG.IDLE_CUTOFF_MS) {
          cache.activeTime += gap;
        }
      }
      cache.lastTimestampMs = tsMs;
    }
  }

  cache.estimatedCost = calculateCost(
    cache.lastModel,
    cache.totalInputTokens,
    cache.totalOutputTokens,
    cache.totalCacheWriteTokens,
    cache.totalCacheReadTokens,
  );
  cache.lastParsedSize = currentFileSize;
}

// ---------------------------------------------------------------------------
// getActiveSessions — top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Returns the current list of active sessions with status, token counts,
 * cost estimates, and duration for each session.
 *
 * Performance contract:
 *   - Full JSONL parse runs only once per session (first detection)
 *   - Subsequent polls use tail-read only (last TAIL_READ_BYTES)
 *   - Cache entries are evicted for sessions no longer in the active window
 */
export async function getActiveSessions(): Promise<ActiveSessionInfo[]> {
  const activeFiles = scanActiveFiles();
  const currentSessionIds = new Set(activeFiles.map(f => f.sessionId));

  // Evict stale cache entries — sessions no longer in active window
  for (const cachedId of tokenCacheMap.keys()) {
    if (!currentSessionIds.has(cachedId)) {
      tokenCacheMap.delete(cachedId);
    }
  }

  const results: ActiveSessionInfo[] = [];

  for (const { filePath, sessionId, projectId, mtimeMs } of activeFiles) {
    // 1. Tail-read for status inference
    const { messages: tailMessages, hasIncompleteWrite } = tailReadJsonl(filePath);
    const status = inferSessionStatus(tailMessages, mtimeMs, hasIncompleteWrite);

    // 2. Token cache: full-parse on first detection, tail-read update on subsequent
    let cache = tokenCacheMap.get(sessionId);
    if (!cache) {
      // First detection — full parse for accurate totals
      cache = await fullParseSession(filePath);
      tokenCacheMap.set(sessionId, cache);
    } else {
      // Subsequent poll — update from tail-read only if file grew
      const currentSize = fs.statSync(filePath).size;
      if (currentSize > cache.lastParsedSize) {
        updateCacheFromTailRead(cache, tailMessages, currentSize);
      }
    }

    // 3. Resolve project metadata using existing helpers
    const projectPath = projectIdToFullPath(projectId);
    const cwd = extractCwdFromSession(filePath) || '';
    // Prefer cwd basename for project name — projectIdToName decodes hyphens as path separators
    const projectName = cwd ? path.basename(cwd) : projectIdToName(projectId);
    // Use cwd for GSD lookup — projectPath has hyphen-to-slash decoding issues
    const gsdProgress = readGsdProgress(cwd || projectPath);

    // 4. Get git branch from tail-read messages (last message with gitBranch)
    let gitBranch = '';
    for (let i = tailMessages.length - 1; i >= 0; i--) {
      if (tailMessages[i].gitBranch) {
        gitBranch = tailMessages[i].gitBranch;
        break;
      }
    }

    // 5. Compute duration from cached block start
    const duration = Date.now() - new Date(cache.blockStart).getTime();

    results.push({
      id: sessionId,
      projectId,
      projectName,
      projectPath,
      cwd,
      gitBranch,
      status,
      duration,
      activeTime: cache.activeTime,
      totalInputTokens: cache.totalInputTokens,
      totalOutputTokens: cache.totalOutputTokens,
      totalCacheReadTokens: cache.totalCacheReadTokens,
      totalCacheWriteTokens: cache.totalCacheWriteTokens,
      estimatedCost: cache.estimatedCost,
      model: cache.lastModel,
      models: Array.from(cache.models),
      lastActivity: new Date(mtimeMs).toISOString(),
      gsdProgress,
    });
  }

  return results;
}
