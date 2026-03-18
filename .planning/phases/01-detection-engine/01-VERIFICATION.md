---
phase: 01-detection-engine
verified: 2026-03-18T16:00:00Z
status: gaps_found
score: 8/9 must-haves verified
re_verification: false
gaps:
  - truth: "Given JSONL files in ~/.claude/, the system returns only sessions with files modified within the last 10 minutes"
    status: failed
    reason: "ACTIVE_WINDOW_MS is implemented as 30 minutes (1,800,000 ms), not 10 minutes. DETECT-01 in REQUIREMENTS.md and ROADMAP success criterion 1 both specify 10 minutes. RESEARCH.md user constraints locked the value at 30 minutes, creating a contradiction between the spec and the approved design. The test itself asserts 30 minutes as the expected value."
    artifacts:
      - path: "src/lib/claude-data/active-sessions.ts"
        issue: "ACTIVE_WINDOW_MS = 30 * 60 * 1000 (1800000) — should be 10 * 60 * 1000 (600000) per DETECT-01 and ROADMAP success criterion 1"
      - path: "src/__tests__/lib/active-sessions.test.ts"
        issue: "Test asserts ACTIVE_WINDOW_MS is 1800000 (30 min), locking in the wrong value"
    missing:
      - "Decision needed: either update REQUIREMENTS.md / ROADMAP success criterion 1 to say 30 minutes, or change ACTIVE_WINDOW_MS to 10 minutes and update test. The RESEARCH.md user constraint must also be reconciled."
---

# Phase 1: Detection Engine Verification Report

**Phase Goal:** The system can accurately detect which Claude Code sessions are currently active and infer their status from filesystem data alone
**Verified:** 2026-03-18T16:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Given JSONL files in ~/.claude/, the system returns only sessions with files modified within the last 10 minutes | FAILED | ACTIVE_WINDOW_MS = 30 min (1,800,000 ms) in active-sessions.ts:29; test at line 61 asserts 1800000; DETECT-01 and ROADMAP say 10 minutes |
| 2 | A session whose last JSONL message is an assistant turn with tool calls is classified as "working" | VERIFIED | inferSessionStatus lines 160-173; test "returns working when last message is assistant with tool_use" passes GREEN |
| 3 | A session whose last JSONL message is an assistant turn without tool calls is classified as "waiting" | VERIFIED | inferSessionStatus lines 173-174; test "returns waiting when last message is assistant without tool calls" passes GREEN |
| 4 | A session with no file modification in the last 5 minutes is classified as "idle" | VERIFIED | inferSessionStatus lines 120-122 (IDLE_CUTOFF_MS = 5 min); test "returns idle when file age > IDLE_CUTOFF_MS" passes GREEN |
| 5 | A session with an incomplete (mid-write) final JSONL line is classified as "working" rather than erroring | VERIFIED | tailReadJsonl lines 74-87; inferSessionStatus line 128-130; test "sets hasIncompleteWrite true when last line is malformed JSON" passes GREEN |

**Score:** 4/5 success criteria verified (1 failed)

---

## Required Artifacts

### Plan 01-01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `jest.config.js` | Jest config with ts-jest and @/ path alias | VERIFIED | Contains `preset: 'ts-jest'`, `testEnvironment: 'node'`, `moduleNameMapper: { '^@/(.*)$': ... }` |
| `src/__tests__/lib/active-sessions.test.ts` | Test scaffolds for all DETECT-XX requirements, min 80 lines | VERIFIED | 491 lines, 25 tests covering all 6 DETECT requirements |
| `src/lib/claude-data/types.ts` | ActiveSessionInfo and SessionStatus type exports | VERIFIED | `SessionStatus` at line 176, `ActiveSessionInfo` at line 178, with `status: SessionStatus` field |

### Plan 01-02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/claude-data/active-sessions.ts` | Core detection functions: ACTIVE_SESSION_CONFIG, tailReadJsonl, inferSessionStatus, scanActiveFiles; min 100 lines | VERIFIED | 482 lines, all 4 functions exported, substantive implementations with no stubs |

### Plan 01-03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/claude-data/active-sessions.ts` | Complete engine with getActiveSessions orchestrator; min 200 lines | VERIFIED | 482 lines, getActiveSessions at line 412, TokenCache, fullParseSession, findCurrentBlockStart, updateCacheFromTailRead all present |
| `src/__tests__/lib/active-sessions.test.ts` | Tests for getActiveSessions orchestrator; min 150 lines | VERIFIED | 491 lines, describe('getActiveSessions') block at line 320 with 5 test cases |

---

## Key Link Verification

### Plan 01-01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/__tests__/lib/active-sessions.test.ts` | `src/lib/claude-data/active-sessions` | `import { inferSessionStatus, tailReadJsonl, ACTIVE_SESSION_CONFIG, getActiveSessions }` | WIRED | Lines 13-18 confirm import; all 4 named exports imported and used in tests |
| `jest.config.js` | `src/` | `moduleNameMapper @/ alias` | WIRED | Line 7-9 of jest.config.js: `'^@/(.*)$': '<rootDir>/src/$1'` |

### Plan 01-02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/claude-data/active-sessions.ts` | `src/lib/claude-data/types.ts` | `import { SessionMessage, SessionStatus }` | WIRED | Line 22: `import type { SessionMessage, SessionStatus, ActiveSessionInfo } from './types'` |
| `src/lib/claude-data/active-sessions.ts` | `src/lib/claude-data/reader.ts` | `import { getProjectsDir }` | WIRED | Line 20: `import { getProjectsDir, extractCwdFromSession, projectIdToName, projectIdToFullPath } from './reader'` |

