'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSessions } from '@/lib/hooks';
import { formatCost, formatDuration, timeAgo, formatTokens } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, GitBranch, MessageSquare, FolderKanban, Minimize2, Search, X, Timer, ChevronDown, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { FirstSyncBanner } from '@/components/first-sync-banner';

const PAGE_SIZE = 15;

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function SessionsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-[80vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading sessions...</p>
        </div>
      </div>
    }>
      <SessionsContent />
    </Suspense>
  );
}

function SessionsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Fetch all matching sessions (DB query is fast), display incrementally
  const { data: sessions, isLoading } = useSessions(200, 0, debouncedQuery);

  // Sync debounced query to URL (only when query actually changes)
  const syncUrl = useCallback((q: string) => {
    const url = q ? `/sessions?q=${encodeURIComponent(q)}` : '/sessions';
    router.replace(url, { scroll: false });
  }, [router]);

  useEffect(() => {
    syncUrl(debouncedQuery);
    setVisibleCount(PAGE_SIZE); // Reset pagination on new search
  }, [debouncedQuery, syncUrl]);

  if (isLoading || !sessions) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading sessions...</p>
        </div>
      </div>
    );
  }

  const visibleSessions = sessions.slice(0, visibleCount);
  const hasMore = visibleCount < sessions.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            {debouncedQuery && ` matching "${debouncedQuery}"`}
          </p>
        </div>
      </div>

      <FirstSyncBanner />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search across all session messages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-0">
          <div className="divide-y divide-border/50">
            {sessions.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Search className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm text-muted-foreground">No sessions found{debouncedQuery && ` matching "${debouncedQuery}"`}</p>
              </div>
            ) : visibleSessions.map(session => (
              <Link
                key={session.id}
                href={`/sessions/${session.id}`}
                className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-accent/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                      {session.projectName}
                    </span>
                    {[...new Set(session.models)].map(m => (
                      <Badge key={m} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {m}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    {session.gitBranch && (
                      <span className="flex items-center gap-1 truncate max-w-[200px]">
                        <GitBranch className="h-3 w-3 flex-shrink-0" />
                        {session.gitBranch}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(session.duration)}
                    </span>
                    {(session.activeTime || 0) > 0 && (
                      <span className="flex items-center gap-1" title="Active work time (excludes idle)">
                        <Timer className="h-3 w-3" />
                        {formatDuration(session.activeTime)}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {session.messageCount} msgs
                    </span>
                    <span>{session.toolCallCount} tools</span>
                    <span>{formatTokens(session.totalInputTokens + session.totalOutputTokens)} tokens</span>
                    {(session.compaction.compactions + session.compaction.microcompactions) > 0 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <Minimize2 className="h-3 w-3" />
                        {session.compaction.compactions + session.compaction.microcompactions} compactions
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-sm font-semibold">{formatCost(session.estimatedCost)}</p>
                  <p className="text-[10px] text-muted-foreground">{timeAgo(session.timestamp)}</p>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {hasMore && (
        <button
          onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className="h-4 w-4" />
          Load more ({sessions.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}
