---
phase: 2
slug: active-sessions-page
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.x + ts-jest (existing from Phase 1) |
| **Config file** | jest.config.js (exists) |
| **Quick run command** | `npm test -- --testPathPattern=active` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=active`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | UI-02 | unit | `npm test -- -t "sidebar"` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | UI-03 | unit | `npm test -- -t "useActiveSessions"` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 2 | DISP-01 | unit | `npm test -- -t "duration"` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 2 | DISP-02 | unit | `npm test -- -t "tokens"` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 2 | DISP-03,04 | unit | `npm test -- -t "project|branch"` | ❌ W0 | ⬜ pending |
| 2-02-04 | 02 | 2 | DISP-05 | unit | `npm test -- -t "model"` | ❌ W0 | ⬜ pending |
| 2-02-05 | 02 | 2 | UI-05 | unit | `npm test -- -t "sort"` | ❌ W0 | ⬜ pending |
| 2-02-06 | 02 | 2 | DISP-06 | unit | `npm test -- -t "session link"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/lib/active-page.test.ts` — test stubs for sort logic, token computation, formatting
- [ ] Test for sidebar navItems Active entry
- [ ] Test for useActiveSessions hook configuration

*Existing test infrastructure from Phase 1 covers Jest setup — only new test files needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Card grid renders at /active | UI-01 | Requires browser/jsdom | Navigate to /active, verify card grid layout |
| Animated pulse on working cards | UI-04 | CSS animation visual | Check working cards have green pulse dot |
| Empty state displayed | UI-06 | Visual verification | Stop all Claude sessions, verify empty state |
| Imported data banner | UI-07 | Requires imported data mode | Switch to imported mode, verify banner |
| Card expand shows messages | DISP-06 | Interactive behavior | Click card, verify last messages + link |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
