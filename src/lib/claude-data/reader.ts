import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { calculateCost, getModelDisplayName } from '@/config/pricing';
import { getActiveDataSource, getImportDir } from './data-source';
import type {
  HistoryEntry,
  ProjectInfo,
  SessionInfo,
  SessionDetail,
  SessionMessageDisplay,
  DashboardStats,
  DailyActivity,
  DailyModelTokens,
  TokenUsage,
  SessionMessage,
} from './types';

function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

async function forEachJsonlLine(filePath: string, callback: (msg: SessionMessage) => void): Promise<void> {
  if (isSymlink(filePath)) return; // Skip symlinks to prevent reading arbitrary files
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as SessionMessage;
      callback(msg);
    } catch { /* skip malformed line */ }
  }
}

function getClaudeDir(): string {
  if (getActiveDataSource() === 'imported') {
    return path.join(getImportDir(), 'claude-data');
  }
  return path.join(os.homedir(), '.claude');
}

export function getProjectsDir(): string {
  return path.join(getClaudeDir(), 'projects');
}


export function getHistory(): HistoryEntry[] {
  const historyPath = path.join(getClaudeDir(), 'history.jsonl');
  if (!fs.existsSync(historyPath)) return [];
  const lines = fs.readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
  return lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean) as HistoryEntry[];
}

export function projectIdToName(id: string): string {
  // Project IDs encode paths as hyphen-separated segments (e.g., -mnt-c-Git-my-project)
  // This is lossy — hyphens in folder names (Claud-ometer) become indistinguishable from separators.
  // Return the raw ID as fallback; callers should prefer cwd-based names when available.
  return id;
}

export function projectIdToFullPath(id: string): string {
  // Lossy: hyphens in folder names become path separators. Best-effort only.
  return id.replace(/^-/, '/').replace(/-/g, '/');
}

/**
 * Scans JSONL files in a project directory to find the actual cwd.
 * Tries multiple files since the first may lack a cwd field.
 */
export function findProjectCwd(projectPath: string): string | null {
  try {
    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const cwd = extractCwdFromSession(path.join(projectPath, file));
      if (cwd) return cwd;
    }
  } catch { /* skip */ }
  return null;
}

export function extractCwdFromSession(filePath: string): string | null {
  try {
    if (isSymlink(filePath)) return null;
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8192); // Read first 8KB, enough for first few lines
    const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
    fs.closeSync(fd);
    const text = buffer.toString('utf-8', 0, bytesRead);
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.cwd) return msg.cwd;
      } catch { /* skip partial line */ }
    }
  } catch { /* skip */ }
  return null;
}

function getProjectNameFromDir(projectPath: string, projectId: string): { name: string; fullPath: string } {
  const cwd = findProjectCwd(projectPath);
  if (cwd) return { name: path.basename(cwd), fullPath: cwd };
  return { name: projectIdToName(projectId), fullPath: projectIdToFullPath(projectId) };
}

export async function getProjects(): Promise<ProjectInfo[]> {
  if (!fs.existsSync(getProjectsDir())) return [];
  const entries = fs.readdirSync(getProjectsDir());
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) continue;

    let totalMessages = 0;
    let totalTokens = 0;
    let estimatedCost = 0;
    let lastActive = '';
    const modelsSet = new Set<string>();

    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file);
      const stat = fs.statSync(filePath);
      const mtime = stat.mtime.toISOString();
      if (!lastActive || mtime > lastActive) lastActive = mtime;

      await forEachJsonlLine(filePath, (msg) => {
        if (msg.type === 'user') totalMessages++;
        if (msg.type === 'assistant') {
          totalMessages++;
          const model = msg.message?.model || '';
          if (model) modelsSet.add(model);
          const usage = msg.message?.usage;
          if (usage) {
            const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0) +
              (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
            totalTokens += tokens;
            estimatedCost += calculateCost(
              model,
              usage.input_tokens || 0,
              usage.output_tokens || 0,
              usage.cache_creation_input_tokens || 0,
              usage.cache_read_input_tokens || 0
            );
          }
        }
      });
    }

    const firstSessionPath = path.join(projectPath, jsonlFiles[0]);
    const cwd = extractCwdFromSession(firstSessionPath);

    projects.push({
      id: entry,
      name: cwd ? path.basename(cwd) : projectIdToName(entry),
      path: cwd || projectIdToFullPath(entry),
      sessionCount: jsonlFiles.length,
      totalMessages,
      totalTokens,
      estimatedCost,
      lastActive,
      models: Array.from(modelsSet).map(getModelDisplayName),
    });
  }

  return projects.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

