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
} from '@/lib/claude-data/active-sessions';

import { SessionMessage } from '@/lib/claude-data/types';

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
