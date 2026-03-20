/**
 * Test scaffolds for Phase 1 Detection Engine — DETECT-01 through DETECT-06
 *
 * These tests define the behavioral contract for active-sessions.ts (Plan 02).
 * All tests are in RED state: active-sessions.ts does not exist yet.
 * Tests will fail with "Cannot find module" until Plan 02 creates the module.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  inferSessionStatus,
  tailReadJsonl,
  ACTIVE_SESSION_CONFIG,
  getActiveSessions,
  detectOpenJsonlFiles,
} from '@/lib/claude-data/active-sessions';

import { SessionMessage } from '@/lib/claude-data/types';

// Mock child_process for lsof-based process detection
jest.mock('child_process', () => ({
  execSync: jest.fn(() => ''),
}));

import { execSync } from 'child_process';

jest.mock('@/lib/claude-data/reader', () => ({
  getProjectsDir: jest.fn(() => '/tmp/mock-claude-projects'),
  extractCwdFromSession: jest.fn(() => '/home/user/project'),
  projectIdToName: jest.fn((id: string) => `Project ${id}`),
  projectIdToFullPath: jest.fn((id: string) => `/home/user/${id}`),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<SessionMessage>): SessionMessage {
  return {
    type: 'assistant',
    sessionId: 'test',
    timestamp: new Date().toISOString(),
    uuid: 'uuid-1',
    parentUuid: null,
    cwd: '/tmp',
    version: '1.0',
    gitBranch: 'main',
    ...overrides,
  };
}

let tmpDir: string;

function writeTempJsonl(filename: string, lines: object[]): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return filePath;
}

// ---------------------------------------------------------------------------
// ACTIVE_SESSION_CONFIG — DETECT-01 (configuration constants)
// ---------------------------------------------------------------------------

describe('ACTIVE_SESSION_CONFIG', () => {
  test('ACTIVE_WINDOW_MS equals 30 minutes (1800000)', () => {
    expect(ACTIVE_SESSION_CONFIG.ACTIVE_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  test('IDLE_CUTOFF_MS equals 5 minutes (300000)', () => {
    expect(ACTIVE_SESSION_CONFIG.IDLE_CUTOFF_MS).toBe(5 * 60 * 1000);
  });

  test('WORKING_SIGNAL_MS equals 10 seconds (10000)', () => {
    expect(ACTIVE_SESSION_CONFIG.WORKING_SIGNAL_MS).toBe(10 * 1000);
  });

  test('TAIL_READ_BYTES equals 16KB (16384)', () => {
    expect(ACTIVE_SESSION_CONFIG.TAIL_READ_BYTES).toBe(16 * 1024);
  });
});

// ---------------------------------------------------------------------------
// inferSessionStatus — DETECT-02, DETECT-03, DETECT-04
// ---------------------------------------------------------------------------

describe('inferSessionStatus', () => {

  // DETECT-02: working status
  describe('DETECT-02: working', () => {
    test('returns "working" when file age <= WORKING_SIGNAL_MS', () => {
      const result = inferSessionStatus([], Date.now() - 5000, false);
      expect(result).toBe('working');
    });

    test('returns "working" when hasIncompleteWrite is true', () => {
      const result = inferSessionStatus([], Date.now() - 60000, true);
      expect(result).toBe('working');
    });

    test('returns "working" when last message is assistant with tool_use', () => {
      const msg = makeMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool1', name: 'Read', input: {} }],
        },
      });
      const result = inferSessionStatus([msg], Date.now() - 60000, false);
      expect(result).toBe('working');
    });

    test('returns "working" when last message is user type', () => {
      const msg = makeMessage({ type: 'user' });
      const result = inferSessionStatus([msg], Date.now() - 60000, false);
      expect(result).toBe('working');
    });

    test('returns "working" when last message is progress type', () => {
      const msg = makeMessage({ type: 'progress' });
      const result = inferSessionStatus([msg], Date.now() - 60000, false);
      expect(result).toBe('working');
    });

    test('returns "working" when last message has compactMetadata', () => {
      const msg = makeMessage({
        type: 'assistant',
        compactMetadata: { trigger: 'auto', preTokens: 100000 },
        message: {
          role: 'assistant',
          content: 'Summary of conversation',
        },
      });
      const result = inferSessionStatus([msg], Date.now() - 60000, false);
      expect(result).toBe('working');
    });
  });

  // DETECT-03: waiting status
  describe('DETECT-03: waiting', () => {
    test('returns "waiting" when last message is assistant without tool calls', () => {
      const msg = makeMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'Hello, how can I help?',
        },
      });
      const result = inferSessionStatus([msg], Date.now() - 60000, false);
      expect(result).toBe('waiting');
    });

    test('returns "waiting" when last message is assistant with empty content array', () => {
      const msg = makeMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [],
        },
      });
      const result = inferSessionStatus([msg], Date.now() - 60000, false);
      expect(result).toBe('waiting');
    });
  });

  // DETECT-04: idle status
  describe('DETECT-04: idle', () => {
    test('returns "idle" when file age > IDLE_CUTOFF_MS', () => {
      const msg = makeMessage({
        type: 'assistant',
        message: { role: 'assistant', content: 'Hello' },
      });
      const fileMtime = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const result = inferSessionStatus([msg], fileMtime, false);
      expect(result).toBe('idle');
    });

    test('returns "idle" when no relevant messages and file in middle range', () => {
      // Only system messages — no relevant messages to inspect
      const systemMsg = makeMessage({ type: 'system' });
      const fileMtime = Date.now() - 60000; // 60 seconds ago (within idle cutoff but not working signal)
      const result = inferSessionStatus([systemMsg], fileMtime, false);
      expect(result).toBe('idle');
    });
  });

  // Edge case: skip system and file-history-snapshot messages
  describe('skips irrelevant message types', () => {
    test('skips system messages to find last relevant message', () => {
      const assistantWithToolUse = makeMessage({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: {} }],
        },
      });
      const systemMessage = makeMessage({ type: 'system' });
      // system is last in array, but should be skipped; assistant with tool_use found instead
      const fileMtime = Date.now() - 60000;
      const result = inferSessionStatus([assistantWithToolUse, systemMessage], fileMtime, false);
      expect(result).toBe('working');
    });
  });
});

// ---------------------------------------------------------------------------
// tailReadJsonl — DETECT-05 (tail-read byte limit), DETECT-06 (incomplete write)
// ---------------------------------------------------------------------------

describe('tailReadJsonl', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claud-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // DETECT-05: tail-read byte limit
  describe('DETECT-05: tail-read byte limit', () => {
    test('reads only last TAIL_READ_BYTES of large file', () => {
      // Create 200 padding messages (each ~100 bytes) to exceed 16KB
      const paddingLines: object[] = [];
      for (let i = 0; i < 200; i++) {
        paddingLines.push(
          makeMessage({
            type: 'assistant',
            uuid: `padding-${i}`,
            message: { role: 'assistant', content: `padding message number ${i}` },
          })
        );
      }
      // Add a distinctive final message
      const finalMessage = makeMessage({
        type: 'user',
        uuid: 'final-message-uuid',
        message: undefined,
      });
      paddingLines.push(finalMessage);

      const filePath = writeTempJsonl('large.jsonl', paddingLines);

      const { messages } = tailReadJsonl(filePath);

      // The first padding message should NOT be present (beyond the 16KB tail window)
      const firstUuids = messages.map((m) => m.uuid);
      expect(firstUuids).not.toContain('padding-0');

      // The final message MUST be present
      expect(firstUuids).toContain('final-message-uuid');
    });

    test('reads entire small file without skipping first line', () => {
      const lines = [
        makeMessage({ type: 'user', uuid: 'msg-1' }),
        makeMessage({ type: 'assistant', uuid: 'msg-2', message: { role: 'assistant', content: 'Hello!' } }),
        makeMessage({ type: 'user', uuid: 'msg-3' }),
      ];

      const filePath = writeTempJsonl('small.jsonl', lines);

      const { messages } = tailReadJsonl(filePath);

      expect(messages.length).toBe(3);
      expect(messages[0].uuid).toBe('msg-1');
      expect(messages[1].uuid).toBe('msg-2');
      expect(messages[2].uuid).toBe('msg-3');
    });
  });

  // DETECT-06: incomplete write detection
  describe('DETECT-06: incomplete write detection', () => {
    test('sets hasIncompleteWrite true when last line is malformed JSON', () => {
      const validLines = [
        makeMessage({ type: 'user', uuid: 'msg-1' }),
        makeMessage({ type: 'assistant', uuid: 'msg-2', message: { role: 'assistant', content: 'Hi' } }),
      ];
      const filePath = path.join(tmpDir, 'truncated.jsonl');
      // Write valid lines then append a truncated JSON line
      fs.writeFileSync(
        filePath,
        validLines.map(l => JSON.stringify(l)).join('\n') + '\n' + '{"type":"assistant","ses'
      );

      const { hasIncompleteWrite } = tailReadJsonl(filePath);
      expect(hasIncompleteWrite).toBe(true);
    });

    test('sets hasIncompleteWrite false when all lines are valid', () => {
      const lines = [
        makeMessage({ type: 'user', uuid: 'msg-1' }),
        makeMessage({ type: 'assistant', uuid: 'msg-2', message: { role: 'assistant', content: 'OK' } }),
      ];
      const filePath = writeTempJsonl('valid.jsonl', lines);

      const { hasIncompleteWrite } = tailReadJsonl(filePath);
      expect(hasIncompleteWrite).toBe(false);
    });

    test('skips interior malformed lines without setting hasIncompleteWrite', () => {
      const firstLine = makeMessage({ type: 'user', uuid: 'msg-1' });
      const lastLine = makeMessage({ type: 'assistant', uuid: 'msg-3', message: { role: 'assistant', content: 'Done' } });
      const filePath = path.join(tmpDir, 'interior-bad.jsonl');
      // Write: valid line, malformed middle, valid last
      fs.writeFileSync(
        filePath,
        JSON.stringify(firstLine) + '\n' +
        '{"type":"broken JSON\n' +
        JSON.stringify(lastLine) + '\n'
      );

      const { messages, hasIncompleteWrite } = tailReadJsonl(filePath);
      expect(hasIncompleteWrite).toBe(false);
      expect(messages.length).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// getActiveSessions — orchestrator integration tests
// ---------------------------------------------------------------------------

// Import the mocked reader module to control getProjectsDir in tests
import { getProjectsDir } from '@/lib/claude-data/reader';

describe('getActiveSessions', () => {
  let orchestratorTmpDir: string;

  beforeEach(() => {
    orchestratorTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claud-orchestrator-'));
    // Point getProjectsDir mock to our temp directory
    (getProjectsDir as jest.Mock).mockReturnValue(orchestratorTmpDir);
  });

  afterEach(() => {
    fs.rmSync(orchestratorTmpDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('returns empty array when no active files exist', async () => {
    // Empty projects dir — no session files
    const result = await getActiveSessions();
    expect(result).toEqual([]);
  });

  test('returns session with correct status from recently modified file', async () => {
    // Create project dir + JSONL file
    const projectId = 'my-project';
    const projectDir = path.join(orchestratorTmpDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = 'session-abc123';
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    const userMsg = makeMessage({ type: 'user', uuid: 'u1' });
    const assistantMsg = makeMessage({
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: {} }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });

    fs.writeFileSync(filePath, [userMsg, assistantMsg].map(l => JSON.stringify(l)).join('\n') + '\n');

    // Set mtime to 5 seconds ago — should trigger 'working' status
    const recentMtime = new Date(Date.now() - 5000);
    fs.utimesSync(filePath, recentMtime, recentMtime);

    const result = await getActiveSessions();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(sessionId);
    expect(result[0].status).toBe('working');
    expect(result[0].projectId).toBe(projectId);
  });

  test('returns accurate token counts from full parse', async () => {
    const projectId = 'token-project';
    const projectDir = path.join(orchestratorTmpDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = 'session-tokens';
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    const msg1 = makeMessage({
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: 'Response 1',
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      },
    });
    const msg2 = makeMessage({
      type: 'assistant',
      uuid: 'a2',
      message: {
        role: 'assistant',
        content: 'Response 2',
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 200,
          output_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 10,
        },
      },
    });

    fs.writeFileSync(filePath, [msg1, msg2].map(l => JSON.stringify(l)).join('\n') + '\n');

    // Set mtime to 5 seconds ago to keep in active window
    const recentMtime = new Date(Date.now() - 5000);
    fs.utimesSync(filePath, recentMtime, recentMtime);

    const result = await getActiveSessions();

    expect(result).toHaveLength(1);
    expect(result[0].totalInputTokens).toBe(300);
    expect(result[0].totalOutputTokens).toBe(150);
    expect(result[0].totalCacheWriteTokens).toBe(30);
    expect(result[0].totalCacheReadTokens).toBe(15);
  });

  test('evicts cache entries for sessions no longer in active window', async () => {
    const projectId = 'evict-project';
    const projectDir = path.join(orchestratorTmpDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = 'session-evict';
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    const msg = makeMessage({
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: 'Hello', model: 'claude-sonnet-4-6' },
    });
    fs.writeFileSync(filePath, JSON.stringify(msg) + '\n');

    // Set mtime to 5 seconds ago — active
    const activeMtime = new Date(Date.now() - 5000);
    fs.utimesSync(filePath, activeMtime, activeMtime);

    // First call — populates cache
    const firstResult = await getActiveSessions();
    expect(firstResult).toHaveLength(1);

    // Delete the file to simulate session leaving the active window
    fs.unlinkSync(filePath);

    // Second call — session should be evicted
    const secondResult = await getActiveSessions();
    expect(secondResult).toEqual([]);
  });

  test('populates projectName, projectPath, cwd, gitBranch from helpers and messages', async () => {
    const projectId = 'branch-project';
    const projectDir = path.join(orchestratorTmpDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = 'session-branch';
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    const msg = makeMessage({
      type: 'assistant',
      uuid: 'a1',
      gitBranch: 'feature/test',
      message: {
        role: 'assistant',
        content: 'Hello',
        model: 'claude-sonnet-4-6',
      },
    });
    fs.writeFileSync(filePath, JSON.stringify(msg) + '\n');

    const recentMtime = new Date(Date.now() - 5000);
    fs.utimesSync(filePath, recentMtime, recentMtime);

    const result = await getActiveSessions();

    expect(result).toHaveLength(1);
    expect(result[0].projectName).toBe('project');
    expect(result[0].projectPath).toBe(`/home/user/${projectId}`);
    expect(result[0].cwd).toBe('/home/user/project');
    expect(result[0].gitBranch).toBe('feature/test');
  });

  test('sets hasRunningProcess=true when lsof reports file open', async () => {
    const projectId = 'process-project';
    const projectDir = path.join(orchestratorTmpDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = 'session-process';
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    const msg = makeMessage({
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: 'Hello', model: 'claude-sonnet-4-6' },
    });
    fs.writeFileSync(filePath, JSON.stringify(msg) + '\n');

    const recentMtime = new Date(Date.now() - 5000);
    fs.utimesSync(filePath, recentMtime, recentMtime);

    // Mock lsof returning this file as open
    (execSync as jest.Mock).mockReturnValue(
      `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF    NODE NAME\nnode    12345 user    5w   REG    8,1    16384 1234567 ${filePath}\n`
    );

    const result = await getActiveSessions();

    expect(result).toHaveLength(1);
    expect(result[0].hasRunningProcess).toBe(true);
  });

  test('sets hasRunningProcess=false when lsof does NOT report file open', async () => {
    const projectId = 'no-process-project';
    const projectDir = path.join(orchestratorTmpDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = 'session-no-process';
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    const msg = makeMessage({
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: 'Hello', model: 'claude-sonnet-4-6' },
    });
    fs.writeFileSync(filePath, JSON.stringify(msg) + '\n');

    const recentMtime = new Date(Date.now() - 5000);
    fs.utimesSync(filePath, recentMtime, recentMtime);

    // Mock lsof returning a DIFFERENT file (not this session)
    (execSync as jest.Mock).mockReturnValue(
      `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF    NODE NAME\nnode    12345 user    5w   REG    8,1    16384 1234567 /some/other/file.jsonl\n`
    );

    const result = await getActiveSessions();

    expect(result).toHaveLength(1);
    expect(result[0].hasRunningProcess).toBe(false);
  });

  test('sets hasRunningProcess=true for all sessions when lsof fails (graceful fallback)', async () => {
    const projectId = 'fallback-project';
    const projectDir = path.join(orchestratorTmpDir, projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = 'session-fallback';
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    const msg = makeMessage({
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: 'Hello', model: 'claude-sonnet-4-6' },
    });
    fs.writeFileSync(filePath, JSON.stringify(msg) + '\n');

    const recentMtime = new Date(Date.now() - 5000);
    fs.utimesSync(filePath, recentMtime, recentMtime);

    // Mock lsof throwing (command not found / unavailable)
    (execSync as jest.Mock).mockImplementation(() => { throw new Error('lsof: command not found'); });

    const result = await getActiveSessions();

    expect(result).toHaveLength(1);
    expect(result[0].hasRunningProcess).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectOpenJsonlFiles — unit tests
// ---------------------------------------------------------------------------

describe('detectOpenJsonlFiles', () => {
  test('returns Set of absolute .jsonl file paths from lsof output', () => {
    const mockOutput = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF    NODE NAME',
      'node    12345 user    5w   REG    8,1    16384 1234567 /home/user/.claude/projects/proj1/session1.jsonl',
      'node    12345 user    6w   REG    8,1     8192 1234568 /home/user/.claude/projects/proj2/session2.jsonl',
      'node    67890 user    3r   REG    8,1      512 1234569 /home/user/.claude/projects/proj1/some-other.txt',
    ].join('\n');

    (execSync as jest.Mock).mockReturnValue(mockOutput);

    const { openFiles, lsofWorked } = detectOpenJsonlFiles('/home/user/.claude/projects');

    expect(openFiles).toBeInstanceOf(Set);
    expect(openFiles.size).toBe(2);
    expect(openFiles.has('/home/user/.claude/projects/proj1/session1.jsonl')).toBe(true);
    expect(openFiles.has('/home/user/.claude/projects/proj2/session2.jsonl')).toBe(true);
    // Non-jsonl file should NOT be in the set
    expect(openFiles.has('/home/user/.claude/projects/proj1/some-other.txt')).toBe(false);
    expect(lsofWorked).toBe(true);
  });

  test('returns empty Set when lsof command fails', () => {
    (execSync as jest.Mock).mockImplementation(() => { throw new Error('lsof: command not found'); });

    const { openFiles, lsofWorked } = detectOpenJsonlFiles('/home/user/.claude/projects');

    expect(openFiles).toBeInstanceOf(Set);
    expect(openFiles.size).toBe(0);
    expect(lsofWorked).toBe(false);
  });

  test('returns empty Set when lsof returns no matching files', () => {
    const mockOutput = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF    NODE NAME',
      'node    12345 user    3r   REG    8,1      512 1234569 /home/user/.claude/projects/proj1/config.json',
    ].join('\n');

    (execSync as jest.Mock).mockReturnValue(mockOutput);

    const { openFiles, lsofWorked } = detectOpenJsonlFiles('/home/user/.claude/projects');

    expect(openFiles).toBeInstanceOf(Set);
    expect(openFiles.size).toBe(0);
    expect(lsofWorked).toBe(true);
  });
});
