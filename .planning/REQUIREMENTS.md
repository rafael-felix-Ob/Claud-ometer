# Requirements: Claud-ometer — History Database

**Defined:** 2026-03-19
**Core Value:** At a glance, know what every active Claude Code session is doing right now — with persistent history that follows you across machines

## v1 Requirements

Requirements for the history database milestone. Each maps to roadmap phases.

### Database Foundation

- [ ] **DB-01**: System stores session data in a local SQLite database with WAL mode enabled
- [ ] **DB-02**: System uses Drizzle ORM for type-safe database queries and schema management
- [ ] **DB-03**: Database schema auto-applies on first startup via instrumentation.ts (zero manual setup)
- [ ] **DB-04**: Database connection uses globalThis singleton pattern to prevent hot-reload duplication
- [ ] **DB-05**: Database file lives on Linux ext4 filesystem (not NTFS via WSL) to avoid locking issues

### Ingest

- [ ] **ING-01**: System runs a periodic background job (every 2-5 minutes) that scans for new/modified JSONL files and ingests delta
- [ ] **ING-02**: Ingest uses two-factor delta check (mtime + file size) to skip unchanged files
- [ ] **ING-03**: On first run, system bulk-imports all existing JSONL session history into SQLite
- [ ] **ING-04**: User can see last sync time and session count in the UI (ingest status indicator)

### API Migration

- [ ] **API-01**: Overview, sessions list, projects, and costs pages read from SQLite instead of JSONL
- [ ] **API-02**: Active sessions page continues reading from live JSONL files (not database)
- [ ] **API-03**: Session detail page gets aggregates from DB and messages from JSONL (hybrid)

### Portability

- [ ] **PORT-01**: User can export the SQLite database as a standalone .db file download (separate from JSONL ZIP export)
- [ ] **PORT-02**: User can import a .db file to replace the current database (separate from JSONL ZIP import)
- [ ] **PORT-03**: User can merge a .db file from another machine with deduplication by session ID

### UI

- [ ] **UI-01**: Project detail page shows an activity chart (similar to overview heatmap)
- [ ] **UI-02**: Sidebar shows sync status indicator (last ingest time, DB health)

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
| DB-01 | TBD | Pending |
| DB-02 | TBD | Pending |
| DB-03 | TBD | Pending |
| DB-04 | TBD | Pending |
| DB-05 | TBD | Pending |
| ING-01 | TBD | Pending |
| ING-02 | TBD | Pending |
| ING-03 | TBD | Pending |
| ING-04 | TBD | Pending |
| API-01 | TBD | Pending |
| API-02 | TBD | Pending |
| API-03 | TBD | Pending |
| PORT-01 | TBD | Pending |
| PORT-02 | TBD | Pending |
| PORT-03 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 0
- Unmapped: 17

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after initial definition*
