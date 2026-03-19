import { NextResponse } from 'next/server';
import { getDb, createDb, DB_PATH } from '@/lib/db';
import { stopIngestScheduler, startIngestScheduler, recomputeAggregates, getSyncStatus } from '@/lib/ingest';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const mode = (formData.get('mode') as string) || 'replace';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.name.endsWith('.db')) {
      return NextResponse.json({ error: 'File must be a .db file' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    if (mode === 'merge') {
      return handleMerge(fileBuffer);
    } else {
      return handleReplace(fileBuffer);
    }
  } catch (err) {
    console.error('[db-import] Import failed:', err);
    return NextResponse.json(
      { error: 'Failed to import database' },
      { status: 500 },
    );
  }
}

function handleReplace(fileBuffer: Buffer): NextResponse {
  // Check if ingest is currently running
  const status = getSyncStatus();
  if (status.isRunning) {
    return NextResponse.json(
      { error: 'Ingest cycle in progress. Try again in a moment.' },
      { status: 409 },
    );
  }

  // 1. Stop ingest scheduler
  stopIngestScheduler();

  // 2. Close the live DB connection
  try { globalThis.__claudeometerDb?.close(); } catch { /* ignore */ }
  globalThis.__claudeometerDb = undefined;

  // 3. Remove stale WAL and SHM files
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* ignore if not exists */ }
  }

  // 4. Write uploaded file to DB_PATH
  fs.writeFileSync(DB_PATH, fileBuffer);

  // 5. Reinitialize DB singleton (validates schema, applies pragmas)
  createDb(DB_PATH);

  // 6. Restart ingest scheduler (runs immediate cycle too)
  startIngestScheduler();

  const db = getDb();
  const sessionCount = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;

  return NextResponse.json({
    success: true,
    mode: 'replace',
    sessionCount,
  });
}

function handleMerge(fileBuffer: Buffer): NextResponse {
  const db = getDb();
  const srcPath = path.join(os.tmpdir(), `claud-ometer-merge-${Date.now()}.db`);

  fs.writeFileSync(srcPath, fileBuffer);

  try {
    db.exec(`ATTACH DATABASE '${srcPath}' AS src`);

    db.transaction(() => {
      // Merge sessions: only replace if incoming has more messages (or doesn't exist yet)
      db.prepare(`
        INSERT OR REPLACE INTO sessions
        SELECT src.sessions.*
        FROM src.sessions
        LEFT JOIN main.sessions ON main.sessions.id = src.sessions.id
        WHERE main.sessions.id IS NULL
           OR src.sessions.message_count > main.sessions.message_count
      `).run();

      // Merge ingested_files tracking (union, don't overwrite)
      db.prepare(`
        INSERT OR IGNORE INTO ingested_files
        SELECT * FROM src.ingested_files
      `).run();
    })();

    db.exec('DETACH DATABASE src');

    // Rebuild all aggregate tables from merged sessions
    recomputeAggregates(db);

    const sessionCount = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;

    return NextResponse.json({
      success: true,
      mode: 'merge',
      sessionCount,
    });
  } catch (err) {
    // Ensure DETACH on error path
    try { db.exec('DETACH DATABASE src'); } catch { /* may already be detached */ }
    throw err;
  } finally {
    try { fs.unlinkSync(srcPath); } catch { /* ignore */ }
  }
}
