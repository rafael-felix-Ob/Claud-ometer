# Requirements: Claud-ometer — History Database

**Defined:** 2026-03-19
**Core Value:** At a glance, know what every active Claude Code session is doing right now — with persistent history that follows you across machines

## v1 Requirements

Requirements for the history database milestone. Each maps to roadmap phases.

### Database Foundation

- [x] **DB-01**: System stores session data in a local SQLite database with WAL mode enabled
- [x] **DB-02**: System uses better-sqlite3 for direct SQLite access with TypeScript types from types.ts
- [x] **DB-03**: Database schema auto-applies on first startup via instrumentation.ts (zero manual setup)
- [x] **DB-04**: Database connection uses globalThis singleton pattern to prevent hot-reload duplication
- [x] **DB-05**: Database file lives on Linux ext4 filesystem (not NTFS via WSL) to avoid locking issues

### Ingest

- [x] **ING-01**: System runs a periodic background job (every 2-5 minutes) that scans for new/modified JSONL files and ingests delta
- [x] **ING-02**: Ingest uses two-factor delta check (mtime + file size) to skip unchanged files
- [x] **ING-03**: On first run, system bulk-imports all existing JSONL session history into SQLite
- [x] **ING-04**: User can see last sync time and session count in the UI (ingest status indicator)

### API Migration

- [x] **API-01**: Overview, sessions list, projects, and costs pages read from SQLite instead of JSONL
- [ ] **API-02**: Active sessions page continues reading from live JSONL files (not database)
- [x] **API-03**: Session detail page gets aggregates from DB and messages from JSONL (hybrid)

### Portability

- [ ] **PORT-01**: User can export the SQLite database as a standalone .db file download (separate from JSONL ZIP export)
- [ ] **PORT-02**: User can import a .db file to replace the current database (separate from JSONL ZIP import)
- [ ] **PORT-03**: User can merge a .db file from another machine with deduplication by session ID

### UI

- [ ] **UI-01**: Project detail page shows an activity chart (similar to overview heatmap)
- [x] **UI-02**: Sidebar shows sync status indicator (last ingest time, DB health)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Portability

- **PORT-04**: Merge preview showing what will be added/updated before committing
- **PORT-05**: Selective merge (choose which projects/sessions to import)

### Advanced Analytics

- **ANAL-01**: Per-project cost trends over time chart
- **ANAL-02**: Token velocity trends (tokens/minute) across sessions

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud database (Supabase/Postgres) | Local-first philosophy; SQLite is zero-config and portable |
| Real-time ingest via file watcher (chokidar) | Periodic polling is simpler; active sessions already handle real-time from JSONL |
| Store full message content in SQLite | Too large; session detail messages stay in JSONL files |
| Modify existing JSONL export/import | DB portability is a separate system; JSONL export/import stays as-is |
| Automatic cloud sync between machines | User-controlled export/merge is simpler and more transparent |
| Database encryption | Local-first tool; filesystem permissions are sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 5 | Complete |
| DB-02 | Phase 5 | Complete |
| DB-03 | Phase 5 | Complete |
| DB-04 | Phase 5 | Complete |
| DB-05 | Phase 5 | Complete |
| ING-01 | Phase 6 | Complete |
| ING-02 | Phase 6 | Complete |
| ING-03 | Phase 6 | Complete |
| ING-04 | Phase 6 | Complete |
| API-01 | Phase 7 | Complete |
| API-02 | Phase 7 | Pending |
| API-03 | Phase 7 | Complete |
| PORT-01 | Phase 8 | Pending |
| PORT-02 | Phase 8 | Pending |
| PORT-03 | Phase 8 | Pending |
| UI-01 | Phase 8 | Pending |
| UI-02 | Phase 6 | Complete |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after roadmap creation*
