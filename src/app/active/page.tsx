'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useActiveSessions, useSessionDetail } from '@/lib/hooks';
import { StatCard } from '@/components/cards/stat-card';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { formatTokens, formatCost, formatDuration, timeAgo } from '@/lib/format';
import { getModelDisplayName, getModelColor } from '@/config/pricing';
import { Activity, GitBranch, Zap, AlertTriangle, Layers, ExternalLink } from 'lucide-react';
import type { ActiveSessionInfo } from '@/lib/claude-data/types';

const STATUS_ORDER: Record<string, number> = { working: 0, waiting: 1, idle: 2 };

const STATUS_CONFIG = {
  working: {
    dot: 'bg-green-500 animate-pulse',
    borderColor: '#22c55e', // green-500 — inline style to survive Tailwind v4 JIT purge
    badge: 'bg-green-500/10 text-green-600 border border-green-500/30',
    label: 'Working',
  },
  waiting: {
    dot: 'bg-amber-500',
    borderColor: '#f59e0b', // amber-500
    badge: 'bg-amber-500/10 text-amber-600 border border-amber-500/30',
    label: 'Waiting',
  },
  idle: {
    dot: 'bg-muted-foreground/40',
    borderColor: 'hsl(var(--border))', // matches border token
    badge: 'bg-secondary text-muted-foreground',
    label: 'Idle',
  },
} as const;

function computeTotalTokens(s: ActiveSessionInfo): number {
  return s.totalInputTokens + s.totalOutputTokens + s.totalCacheReadTokens + s.totalCacheWriteTokens;
}

const dataSourceFetcher = (url: string) => fetch(url).then(r => r.json());

function ExpandedCardDetail({ sessionId }: { sessionId: string }) {
  const { data: detail, isLoading } = useSessionDetail(sessionId);

  if (isLoading || !detail) {
    return (
      <div className="pt-3">
        <Separator className="mb-3" />
        <div className="flex items-center justify-center py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  // Get last 4 messages (user and assistant turns only)
  const recentMessages = detail.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-4);

  return (
    <div className="pt-3">
      <Separator className="mb-3" />
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Recent messages
      </p>
      <div className="space-y-2">
        {recentMessages.map((msg, i) => (
          <div
            key={i}
            className={`rounded p-2 text-xs ${
              msg.role === 'user'
                ? 'bg-muted/50'
                : ''
            }`}
          >
            <span className="font-medium text-muted-foreground">
              {msg.role === 'user' ? 'You' : 'Claude'}:
            </span>{' '}
            <span className="line-clamp-3">{msg.content}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-3">
        <Link
          href={`/sessions/${sessionId}`}
          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          View full session
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

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
              <div
                key={session.id}
                className="rounded-xl border border-border/50 shadow-sm cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.01]"
                style={{ borderLeftWidth: '4px', borderLeftColor: config.borderColor, backgroundColor: 'var(--card)' }}
                onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
              >
              <Card className="border-0 shadow-none gap-3 h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate min-w-0 mr-2">
                      <span className="text-sm font-semibold truncate">{session.projectName}</span>
                      {session.gsdProgress?.isGsd && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 font-mono">
                          GSD
                        </Badge>
                      )}
                    </div>
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
                {session.gsdProgress?.isGsd && session.gsdProgress.phaseName && (
                  <CardContent className="pt-0">
                    <Separator className="mb-2" />
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate">
                          Phase {session.gsdProgress.phaseNumber}: {session.gsdProgress.phaseName}
                        </span>
                        {session.gsdProgress.percent !== null && (
                          <span className="shrink-0 font-mono text-[10px]">{session.gsdProgress.percent}%</span>
                        )}
                      </div>
                      {session.gsdProgress.phaseStatus && (
                        <div className="text-[10px] text-muted-foreground/70 truncate">
                          {session.gsdProgress.phaseStatus}
                        </div>
                      )}
                      {session.gsdProgress.nextAction && (
                        <div className="font-mono text-[10px] text-primary/70 truncate">
                          {session.gsdProgress.nextAction}
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
                {expandedId === session.id && (
                  <CardContent className="pt-0">
                    <ExpandedCardDetail sessionId={session.id} />
                  </CardContent>
                )}
              </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
