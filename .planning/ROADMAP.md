# Roadmap: Claud-ometer

## Milestones

- ✅ **v1.0 Active Sessions** — Phases 1-4 (shipped 2026-03-19)
- 🚧 **v1.1 History Database** — Phases 5-8 (in progress)

## Phases

<details>
<summary>✅ v1.0 Active Sessions (Phases 1-4) — SHIPPED 2026-03-19</summary>

- [x] Phase 1: Detection Engine (3/3 plans) — completed 2026-03-18
- [x] Phase 2: Active Sessions Page (3/3 plans) — completed 2026-03-18
- [x] Phase 3: GSD Integration (2/2 plans) — completed 2026-03-18
- [x] Phase 4: Tech Debt Cleanup (1/1 plan) — completed 2026-03-19

</details>

### 🚧 v1.1 History Database (In Progress)

**Milestone Goal:** Persist parsed session data into a local SQLite database so all historical pages load from pre-parsed rows instead of re-scanning the filesystem on every request, with cross-machine portability via .db file export/import/merge.

- [x] **Phase 5: SQLite Foundation** — DB connection, schema, WAL mode, Linux ext4 placement, and build config verified before any data is written (completed 2026-03-19)
- [ ] **Phase 6: Delta Ingest** — Background job populates the database; two-factor delta check keeps ingest fast; sync status visible in UI
- [ ] **Phase 7: API Migration** — All historical pages read from SQLite; active sessions and session detail messages continue reading JSONL
- [ ] **Phase 8: Portability and UI** — Export/import/merge .db files across machines; project detail activity chart powered by DB

## Phase Details

### Phase 5: SQLite Foundation
**Goal**: A working SQLite connection with correct schema, WAL mode enabled, and the DB file confirmed on Linux ext4 — all architectural decisions locked in before any data is written
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: DB-01, DB-02, DB-03, DB-04, DB-05
**Success Criteria** (what must be TRUE):
  1. The app starts without manual setup and a `.db` file appears in `~/.claude/` (not under `/mnt/c/`)
  2. A `-wal` companion file appears alongside the `.db` file confirming WAL mode is active on Linux ext4
  3. Hot-reloading the dev server does not produce "database is locked" errors
  4. `next build` completes without native-module bundling errors for `better-sqlite3`
  5. The schema tables (`sessions`, `projects`, `daily_activity`, `model_usage`, `ingested_files`) exist and are queryable after first startup
**Plans**: 1 plan

Plans:
- [ ] 05-01-PLAN.md — Install better-sqlite3, create db.ts singleton with 5-table schema, verify build

### Phase 6: Delta Ingest
**Goal**: A background job that populates the database from JSONL files on startup and every 2 minutes, skipping unchanged files via two-factor delta check, with sync status visible in the sidebar
**Depends on**: Phase 5
**Requirements**: ING-01, ING-02, ING-03, ING-04, UI-02
**Success Criteria** (what must be TRUE):
  1. On first startup, all existing JSONL session history is imported into the database with no manual trigger
  2. Modifying a JSONL file causes only that file to be re-ingested on the next cycle; unchanged files are skipped
  3. The sidebar shows "last synced X seconds/minutes ago" that updates without a page reload
  4. Running the ingest job twice on the same unchanged dataset produces identical DB row counts (idempotent)
  5. Hot-reloading the dev server does not spawn multiple ingest scheduler instances
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: API Migration
**Goal**: All historical API routes read from SQLite instead of JSONL, returning identical data shapes, while active sessions and session detail conversation messages continue reading live JSONL files
**Depends on**: Phase 6
**Requirements**: API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. Overview, sessions list, projects, and costs pages load with data after disabling direct JSONL reads
  2. The /active page continues showing live session status with no change in behavior
  3. A session detail page shows the correct aggregates (tokens, cost, duration) from DB and the full conversation from JSONL
  4. The DB-backed API output matches the JSONL-backed baseline on the same dataset (correctness validation passes)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Portability and UI
**Goal**: Users can move their session history across machines by exporting, importing, or merging .db files, and the project detail page shows an activity chart powered by the database
**Depends on**: Phase 7
**Requirements**: PORT-01, PORT-02, PORT-03, UI-01
**Success Criteria** (what must be TRUE):
  1. User can download a standalone `.db` file from the /data page that opens correctly in a SQLite viewer on another machine
  2. User can upload a `.db` file to replace the current database and immediately see the imported data in all pages
  3. User can merge a `.db` file from another machine and sessions present in both are deduplicated by session ID with the higher message-count version preserved
  4. Merging the same `.db` file twice produces the same row count as merging it once (idempotent merge)
  5. Project detail page shows an activity bar chart of daily usage for that project
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in strict dependency order: 5 -> 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Detection Engine | v1.0 | 3/3 | Complete | 2026-03-18 |
| 2. Active Sessions Page | v1.0 | 3/3 | Complete | 2026-03-18 |
| 3. GSD Integration | v1.0 | 2/2 | Complete | 2026-03-18 |
| 4. Tech Debt Cleanup | v1.0 | 1/1 | Complete | 2026-03-19 |
| 5. SQLite Foundation | 1/1 | Complete   | 2026-03-19 | - |
| 6. Delta Ingest | v1.1 | 0/? | Not started | - |
| 7. API Migration | v1.1 | 0/? | Not started | - |
| 8. Portability and UI | v1.1 | 0/? | Not started | - |
