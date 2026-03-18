'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useActiveSessions } from '@/lib/hooks';
import { StatCard } from '@/components/cards/stat-card';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatTokens, formatCost, formatDuration, timeAgo } from '@/lib/format';
import { getModelDisplayName, getModelColor } from '@/config/pricing';
import { Activity, GitBranch, Zap, AlertTriangle, Layers } from 'lucide-react';
import type { ActiveSessionInfo } from '@/lib/claude-data/types';

const STATUS_ORDER: Record<string, number> = { working: 0, waiting: 1, idle: 2 };

const STATUS_CONFIG = {
  working: {
    dot: 'bg-green-500 animate-pulse',
    border: 'border-l-green-500',
    badge: 'bg-green-500/10 text-green-600 border border-green-500/30',
    label: 'Working',
  },
  waiting: {
    dot: 'bg-amber-500',
    border: 'border-l-amber-500',
    badge: 'bg-amber-500/10 text-amber-600 border border-amber-500/30',
    label: 'Waiting',
  },
  idle: {
    dot: 'bg-muted-foreground/40',
    border: 'border-l-border',
    badge: 'bg-secondary text-muted-foreground',
    label: 'Idle',
  },
} as const;

function computeTotalTokens(s: ActiveSessionInfo): number {
  return s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheWriteTokens;
}

const dataSourceFetcher = (url: string) => fetch(url).then(r => r.json());

export default function ActiveSessionsPage() {
  const { data: sessions, isLoading, error } = useActiveSessions();
  const { data: sourceInfo } = useSWR('/api/data-source', dataSourceFetcher, { refreshInterval: 5000 });
  const isImported = sourceInfo?.active === 'imported';

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (sessions !== undefined) {
      setLastUpdated(new Date());
    }
  }, [sessions]);

  const sorted = [...(sessions || [])].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)
  );

  const activeNowCount = sorted.filter(s => s.status === 'working' || s.status === 'waiting').length;
  const totalCount = sorted.length;
  const totalTokensSum = sorted.reduce((sum, s) => sum + computeTotalTokens(s), 0);

  if (isLoading || (!sessions && !error)) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (error && !sessions) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Failed to load active sessions</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Active Sessions ({sorted.length})
        </h1>
        <p className="text-sm text-muted-foreground">
          {lastUpdated ? `Updated ${timeAgo(lastUpdated.toISOString())}` : 'Loading...'}
        </p>
      </div>

      {/* Imported data banner — ONLY when isImported is true */}
      {isImported && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-600">Live monitoring unavailable</p>
            <p className="text-xs text-muted-foreground">
              You&apos;re viewing imported data. Switch to live mode to monitor active sessions.
            </p>
          </div>
        </div>
      )}

      {/* Summary stat row — 3 cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard title="Active Now" value={activeNowCount.toString()} icon={Activity} />
        <StatCard title="Sessions" value={totalCount.toString()} icon={Layers} />
        <StatCard title="Tokens (Recent)" value={formatTokens(totalTokensSum)} icon={Zap} />
      </div>

      {/* Empty state OR card grid */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Activity className="h-10 w-10 text-muted-foreground/30 mb-4" />
          <h2 className="text-sm font-semibold text-muted-foreground">No active sessions</h2>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Claude Code isn&apos;t running in any projects right now.{' '}
            <Link href="/sessions" className="text-primary hover:text-primary/80">
              View session history
            </Link>{' '}
            to review past activity.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {sorted.map((session) => {
            const config = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.idle;
            const totalTokens = computeTotalTokens(session);
            return (
              <Card
                key={session.id}
                className={`border-l-4 ${config.border} border-border/50 shadow-sm cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01] gap-3`}
                onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold truncate mr-2">{session.projectName}</span>
                    <Badge variant="secondary" className={`text-xs shrink-0 ${config.badge}`}>
                      <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${config.dot}`} />
                      {config.label}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-semibold">{formatDuration(session.duration)}</span>
                    <span className="text-xs text-muted-foreground">Active {timeAgo(session.lastActivity)}</span>
                  </div>
                </CardHeader>
                <CardContent className={`pt-0 space-y-2 ${session.status === 'idle' ? 'opacity-75' : ''}`}>
                  {/* Tokens + cost */}
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    <span>{formatTokens(totalTokens)} tokens &bull; {formatCost(session.estimatedCost)}</span>
                  </div>
                  {/* Model badge */}
                  <div>
                    <Badge variant="secondary" className="text-xs">
                      <span style={{ color: getModelColor(session.model) }}>
                        {getModelDisplayName(session.model)}
                      </span>
                    </Badge>
                  </div>
                  {/* Git branch */}
                  {session.gitBranch && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <GitBranch className="h-3 w-3" />
                      <span className="font-mono truncate max-w-[160px]">{session.gitBranch}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
