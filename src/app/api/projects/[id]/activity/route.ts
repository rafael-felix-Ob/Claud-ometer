import { NextResponse } from 'next/server';
import { getProjectActivityFromDb } from '@/lib/db-queries';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const projectId = decodeURIComponent(id);
    const activity = getProjectActivityFromDb(projectId);
    return NextResponse.json(activity);
  } catch (err) {
    console.error('[project-activity] Query failed:', err);
    return NextResponse.json(
      { error: 'Failed to load project activity' },
      { status: 500 },
    );
  }
}
