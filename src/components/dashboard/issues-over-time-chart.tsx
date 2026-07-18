'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { Issue } from '@/lib/discord-types';
import { cumulativeIssuesByDay } from '@/lib/dashboard-utils';

interface IssuesOverTimeChartProps {
  issues: Issue[];
  serverDailyStats?: any[];
}

export function IssuesOverTimeChart({ issues, serverDailyStats }: IssuesOverTimeChartProps) {
  let data;
  if (serverDailyStats && serverDailyStats.length > 0) {
    let running = 0;
    data = serverDailyStats.map(d => {
      running += Number(d.issue_count) || 0;
      return { date: d.date, count: Number(d.issue_count) || 0, cumulative: running };
    });
  } else {
    data = cumulativeIssuesByDay(issues);
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Issues Over Time</CardTitle>
          <CardDescription>Cumulative issue count by creation date</CardDescription>
        </CardHeader>
        <CardContent className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          No timestamped issues to chart.
        </CardContent>
      </Card>
    );
  }

  const chartConfig = {
    cumulative: { label: 'Cumulative Issues', color: 'var(--agl-accent)' },
    count: { label: 'New / Day', color: 'var(--agl-pending)' },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issues Over Time</CardTitle>
        <CardDescription>
          Cumulative issue count by creation date ({data.length} active days)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="fillCumulative" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--agl-accent)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--agl-accent)" stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--agl-pending)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--agl-pending)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--agl-border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
                minTickGap={24}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="count"
                name="New / Day"
                stroke="var(--agl-pending)"
                strokeWidth={1.5}
                fill="url(#fillCount)"
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                name="Cumulative"
                stroke="var(--agl-accent)"
                strokeWidth={2}
                fill="url(#fillCumulative)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
