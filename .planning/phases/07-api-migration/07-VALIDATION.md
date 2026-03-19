---
phase: 7
slug: api-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30 + ts-jest 29 |
| **Config file** | `jest.config.js` (project root) |
| **Quick run command** | `npm test -- --testPathPattern=db-queries` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=db-queries`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | API-01 | unit | `npm test -- --testPathPattern=db-queries -t "stats"` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | API-01 | unit | `npm test -- --testPathPattern=db-queries -t "sessions"` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | API-01 | unit | `npm test -- --testPathPattern=db-queries -t "projects"` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | API-03 | unit | `npm test -- --testPathPattern=db-queries -t "detail"` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | API-01 | integration | `npm run build && npm test` | N/A | ⬜ pending |
| 07-02-02 | 02 | 2 | API-02 | smoke | Verify /active page unchanged | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/lib/db-queries.test.ts` — covers API-01 (stats, sessions, projects) and API-03 (session detail)
- [ ] Seed helper for inserting minimal session rows into test DB

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Overview page loads with data from DB | API-01 | Visual UI | Start dev, verify overview shows data |
| /active page unchanged | API-02 | Visual UI | Check active sessions still show live status |
| Session detail shows conversation | API-03 | Visual UI | Click a session, verify messages display |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
