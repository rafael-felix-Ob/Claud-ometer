---
phase: 3
slug: gsd-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x + ts-jest (existing from Phase 1) |
| **Config file** | jest.config.js (exists) |
| **Quick run command** | `npm test -- --testPathPattern=gsd-reader` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=gsd-reader`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | GSD-01 | unit | `npm test -- -t "readGsdProgress"` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | GSD-02 | unit | `npm test -- -t "next action"` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | GSD-03 | unit | `npm test -- -t "null for non-GSD"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/lib/gsd-reader.test.ts` — test stubs for readGsdProgress with real STATE.md content

*Existing test infrastructure from Phase 1 covers Jest setup — only new test file needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GSD section renders on card | GSD-01 | Visual UI | Run dev server, check card in GSD project shows phase + status |
| Non-GSD card has no GSD section | GSD-03 | Visual UI | Check card for non-GSD project has no GSD indicator |
| GSD data updates with polling | GSD-01 | Timing behavior | Watch card, verify GSD info refreshes every 5s |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
