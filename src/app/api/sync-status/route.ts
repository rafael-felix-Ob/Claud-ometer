import { NextResponse } from 'next/server';
import { getSyncStatus } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(getSyncStatus());
}
