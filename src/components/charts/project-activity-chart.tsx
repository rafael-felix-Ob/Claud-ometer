'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DailyActivity } from '@/lib/claude-data/types';
import { format, parseISO } from 'date-fns';

interface ProjectActivityChartProps {
  data: DailyActivity[];
}

type MetricKey = 'messageCount' | 'sessionCount';

const metrics: { key: MetricKey; label: string; color: string }[] = [
  { key: 'messageCount', label: 'Messages', color: '#D4764E' },
  { key: 'sessionCount', label: 'Sessions', color: '#6B8AE6' },
];

export function ProjectActivityChart({ data }: ProjectActivityChartProps) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('messageCount');

  const chartData = data.map(d => ({
    ...d,
    dateLabel: format(parseISO(d.date), 'MMM d'),
  }));

  const activeConfig = metrics.find(m => m.key === activeMetric)!;

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Activity (Last 30 Days)</CardTitle>
          <div className="flex gap-1">
            {metrics.map(m => (
              <button
                key={m.key}
                onClick={() => setActiveMetric(m.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeMetric === m.key
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No activity in the last 30 days</p>
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar
                  dataKey={activeMetric}
                  fill={activeConfig.color}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
