import { NextResponse } from 'next/server';
import { getActiveDataSource } from '@/lib/claude-data/data-source';
import { getProjectsFromDb } from '@/lib/db-queries';
import { getProjects } from '@/lib/claude-data/reader';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dataSource = getActiveDataSource();
    const projects = dataSource === 'live'
      ? await getProjectsFromDb()
      : await getProjects();
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}
