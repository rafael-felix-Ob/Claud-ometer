---
phase: 5
slug: sqlite-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30 + ts-jest 29.4.6 |
| **Config file** | `jest.config.js` (root) |
| **Quick run command** | `npm test -- --testPathPattern="db" --no-coverage` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="db" --no-coverage`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | DB-01 | unit | `npm test -- --testPathPattern="db" -t "WAL mode"` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | DB-02 | unit | `npm test -- --testPathPattern="db" -t "getDb"` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | DB-03 | unit | `npm test -- --testPathPattern="db" -t "schema"` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | DB-04 | unit | `npm test -- --testPathPattern="db" -t "singleton"` | ❌ W0 | ⬜ pending |
| 05-01-05 | 01 | 1 | DB-05 | unit | `npm test -- --testPathPattern="db" -t "DB_PATH"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/lib/db.test.ts` — stubs for DB-01 through DB-05
- [ ] Test must use a temp DB path (not `~/.claude/`) to avoid polluting dev data
- [ ] `globalThis.__claudeometerDb = undefined` in `beforeEach` for test isolation

*Note: Jest 30 and ts-jest are already installed. No new framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hot-reload no "database is locked" | DB-04 | Requires running dev server and triggering HMR | Start `npm run dev`, edit a file, check console for errors |
| `next build` completes without native-module bundling errors | DB-02 | Requires full production build | Run `npm run build` and verify exit code 0 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
