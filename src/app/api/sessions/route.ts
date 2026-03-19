import { NextResponse } from 'next/server';
import { getActiveDataSource } from '@/lib/claude-data/data-source';
import { getSessionsFromDb, getProjectSessionsFromDb, searchSessionsFromDb } from '@/lib/db-queries';
import { getSessions, getProjectSessions, searchSessions } from '@/lib/claude-data/reader';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const query = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const dataSource = getActiveDataSource();

    if (query) {
      const sessions = dataSource === 'live'
        ? await searchSessionsFromDb(query, limit)
        : await searchSessions(query, limit);
      return NextResponse.json(sessions);
    }

    if (projectId) {
      const sessions = dataSource === 'live'
        ? await getProjectSessionsFromDb(projectId)
        : await getProjectSessions(projectId);
      return NextResponse.json(sessions);
    }

    const sessions = dataSource === 'live'
      ? await getSessionsFromDb(limit, offset)
      : await getSessions(limit, offset);
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}
