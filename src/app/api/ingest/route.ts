import { NextResponse } from 'next/server';
import { runIngestCycle } from '@/lib/ingest';
import { getImportDir } from '@/lib/claude-data/data-source';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.source === 'imported') {
      // ZIP Import -> SQLite bridge: ingest from imported JSONL files
      // Per RESEARCH.md Pitfall 6: the imported ZIP extracts to
      // getImportDir()/claude-data/projects/<projectId>/<session>.jsonl
      // runIngestCycle expects a projectsDir that directly contains project subdirectories
      const projectsDir = path.join(getImportDir(), 'claude-data', 'projects');
      await runIngestCycle(projectsDir);
    } else {
      // Standard re-ingest from live data
      await runIngestCycle();
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[ingest] Ingest failed:', err);
    return NextResponse.json(
      { error: 'Failed to run ingest cycle' },
      { status: 500 },
    );
  }
}
