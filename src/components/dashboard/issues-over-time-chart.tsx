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
}

export function IssuesOverTimeChart({ issues }: IssuesOverTimeChartProps) {
  const data = cumulativeIssuesByDay(issues);

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
    cumulative: { label: 'Cumulative Issues', color: 'hsl(142 70% 45%)' },
    count: { label: 'New / Day', color: 'hsl(280 70% 60%)' },
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
                  <stop offset="5%" stopColor="hsl(142 70% 45%)" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="hsl(142 70% 45%)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(280 70% 60%)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="hsl(280 70% 60%)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
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
                stroke="hsl(280 70% 60%)"
                strokeWidth={1.5}
                fill="url(#fillCount)"
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                name="Cumulative"
                stroke="hsl(142 70% 45%)"
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
