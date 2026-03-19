import { NextResponse } from 'next/server';
import { getDb, DB_PATH } from '@/lib/db';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    // Flush WAL frames into main DB file before copying
    db.pragma('wal_checkpoint(TRUNCATE)');

    const tmpPath = path.join(os.tmpdir(), `claud-ometer-export-${Date.now()}.db`);
    try {
      fs.copyFileSync(DB_PATH, tmpPath);
      const buffer = fs.readFileSync(tmpPath);
      const date = new Date().toISOString().slice(0, 10);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="claud-ometer-${date}.db"`,
          'Content-Length': buffer.length.toString(),
        },
      });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup failure */ }
    }
  } catch (err) {
    console.error('[db-export] Export failed:', err);
    return NextResponse.json(
      { error: 'Failed to export database' },
      { status: 500 },
    );
  }
}
