'use client';

import Link from 'next/link';
import { Database } from 'lucide-react';
import { useSyncStatus } from '@/lib/hooks';
import { Card, CardContent } from '@/components/ui/card';

export function FirstSyncBanner() {
  const { data: syncStatus } = useSyncStatus();

  if (!(syncStatus?.isRunning === true && syncStatus?.sessionCount === 0)) {
    return null;
  }

  return (
    <Card className="border-primary/30 bg-primary/5 shadow-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Database is syncing for the first time</p>
          <p className="text-xs text-muted-foreground">
            Historical data will appear here shortly. Active sessions are available now.
          </p>
          <Link href="/active" className="text-xs text-primary hover:underline">
            View active sessions
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
