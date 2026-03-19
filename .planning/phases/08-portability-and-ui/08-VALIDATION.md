---
phase: 8
slug: portability-and-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30 + ts-jest 29 |
| **Config file** | `jest.config.js` (project root) |
| **Quick run command** | `npm test -- --testPathPattern="db-import\|db-export\|db-queries"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="db-import\|db-export\|db-queries"`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 12 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | PORT-01 | unit | `npm test -- --testPathPattern="db-export"` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | PORT-02 | unit | `npm test -- --testPathPattern="db-import"` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | PORT-03 | unit | `npm test -- --testPathPattern="db-import" -t "merge"` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | UI-01 | unit | `npm test -- --testPathPattern="db-queries" -t "activity"` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 2 | PORT-01,02,03 | manual | Visual verify /data page export/import/merge | N/A | ⬜ pending |
| 08-02-03 | 02 | 2 | UI-01 | manual | Visual verify project activity chart | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/lib/db-export.test.ts` — covers PORT-01
- [ ] `src/__tests__/lib/db-import.test.ts` — covers PORT-02 (replace) and PORT-03 (merge + idempotency)
- [ ] Extend `src/__tests__/lib/db-queries.test.ts` — add `getProjectActivityFromDb` tests for UI-01

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| /data page shows Database section | PORT-01,02,03 | Visual UI | Start dev, navigate to /data, verify Database export/import/merge section |
| Project detail shows activity bar chart | UI-01 | Visual UI | Navigate to /projects/[id], verify bar chart renders below stats |
| Merge confirmation and results | PORT-03 | UI interaction | Upload a .db file via merge, verify session counts update |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 12s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
