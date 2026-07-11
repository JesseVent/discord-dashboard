'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { Issue } from '@/lib/discord-types';
import { responseTimeDistribution } from '@/lib/dashboard-utils';

interface ResponseTimeChartProps {
  issues: Issue[];
}

const BUCKET_COLORS = [
  'var(--agl-success)',   // < 1h — green
  'var(--agl-cat-chain)', // 1-6h — green-ish
  'var(--agl-cat-agent)', // 6-24h — blue
  'var(--agl-warning)',   // 1-3d — amber
  'var(--agl-pending)',   // 3-7d — purple
  'var(--agl-error)',     // > 7d — red
];

/**
 * Distribution of time-to-first-reply across all answered issues.
 * Helps spot if the community responds quickly or slowly.
 */
export function ResponseTimeChart({ issues }: ResponseTimeChartProps) {
  const hasReplies = issues.some((i) => i.replies !== undefined);
  const data = responseTimeDistribution(issues);
  const totalAnswered = data.reduce((s, d) => s + d.count, 0);

  if (!hasReplies) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Response Time Distribution</CardTitle>
          <CardDescription>Time from issue creation to first reply</CardDescription>
        </CardHeader>
        <CardContent className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          Click "Fetch Replies" in Data Source to populate.
        </CardContent>
      </Card>
    );
  }

  if (totalAnswered === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Response Time Distribution</CardTitle>
          <CardDescription>Time from issue creation to first reply</CardDescription>
        </CardHeader>
        <CardContent className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          No answered issues with response-time data.
        </CardContent>
      </Card>
    );
  }

  const chartConfig = {
    count: { label: 'Issues', color: 'var(--agl-accent)' },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Response Time Distribution</CardTitle>
        <CardDescription>
          Time from issue creation to first reply ({totalAnswered} answered)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--agl-border)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" name="Issues" radius={[4, 4, 0, 0]}>
                {data.map((entry, idx) => (
                  <Cell key={entry.bucket} fill={BUCKET_COLORS[idx] ?? 'var(--agl-accent)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
