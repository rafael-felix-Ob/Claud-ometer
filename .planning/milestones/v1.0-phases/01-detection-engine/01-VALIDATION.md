---
phase: 1
slug: detection-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x + ts-jest |
| **Config file** | jest.config.js (Wave 0 installs) |
| **Quick run command** | `npm test -- --testPathPattern=active-sessions` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=active-sessions`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | DETECT-01 | unit | `npm test -- -t "scanActiveFiles"` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 0 | DETECT-02 | unit | `npm test -- -t "inferSessionStatus working"` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 0 | DETECT-03 | unit | `npm test -- -t "inferSessionStatus waiting"` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 0 | DETECT-04 | unit | `npm test -- -t "inferSessionStatus idle"` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 0 | DETECT-05 | unit | `npm test -- -t "tailReadJsonl byte limit"` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 0 | DETECT-06 | unit | `npm test -- -t "tailReadJsonl incomplete"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `jest.config.js` — project root, with ts-jest preset and @/ path alias
- [ ] `package.json` — add `"test": "jest"` script
- [ ] `npm install --save-dev jest @types/jest ts-jest` — framework install
- [ ] `src/__tests__/lib/active-sessions.test.ts` — test stubs for all DETECT-XX requirements

*Framework must be installed before any task commits can run automated verification.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WSL mtime precision safety | DETECT-05 | Requires WSL environment with NTFS-hosted files | Run on WSL, verify `WORKING_SIGNAL_MS` of 10s correctly detects working sessions |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
