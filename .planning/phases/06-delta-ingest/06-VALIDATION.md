---
phase: 6
slug: delta-ingest
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.3.0 + ts-jest 29.4.6 |
| **Config file** | `jest.config.js` (exists) |
| **Quick run command** | `npx jest src/__tests__/lib/ingest.test.ts --testTimeout=10000` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest src/__tests__/lib/ingest.test.ts --testTimeout=10000`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | ING-01 | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "startIngestScheduler"` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | ING-02 | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "delta check"` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | ING-03 | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "bulk import"` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | ING-04 | unit | `npx jest src/__tests__/lib/ingest.test.ts -t "getSyncStatus"` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | UI-02 | manual | Visually verify sidebar bottom section | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/lib/ingest.test.ts` — covers ING-01 through ING-04
- [ ] Test helper: tmp JSONL fixtures (small synthetic files) for delta check tests
- [ ] Framework install: already present (Jest + ts-jest in devDependencies)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sidebar shows "Synced Xs ago" in live mode | UI-02 | Visual UI component | Start dev server, check sidebar bottom section shows relative time |
| Sidebar hides sync status in imported mode | UI-02 | Visual UI component | Switch to imported mode, verify sync status disappears |
| Hot-reload doesn't spawn multiple schedulers | ING-01 | Requires HMR trigger | Edit a file while dev server runs, check console for duplicate "Ingest cycle" logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
