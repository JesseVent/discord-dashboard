'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { Issue } from '@/lib/discord-types';
import { issuesByTag } from '@/lib/dashboard-utils';

interface TagDistributionChartProps {
  issues: Issue[];
  onSelectTag?: (tagId: string | null) => void;
}

export function TagDistributionChart({ issues, onSelectTag }: TagDistributionChartProps) {
  const data = issuesByTag(issues);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tag Distribution</CardTitle>
          <CardDescription>Issue count by Discord forum tag</CardDescription>
        </CardHeader>
        <CardContent className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          No tagged issues to display.
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
        <CardTitle>Tag Distribution</CardTitle>
        <CardDescription>Issue count by Discord forum tag (click bar to filter)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ left: 8, right: 16, top: 0, bottom: 0 }}
            >
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--agl-muted-fg)' }} />
              <YAxis
                type="category"
                dataKey="name"
                width={110}
                tick={{ fontSize: 11, fill: 'var(--agl-muted-fg)' }}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="count"
                name="Issues"
                radius={[0, 4, 4, 0]}
                cursor={onSelectTag ? 'pointer' : 'default'}
                onClick={(payload: any) => {
                  if (onSelectTag && payload?.tagId) onSelectTag(payload.tagId);
                }}
              >
                {data.map((entry) => (
                  <Cell key={entry.tagId} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
