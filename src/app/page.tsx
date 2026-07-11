'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  MessageSquare,
  Users,
  Archive,
  Activity,
  Hash,
  Database,
} from 'lucide-react';
import { useDashboardStore } from '@/store/dashboard-store';
import {
  filterIssues,
  issuesByTag,
  topIssuesByMessages,
} from '@/lib/dashboard-utils';
import { initSampleDataIfEmpty } from '@/lib/data-loader';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { IssuesOverTimeChart } from '@/components/dashboard/issues-over-time-chart';
import { TagDistributionChart } from '@/components/dashboard/tag-distribution-chart';
import { ThemesPanel } from '@/components/dashboard/themes-panel';
import { TopContributors } from '@/components/dashboard/top-contributors';
import { IssuesTable } from '@/components/dashboard/issues-table';
import { ConfigPanel } from '@/components/dashboard/config-panel';
import { FilterBar } from '@/components/dashboard/filter-bar';
import { Badge } from '@/components/ui/badge';

export default function Home() {
  const {
    issues,
    themes,
    totalResults,
    hasMore,
    source,
    channelId,
    progress,
    lastFetchedAt,
  } = useDashboardStore();

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  // Auto-load sample data on first visit (only client-side, only if empty)
  useEffect(() => {
    initSampleDataIfEmpty();
  }, []);

  const uniqueUsers = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) if (i.ownerId) set.add(i.ownerId);
    return set.size;
  }, [issues]);

  const totalMessages = useMemo(
    () => issues.reduce((sum, i) => sum + (i.totalMessageSent || i.messageCount || 0), 0),
    [issues],
  );

  const archivedCount = useMemo(
    () => issues.filter((i) => i.archived).length,
    [issues],
  );

  const avgMsgPerIssue = issues.length > 0 ? Math.round(totalMessages / issues.length) : 0;

  const tagCounts = useMemo(() => issuesByTag(issues), [issues]);

  const filteredIssues = useMemo(
    () =>
      filterIssues(issues, {
        tagIds: selectedTagIds,
        theme: selectedTheme,
        themes,
      }),
    [issues, selectedTagIds, selectedTheme, themes],
  );

  const topIssues = useMemo(() => topIssuesByMessages(filteredIssues, 5), [filteredIssues]);

  const isAnalyzing = progress.stage === 'analyzing-themes' || (issues.length > 0 && themes.length === 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
                <Hash className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-semibold tracking-tight truncate">
                  Discord Issue Tracker
                </h1>
                <p className="text-xs text-muted-foreground truncate">
                  Channel <span className="font-mono">{channelId}</span>
                  {source ? ` · source: ${source}` : ''}
                  {lastFetchedAt ? ` · updated ${new Date(lastFetchedAt).toLocaleString()}` : ''}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              {hasMore ? (
                <Badge variant="outline" className="text-[10px]">
                  showing {issues.length} of {totalResults.toLocaleString()} total
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {issues.length} issues
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <ConfigPanel />

        {/* KPI cards */}
        <section className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            title="Total Issues"
            value={totalResults > 0 ? totalResults.toLocaleString() : issues.length}
            subtitle={
              totalResults > issues.length
                ? `${issues.length} loaded locally`
                : 'all loaded'
            }
            icon={AlertTriangle}
            accent="text-rose-500"
          />
          <KpiCard
            title="Unique Users"
            value={uniqueUsers}
            subtitle="distinct reporters"
            icon={Users}
            accent="text-emerald-500"
          />
          <KpiCard
            title="Total Messages"
            value={totalMessages.toLocaleString()}
            subtitle={`${avgMsgPerIssue} avg/issue`}
            icon={MessageSquare}
            accent="text-sky-500"
          />
          <KpiCard
            title="Active"
            value={issues.length - archivedCount}
            subtitle="not archived"
            icon={Activity}
            accent="text-amber-500"
          />
          <KpiCard
            title="Archived"
            value={archivedCount}
            subtitle={`${issues.length > 0 ? Math.round((archivedCount / issues.length) * 100) : 0}% of loaded`}
            icon={Archive}
            accent="text-violet-500"
          />
          <KpiCard
            title="Distinct Tags"
            value={tagCounts.length}
            subtitle="forum categories"
            icon={Database}
            accent="text-cyan-500"
          />
        </section>

        {/* Charts row */}
        <section className="grid gap-4 lg:grid-cols-2">
          <IssuesOverTimeChart issues={issues} />
          <TagDistributionChart
            issues={issues}
            onSelectTag={(tagId) =>
              setSelectedTagIds((prev) =>
                prev.includes(tagId!) ? prev.filter((t) => t !== tagId) : [...prev, tagId!],
              )
            }
          />
        </section>

        {/* Themes + Contributors row */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ThemesPanel
              themes={themes}
              totalIssues={issues.length}
              selectedTheme={selectedTheme}
              onSelectTheme={setSelectedTheme}
              isAnalyzing={isAnalyzing}
            />
          </div>
          <TopContributors issues={issues} />
        </section>

        {/* Filter bar */}
        <section className="rounded-lg border bg-card p-3">
          <FilterBar
            issues={issues}
            selectedTagIds={selectedTagIds}
            onToggleTag={(tagId) =>
              setSelectedTagIds((prev) =>
                prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
              )
            }
            onClearTags={() => setSelectedTagIds([])}
          />
        </section>

        {/* Top issues highlight strip (only if we have any with messages) */}
        {topIssues.some((i) => i.messageCount > 0) ? (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {topIssues.map((issue, idx) => (
              <a
                key={issue.id}
                href={`https://discord.com/channels/839993398554656828/${channelId}/${issue.id}`}
                target="_blank"
                rel="noreferrer"
                className="group rounded-lg border bg-card p-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    #{idx + 1} most active
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {issue.messageCount} msgs
                  </Badge>
                </div>
                <p className="mt-1.5 line-clamp-3 text-xs font-medium leading-snug">
                  {issue.name}
                </p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  by {issue.ownerGlobalName ?? issue.ownerUsername}
                </p>
              </a>
            ))}
          </section>
        ) : null}

        {/* Issues table */}
        <IssuesTable
          issues={filteredIssues}
          channelId={channelId}
          selectedTheme={selectedTheme}
          onClearTheme={() => setSelectedTheme(null)}
        />

        <footer className="mt-8 border-t pt-4 text-center text-xs text-muted-foreground">
          Discord Issue Tracker · Data fetched via Discord's <code>/threads/search</code> and{' '}
          <code>/post-data</code> APIs · Theme analysis by LLM
        </footer>
      </main>
    </div>
  );
}