### Plan 01-03 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/claude-data/active-sessions.ts` | `src/config/pricing.ts` | `import { calculateCost }` | WIRED | Line 21: `import { calculateCost } from '@/config/pricing'`; used at lines 338 and 389 |
| `src/lib/claude-data/active-sessions.ts` | `src/lib/claude-data/reader.ts` | `import { getProjectsDir, extractCwdFromSession, projectIdToName, projectIdToFullPath }` | WIRED | Line 20; all 4 helpers used in getActiveSessions (lines 198, 445-447) |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| DETECT-01 | 01-01, 01-02, 01-03 | Detect active sessions by scanning JSONL files modified within last 10 minutes | PARTIAL | scanActiveFiles uses ACTIVE_WINDOW_MS = 30 min, not 10 min as specified. Functional implementation exists but threshold conflicts with requirement text. |
| DETECT-02 | 01-01, 01-02, 01-03 | Infer "working" when last message is assistant with tool calls or file modified within last 10 seconds | SATISFIED | inferSessionStatus: WORKING_SIGNAL_MS=10s at line 124; tool_use check at lines 162-173; 6 working-status tests pass |
| DETECT-03 | 01-01, 01-02 | Infer "waiting" when last message is assistant text without pending tool calls | SATISFIED | inferSessionStatus: assistant branch returns 'waiting' at line 174; 2 tests pass |
| DETECT-04 | 01-01, 01-02 | Infer "idle" when no file modification in last 5 minutes but recently active | SATISFIED | inferSessionStatus: IDLE_CUTOFF_MS=5min at line 120; 2 idle tests pass |
| DETECT-05 | 01-01, 01-02, 01-03 | Use tail-read (last 16KB) instead of full re-parse for performance | SATISFIED | tailReadJsonl uses fs.openSync/readSync byte-seek; TAIL_READ_BYTES=16384; 2 tail-read tests pass. getActiveSessions does full parse on first detection only. |
| DETECT-06 | 01-01, 01-02 | Treat incomplete last-line parse as "working" | SATISFIED | tailReadJsonl sets hasIncompleteWrite=true on last-line parse failure (line 81-83); inferSessionStatus returns 'working' when hasIncompleteWrite=true (line 128-130); 3 tests pass |

**No orphaned requirements.** REQUIREMENTS.md traceability table maps only DETECT-01 through DETECT-06 to Phase 1. All 6 are claimed in Plans 01-01, 01-02, and 01-03.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/claude-data/active-sessions.ts` | 363-386 | Comment says "skip re-accumulating to avoid double-counting" but code actually does accumulate tokens from tail-read | Info | updateCacheFromTailRead does add tokens from tail messages (lines 382-385) despite the comment saying it skips re-accumulation. This is a code/comment inconsistency, not a stub. Actual behavior may cause token over-counting on subsequent polls. |

No TODO/FIXME/placeholder anti-patterns found. No empty stub implementations. All return statements in guard clauses are valid (early exit on missing directory).

**TypeScript compilation:** The `npx tsc --noEmit` run shows errors only for pre-existing missing `next` module declarations caused by the WSL/NTFS npm install issue documented in Plan 01 SUMMARY. Zero errors in `active-sessions.ts`, `types.ts`, or `reader.ts`.

---

## Human Verification Required

### 1. ACTIVE_WINDOW_MS Threshold Decision

**Test:** Review whether ACTIVE_WINDOW_MS should be 10 minutes or 30 minutes
**Expected:** The requirement (DETECT-01), ROADMAP success criterion 1, and the implementation all agree on the same value
**Why human:** This is a product decision. The RESEARCH.md has a user-approved constraint locking it at 30 minutes. REQUIREMENTS.md and ROADMAP say 10 minutes. One of the three documents needs to be updated to remove the contradiction. Implementation itself is correct at whichever value is chosen.

### 2. updateCacheFromTailRead Token Double-Counting

**Test:** Run `getActiveSessions()` twice on a file that grows between calls and compare token counts
**Expected:** Token totals should be accurate and not inflated from double-counting
**Why human:** The implementation comment (line 363) says it skips token re-accumulation to avoid double-counting, but the code at lines 382-385 does accumulate tokens from all tail-read messages. On a second poll where the tail window overlaps previously-parsed content, tokens from already-counted messages would be added again. Needs manual testing with a real JSONL file to confirm behavior.

---

## Gaps Summary

One gap blocks a success criterion:

**DETECT-01 / ROADMAP Success Criterion 1 — Active window threshold mismatch**

The spec (REQUIREMENTS.md DETECT-01 and ROADMAP success criterion 1) says sessions should be scanned from files modified within "the last 10 minutes." The implementation uses `ACTIVE_WINDOW_MS = 30 * 60 * 1000` (30 minutes). The RESEARCH.md user constraints section explicitly sets the threshold to 30 minutes.

This is a requirements/design conflict that requires human resolution:
- If 30 minutes is correct: update REQUIREMENTS.md DETECT-01 description and ROADMAP success criterion 1 to say "30 minutes"
- If 10 minutes is correct: change `ACTIVE_WINDOW_MS = 10 * 60 * 1000` in active-sessions.ts and update the test assertion at line 61

The detection engine is otherwise fully functional — all 25 tests pass, all key links are wired, TypeScript compiles cleanly for all phase-1 files, and 5 of 6 requirements are satisfied. Only the active window threshold requires a decision.

---

_Verified: 2026-03-18T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