export async function getProjectSessions(projectId: string): Promise<SessionInfo[]> {
  const projectPath = path.join(getProjectsDir(), projectId);
  if (!fs.existsSync(projectPath)) return [];

  const { name: projectName } = getProjectNameFromDir(projectPath, projectId);
  const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
  const sessions: SessionInfo[] = [];
  for (const file of jsonlFiles) {
    sessions.push(await parseSessionFile(path.join(projectPath, file), projectId, projectName));
  }
  return sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function getSessions(limit = 50, offset = 0): Promise<SessionInfo[]> {
  const allSessions: SessionInfo[] = [];

  if (!fs.existsSync(getProjectsDir())) return [];
  const projectEntries = fs.readdirSync(getProjectsDir());

  for (const entry of projectEntries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const { name: projectName } = getProjectNameFromDir(projectPath, entry);
    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      allSessions.push(await parseSessionFile(path.join(projectPath, file), entry, projectName));
    }
  }

  allSessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return allSessions.slice(offset, offset + limit);
}

export async function parseSessionFile(filePath: string, projectId: string, projectName: string): Promise<SessionInfo> {
  const sessionId = path.basename(filePath, '.jsonl');

  let firstTimestamp = '';
  let lastTimestamp = '';
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let estimatedCost = 0;
  let gitBranch = '';
  let cwd = '';
  let version = '';
  const modelsSet = new Set<string>();
  const toolsUsed: Record<string, number> = {};

  // Active work time tracking (5-minute idle threshold)
  const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
  const messageTimestamps: number[] = [];

  // Compaction tracking
  let compactions = 0;
  let microcompactions = 0;
  let totalTokensSaved = 0;
  const compactionTimestamps: string[] = [];

  await forEachJsonlLine(filePath, (msg) => {
    if (msg.timestamp) {
      if (!firstTimestamp) firstTimestamp = msg.timestamp;
      lastTimestamp = msg.timestamp;
      messageTimestamps.push(new Date(msg.timestamp).getTime());
    }
    if (msg.gitBranch && !gitBranch) gitBranch = msg.gitBranch;
    if (msg.cwd && !cwd) cwd = msg.cwd;
    if (msg.version && !version) version = msg.version;

    // Track compaction events
    if (msg.compactMetadata) {
      compactions++;
      if (msg.timestamp) compactionTimestamps.push(msg.timestamp);
    }
    if (msg.microcompactMetadata) {
      microcompactions++;
      totalTokensSaved += msg.microcompactMetadata.tokensSaved || 0;
      if (msg.timestamp) compactionTimestamps.push(msg.timestamp);
    }

    if (msg.type === 'user') {
      if (msg.message?.role === 'user' && typeof msg.message.content === 'string') {
        userMessageCount++;
      } else if (msg.message?.role === 'user') {
        userMessageCount++;
      }
    }
    if (msg.type === 'assistant') {
      assistantMessageCount++;
      const model = msg.message?.model || '';
      if (model) modelsSet.add(model);
      const usage = msg.message?.usage;
      if (usage) {
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
        totalCacheReadTokens += usage.cache_read_input_tokens || 0;
        totalCacheWriteTokens += usage.cache_creation_input_tokens || 0;
        estimatedCost += calculateCost(
          model,
          usage.input_tokens || 0,
          usage.output_tokens || 0,
          usage.cache_creation_input_tokens || 0,
          usage.cache_read_input_tokens || 0
        );
      }
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c && typeof c === 'object' && 'type' in c && c.type === 'tool_use') {
            toolCallCount++;
            const name = ('name' in c ? c.name : 'unknown') as string;
            toolsUsed[name] = (toolsUsed[name] || 0) + 1;
          }
        }
      }
    }
  });

  const duration = firstTimestamp && lastTimestamp
    ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
    : 0;

  // Active time: sum of inter-message gaps that are below the idle threshold
  let activeTime = 0;
  for (let i = 1; i < messageTimestamps.length; i++) {
    const gap = messageTimestamps[i] - messageTimestamps[i - 1];
    if (gap < IDLE_THRESHOLD_MS) {
      activeTime += gap;
    }
  }

  const models = Array.from(modelsSet);

  return {
    id: sessionId,
    projectId,
    projectName,
    timestamp: firstTimestamp || new Date().toISOString(),
    duration,
    activeTime,
    messageCount: userMessageCount + assistantMessageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    estimatedCost,
    model: models[0] || 'unknown',
    models: models.map(getModelDisplayName),
    gitBranch,
    cwd,
    version,
    toolsUsed,
    compaction: {
      compactions,
      microcompactions,
      totalTokensSaved,
      compactionTimestamps,
    },
  };
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  if (!fs.existsSync(getProjectsDir())) return null;
  const projectEntries = fs.readdirSync(getProjectsDir());

  for (const entry of projectEntries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const filePath = path.join(projectPath, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) continue;

    const { name: projectName } = getProjectNameFromDir(projectPath, entry);
    const sessionInfo = await parseSessionFile(filePath, entry, projectName);
    const messages: SessionMessageDisplay[] = [];

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as SessionMessage;
        if (msg.type === 'user' && msg.message?.role === 'user') {
          const content = msg.message.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .map((c: Record<string, unknown>) => {
                if (c.type === 'text') return c.text as string;
                if (c.type === 'tool_result') return '[Tool Result]';
                return '';
              })
              .filter(Boolean)
              .join('\n');
          }
          if (text && !text.startsWith('[Tool Result]')) {
            messages.push({
              role: 'user',
              content: text,
              timestamp: msg.timestamp,
            });
          }
        }
        if (msg.type === 'assistant' && msg.message?.content) {
          const content = msg.message.content;
          const toolCalls: { name: string; id: string }[] = [];
          let text = '';
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === 'object') {
                if ('type' in c && c.type === 'text' && 'text' in c) {
                  text += (c.text as string) + '\n';
                }
                if ('type' in c && c.type === 'tool_use' && 'name' in c) {
                  toolCalls.push({ name: c.name as string, id: (c.id as string) || '' });
                }
              }
            }
          }
          if (text.trim() || toolCalls.length > 0) {
            messages.push({
              role: 'assistant',
              content: text.trim() || `[Used ${toolCalls.length} tool(s): ${toolCalls.map(t => t.name).join(', ')}]`,
              timestamp: msg.timestamp,
              model: msg.message.model,
              usage: msg.message.usage as TokenUsage | undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      } catch { /* skip */ }
    }

    return { ...sessionInfo, messages };
  }

  return null;
}

