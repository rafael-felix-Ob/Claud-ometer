import { NextResponse } from 'next/server';
import { getActiveSessions } from '@/lib/claude-data/active-sessions';
import { getActiveDataSource } from '@/lib/claude-data/data-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (getActiveDataSource() === 'imported') {
      return NextResponse.json([]);
    }

    const sessions = await getActiveSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch active sessions' }, { status: 500 });
  }
}
