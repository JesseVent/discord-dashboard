'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMemo } from 'react';
import type { Issue } from '@/lib/discord-types';

interface TimeOfWeekHeatmapProps {
  issues: Issue[];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Heatmap of issue creation by day-of-week × hour-of-day.
 * Helps spot when issues spike (e.g. "Tuesday 9am — deploy window").
 * Uses the user's local timezone.
 */
export function TimeOfWeekHeatmap({ issues }: TimeOfWeekHeatmapProps) {
  const { grid, maxCount, totalInGrid } = useMemo(() => {
    // 7 days × 24 hours
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    let total = 0;
    for (const issue of issues) {
      if (!issue.createdAt) continue;
      const d = new Date(issue.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      // getDay() returns 0=Sun..6=Sat; convert to 0=Mon..6=Sun
      let day = d.getDay() - 1;
      if (day < 0) day = 6; // Sunday → 6
      const hour = d.getHours();
      g[day][hour] += 1;
      max = Math.max(max, g[day][hour]);
      total += 1;
    }
    return { grid: g, maxCount: max, totalInGrid: total };
  }, [issues]);

  function colorFor(count: number): string {
    if (count === 0) return 'var(--agl-surface-2)';
    if (maxCount === 0) return 'var(--agl-surface-2)';
    const intensity = count / maxCount;
    // Interpolate from soft accent to strong accent
    if (intensity < 0.25) return 'oklch(0.92 0.04 255)'; // very light
    if (intensity < 0.5) return 'oklch(0.78 0.10 255)'; // light
    if (intensity < 0.75) return 'oklch(0.65 0.18 255)'; // medium
    return 'oklch(0.55 0.22 255)'; // strong (accent)
  }

  function textColorFor(count: number): string {
    if (count === 0) return 'var(--agl-muted-fg)';
    if (count / Math.max(maxCount, 1) < 0.5) return 'var(--agl-fg)';
    return 'white';
  }

  if (totalInGrid === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Issue Heatmap by Time of Week</CardTitle>
          <CardDescription>When do issues spike? (staffing support)</CardDescription>
        </CardHeader>
        <CardContent className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          No timestamped issues to chart.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issue Heatmap by Time of Week</CardTitle>
        <CardDescription>
          When do issues spike? Darker = more issues. {totalInGrid} issues across {issues.length} loaded. Times in your local timezone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[640px] w-full">
            {/* Hour labels (top) */}
            <div className="flex items-center mb-1">
              <div className="w-9" /> {/* Spacer aligning with Day labels */}
              <div className="flex-1 flex gap-px">
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="flex-1 text-center text-[9px] font-mono text-muted-foreground"
                  >
                    {h % 3 === 0 ? h : ''}
                  </div>
                ))}
              </div>
            </div>
            {/* Grid rows */}
            {DAYS.map((day, dayIdx) => (
              <div key={day} className="flex items-center mb-px">
                <div className="w-9 text-right pr-2 text-[10px] font-mono font-medium text-muted-foreground">
                  {day}
                </div>
                <div className="flex-1 flex gap-px">
                  {HOURS.map((h) => {
                    const count = grid[dayIdx][h];
                    return (
                      <div
                        key={h}
                        className="flex-1 h-6 rounded-xs flex items-center justify-center text-[9px] font-mono font-medium transition-colors hover:ring-1 hover:ring-accent"
                        style={{
                          backgroundColor: colorFor(count),
                          color: textColorFor(count),
                        }}
                        title={`${day} ${h}:00 — ${count} ${count === 1 ? 'issue' : 'issues'}`}
                      >
                        {count > 0 ? count : ''}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center gap-2 mt-3 ml-9">
              <span className="text-[10px] text-muted-foreground font-mono">Less</span>
              <div className="flex gap-px">
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((intensity, i) => (
                  <div
                    key={i}
                    className="w-4 h-3 rounded-xs"
                    style={{ backgroundColor: colorFor(intensity * maxCount) }}
                  />
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">More</span>
              <span className="ml-3 text-[10px] text-muted-foreground">
                Peak: {maxCount} issues in one cell
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