export async function searchSessions(query: string, limit = 50): Promise<SessionInfo[]> {
  if (!query.trim()) return getSessions(limit, 0);

  const lowerQuery = query.toLowerCase();
  const matchingSessions: SessionInfo[] = [];

  if (!fs.existsSync(getProjectsDir())) return [];
  const projectEntries = fs.readdirSync(getProjectsDir());

  for (const entry of projectEntries) {
    const projectPath = path.join(getProjectsDir(), entry);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));
    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file);

      let hasMatch = false;
      await forEachJsonlLine(filePath, (msg) => {
        if (hasMatch) return;
        if (msg.type === 'user' && msg.message?.role === 'user') {
          const content = msg.message.content;
          if (typeof content === 'string' && content.toLowerCase().includes(lowerQuery)) {
            hasMatch = true;
            return;
          }
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === 'object' && 'type' in c && c.type === 'text' && 'text' in c) {
                if ((c.text as string).toLowerCase().includes(lowerQuery)) {
                  hasMatch = true;
                  return;
                }
              }
            }
          }
        }
        if (msg.type === 'assistant' && msg.message?.content) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c && typeof c === 'object' && 'type' in c && c.type === 'text' && 'text' in c) {
                if ((c.text as string).toLowerCase().includes(lowerQuery)) {
                  hasMatch = true;
                  return;
                }
              }
            }
          }
        }
      });

      if (hasMatch) {
        const { name: projectName } = getProjectNameFromDir(projectPath, entry);
        matchingSessions.push(await parseSessionFile(filePath, entry, projectName));
      }
    }
  }

  matchingSessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return matchingSessions.slice(0, limit);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  // Imported mode: scan all JSONL files directly (no stats-cache dependency).
  // Performance is acceptable for imported datasets (typically smaller).
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    return {
      totalSessions: 0,
      totalMessages: 0,
      totalTokens: 0,
      estimatedCost: 0,
      dailyActivity: [],
      dailyModelTokens: [],
      modelUsage: {},
      hourCounts: {},
      firstSessionDate: '',
      longestSession: { sessionId: '', duration: 0, messageCount: 0, timestamp: '' },
      projectCount: 0,
      recentSessions: [],
    };
  }

  const projectEntries = fs.readdirSync(projectsDir);

  const dailyMap = new Map<string, DailyActivity>();
  const dailyModelMap = new Map<string, Record<string, number>>();
  const modelUsageMap: Record<string, DashboardStats['modelUsage'][string]> = {};
  const hourCounts: Record<string, number> = {};

  let totalMessages = 0;
  let totalTokens = 0;
  let estimatedCost = 0;
  let firstSessionDate = '';
  let longestSession = { sessionId: '', duration: 0, messageCount: 0, timestamp: '' };
  let totalSessions = 0;

  for (const entry of projectEntries) {
    const projectPath = path.join(projectsDir, entry);
    try {
      if (!fs.statSync(projectPath).isDirectory()) continue;
    } catch { continue; }

    const jsonlFiles = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file);
      const sessionId = path.basename(file, '.jsonl');
      totalSessions++;

      let firstTimestamp = '';
      let lastTimestamp = '';
      let sessionMessages = 0;
      let sessionTokens = 0;

      await forEachJsonlLine(filePath, (msg) => {
        if (!msg.timestamp) return;

        if (!firstTimestamp) {
          firstTimestamp = msg.timestamp;
          if (!firstSessionDate || msg.timestamp < firstSessionDate) {
            firstSessionDate = msg.timestamp.slice(0, 10);
          }
        }
        lastTimestamp = msg.timestamp;

        const msgDate = msg.timestamp.slice(0, 10);
        const hour = msg.timestamp.slice(11, 13);

        if (msg.type === 'user' || msg.type === 'assistant') {
          totalMessages++;
          sessionMessages++;

          let day = dailyMap.get(msgDate);
          if (!day) {
            day = { date: msgDate, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
            dailyMap.set(msgDate, day);
          }
          day.messageCount++;
        }

        if (msg.type === 'assistant') {
          const model = msg.message?.model || '';
          const usage = msg.message?.usage;

          if (usage) {
            const input = usage.input_tokens || 0;
            const output = usage.output_tokens || 0;
            const cacheRead = usage.cache_read_input_tokens || 0;
            const cacheWrite = usage.cache_creation_input_tokens || 0;
            const tokens = input + output + cacheRead + cacheWrite;
            totalTokens += tokens;
            sessionTokens += tokens;

            const cost = calculateCost(model, input, output, cacheWrite, cacheRead);
            estimatedCost += cost;

            if (model) {
              if (!modelUsageMap[model]) {
                modelUsageMap[model] = {
                  inputTokens: 0,
                  outputTokens: 0,
                  cacheReadInputTokens: 0,
                  cacheCreationInputTokens: 0,
                  costUSD: 0,
                  contextWindow: 0,
                  maxOutputTokens: 0,
                  webSearchRequests: 0,
                  estimatedCost: 0,
                };
              }
              modelUsageMap[model].inputTokens += input;
              modelUsageMap[model].outputTokens += output;
              modelUsageMap[model].cacheReadInputTokens += cacheRead;
              modelUsageMap[model].cacheCreationInputTokens += cacheWrite;
              modelUsageMap[model].estimatedCost += cost;

              let dayModel = dailyModelMap.get(msgDate);
              if (!dayModel) {
                dayModel = {};
                dailyModelMap.set(msgDate, dayModel);
              }
              dayModel[model] = (dayModel[model] || 0) + tokens;

              hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            }
          }

          // Tool calls
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            let toolCallCount = 0;
            for (const c of content) {
              if (c && typeof c === 'object' && 'type' in c && c.type === 'tool_use') {
                toolCallCount++;
              }
            }
            if (toolCallCount > 0) {
              const day = dailyMap.get(msgDate);
              if (day) day.toolCallCount += toolCallCount;
            }
          }
        }
      });

      // Count session in dailyActivity for the day of its first message
      if (firstTimestamp) {
        const sessionDate = firstTimestamp.slice(0, 10);
        let day = dailyMap.get(sessionDate);
        if (!day) {
          day = { date: sessionDate, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
          dailyMap.set(sessionDate, day);
        }
        day.sessionCount++;

        // Track longest session
        const duration = lastTimestamp
          ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
          : 0;
        if (duration > longestSession.duration) {
          longestSession = {
            sessionId,
            duration,
            messageCount: sessionMessages,
            timestamp: firstTimestamp,
          };
        }
      }
    }
  }

  const projects = await getProjects();
  const recentSessions = await getSessions(10);

  const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const dailyModelTokens: DailyModelTokens[] = Array.from(dailyModelMap.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    estimatedCost,
    dailyActivity,
    dailyModelTokens,
    modelUsage: modelUsageMap,
    hourCounts,
    firstSessionDate,
    longestSession,
    projectCount: projects.length,
    recentSessions,
  };
}
