import { NextResponse } from 'next/server';
import { getActiveDataSource } from '@/lib/claude-data/data-source';
import { getDashboardStatsFromDb } from '@/lib/db-queries';
import { getDashboardStats } from '@/lib/claude-data/reader';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dataSource = getActiveDataSource();
    const stats = dataSource === 'live'
      ? await getDashboardStatsFromDb()
      : await getDashboardStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
