---
phase: quick
plan: 260319-vv7
subsystem: ui
tags: [empty-state, first-sync, sidebar, banner]
dependency_graph:
  requires: [useSyncStatus hook, /api/sync-status endpoint]
  provides: [FirstSyncBanner component, first-sync sidebar state]
  affects: [sidebar, overview page, sessions page, projects page, costs page]
tech_stack:
  added: []
  patterns: [self-contained SWR component, conditional null render]
key_files:
  created:
    - src/components/first-sync-banner.tsx
  modified:
    - src/components/layout/sidebar.tsx
    - src/app/page.tsx
    - src/app/sessions/page.tsx
    - src/app/projects/page.tsx
    - src/app/costs/page.tsx
decisions:
  - "Banner calls useSyncStatus() internally rather than accepting props — keeps pages free of sync-state logic"
  - "Renders null (no wrapper div) when condition is false — zero layout impact on normal operation"
metrics:
  duration: 327s
  completed: "2026-03-19"
  tasks_completed: 2
  files_changed: 6
---

# Quick Task 260319-vv7: Add First-Sync Empty State UI — Summary

**One-liner:** Self-contained FirstSyncBanner component and sidebar first-sync indicator using useSyncStatus hook.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Create FirstSyncBanner component and update sidebar | 1a20ed9 | src/components/first-sync-banner.tsx, src/components/layout/sidebar.tsx |
| 2 | Add FirstSyncBanner to all historical pages | 4656c9d | src/app/page.tsx, src/app/sessions/page.tsx, src/app/projects/page.tsx, src/app/costs/page.tsx |

## What Was Built

### FirstSyncBanner component (src/components/first-sync-banner.tsx)
- `'use client'` component that calls `useSyncStatus()` internally
- Renders a Card with `border-primary/30 bg-primary/5` only when `isRunning === true && sessionCount === 0`
- Returns `null` in all other cases — no layout impact
- Shows animated spinner, heading, subtext, and link to `/active`

### Sidebar update (src/components/layout/sidebar.tsx)
- Added new branch in the bottom status section: when `isRunning && sessionCount === 0` shows "Initial sync in progress..." with `animate-pulse` dot and "Scanning ~/.claude/" subtext
- General "Syncing..." state preserved for `isRunning && sessionCount > 0 && !lastSynced`
- All other existing branches (imported, lastSynced, idle) unchanged

### Page integration
- `<FirstSyncBanner />` placed after the header div on all four historical pages
- No conditional logic added to pages; banner self-manages via SWR
- SWR `refreshInterval: 5000` on useSyncStatus ensures banner auto-dismisses when data arrives

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- TypeScript: no errors in non-test source files (pre-existing errors in `src/__tests__/lib/db.test.ts` are out of scope)
- `npm run build` succeeded — all 6 pages compiled without errors

## Self-Check: PASSED

- src/components/first-sync-banner.tsx: exists
- src/components/layout/sidebar.tsx: modified
- Commits 1a20ed9 and 4656c9d: verified in git log
