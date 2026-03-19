import useSWR from 'swr';
import type { DashboardStats, ProjectInfo, SessionInfo, SessionDetail, ActiveSessionInfo } from '@/lib/claude-data/types';

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
});

export function useStats() {
  return useSWR<DashboardStats>('/api/stats', fetcher);
}

export function useProjects() {
  return useSWR<ProjectInfo[]>('/api/projects', fetcher);
}

export function useSessions(limit = 50, offset = 0, query = '') {
  const url = query
    ? `/api/sessions?q=${encodeURIComponent(query)}&limit=${limit}`
    : `/api/sessions?limit=${limit}&offset=${offset}`;
  return useSWR<SessionInfo[]>(url, fetcher);
}

export function useProjectSessions(projectId: string) {
  return useSWR<SessionInfo[]>(`/api/sessions?projectId=${projectId}`, fetcher);
}

export function useSessionDetail(sessionId: string) {
  return useSWR<SessionDetail>(`/api/sessions/${sessionId}`, fetcher);
}

export function useActiveSessions() {
  return useSWR<ActiveSessionInfo[]>('/api/active-sessions', fetcher, {
    refreshInterval: 5000,
  });
}

export interface SyncStatus {
  lastSynced: string | null;
  sessionCount: number;
  isRunning: boolean;
}

export function useSyncStatus() {
  return useSWR<SyncStatus>('/api/sync-status', fetcher, {
    refreshInterval: 5000,
  });
}
