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
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageCircleReply,
  Zap,
  Github,
  Linkedin,
  Wrench,
  Puzzle,
} from 'lucide-react';
import { useDashboardStore } from '@/store/dashboard-store';
import {
  filterIssues,
  issuesByTag,
  topIssuesByMessages,
  responseAnalytics,
  fmtDuration,
  calculateWeeklyTrends,
} from '@/lib/dashboard-utils';
import { initSampleDataIfEmpty } from '@/lib/data-loader';
import type { Issue } from '@/lib/discord-types';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { IssuesOverTimeChart } from '@/components/dashboard/issues-over-time-chart';
import { TagDistributionChart } from '@/components/dashboard/tag-distribution-chart';
import { ThemesPanel } from '@/components/dashboard/themes-panel';
import { TopContributors } from '@/components/dashboard/top-contributors';
import { TopResponders } from '@/components/dashboard/top-responders';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';
import { UnansweredIssues } from '@/components/dashboard/unanswered-issues';
import { IssuesTable, IssueDetailDialog } from '@/components/dashboard/issues-table';
import { ConfigPanel } from '@/components/dashboard/config-panel';
import { threadUrl } from '@/lib/discord-api';
import {
  FilterBar,
  type DashboardFilters,
  EMPTY_FILTERS,
} from '@/components/dashboard/filter-bar';
import { SentimentPanel } from '@/components/dashboard/sentiment-panel';
import { DuplicateClusters } from '@/components/dashboard/duplicate-clusters';
import { TimeOfWeekHeatmap } from '@/components/dashboard/time-of-week-heatmap';
import { EscalationWatchlist } from '@/components/dashboard/escalation-watchlist';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';

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
    repliesFetchedAt,
    sentimentFetchedAt,
    duplicatesFetchedAt,
    duplicateClusters,
  } = useDashboardStore();

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [serverMetrics, setServerMetrics] = useState<any>(null);

  // Auto-load sample data on first visit (only client-side, only if empty)
  useEffect(() => {
    initSampleDataIfEmpty();
    // Fetch server-side KPIs
    fetch('/api/dashboard/metrics')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setServerMetrics(data);
      })
      .catch(err => console.error('Failed to load server metrics:', err));
  }, []);

  const uniqueUsers = useMemo(() => {
    if (serverMetrics?.kpis?.uniqueUsers != null) return serverMetrics.kpis.uniqueUsers;
    const set = new Set<string>();
    for (const i of issues) if (i.ownerId) set.add(i.ownerId);
    return set.size;
  }, [issues, serverMetrics]);

  const totalMessages = useMemo(() => {
    if (serverMetrics?.kpis?.totalMessages != null) return serverMetrics.kpis.totalMessages;
    return issues.reduce((sum, i) => sum + (i.totalMessageSent || i.messageCount || 0), 0);
  }, [issues, serverMetrics]);

  const archivedCount = useMemo(() => {
    if (serverMetrics?.kpis?.archivedIssues != null) return serverMetrics.kpis.archivedIssues;
    return issues.filter((i) => i.archived).length;
  }, [issues, serverMetrics]);

  const activeCount = useMemo(() => {
    if (serverMetrics?.kpis) {
      return serverMetrics.kpis.totalIssues - serverMetrics.kpis.archivedIssues;
    }
    return issues.length - archivedCount;
  }, [issues.length, archivedCount, serverMetrics]);

  const archivedPercentText = useMemo(() => {
    if (serverMetrics?.kpis) {
      const total = serverMetrics.kpis.totalIssues;
      return total > 0 ? `${Math.round((serverMetrics.kpis.archivedIssues / total) * 100)}% of total` : '0% of total';
    }
    return issues.length > 0 ? `${Math.round((archivedCount / issues.length) * 100)}% of loaded` : '0% of loaded';
  }, [issues.length, archivedCount, serverMetrics]);

  const avgMsgPerIssue = totalResults > 0 ? Math.round(totalMessages / totalResults) : 0;

  const tagCounts = useMemo(() => issuesByTag(issues), [issues]);

  const weeklyTrends = useMemo(() => calculateWeeklyTrends(issues), [issues]);

  // Response analytics (only meaningful after "Fetch Replies" has been clicked, or if we have server metrics)
  const replyAnalytics = useMemo(() => responseAnalytics(issues), [issues]);
  const hasLocalReplies = replyAnalytics.totalWithReplies > 0;
  const hasServerMetrics = !!serverMetrics?.kpis;
  const hasReplies = hasLocalReplies || hasServerMetrics;
  const hasSentimentData = issues.some((i) => i.sentiment && i.sentiment !== 'unknown');
  const hasDuplicateData = issues.some((i) => !!i.duplicateClusterId);
  const [selectedIssueForDetail, setSelectedIssueForDetail] = useState<Issue | null>(null);

  // Compose legacy tagIds/theme with the unified filter panel
  const effectiveFilters = useMemo<DashboardFilters>(
    () => ({
      ...filters,
      tagIds: selectedTagIds,
      theme: selectedTheme,
      themes,
    }),
    [filters, selectedTagIds, selectedTheme, themes],
  );

  const filteredIssues = useMemo(
    () => filterIssues(issues, effectiveFilters),
    [issues, effectiveFilters],
  );

  const topIssues = useMemo(() => topIssuesByMessages(filteredIssues, 5), [filteredIssues]);

  const isAnalyzing = progress.stage === 'analyzing-themes' || (issues.length > 0 && themes.length === 0);
  const isLoading = issues.length === 0 && progress.stage !== 'idle' && progress.stage !== 'done' && progress.stage !== 'error';

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="flex flex-col items-center gap-6 max-w-sm">
          <div className="relative flex h-14 w-14 items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <img src="/supabase-logo.svg" className="h-7 w-7" alt="Supabase Logo" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)', fontStretch: '85%' }}>
              Loading Dashboard Data
            </h1>
            <p className="agl-eyebrow text-xs">
              {progress.stage.replace(/-/g, ' ')}
            </p>
            {progress.message ? (
              <p className="text-sm text-muted-foreground mt-1">
                {progress.message}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const kpis = serverMetrics?.kpis;
  const resolvedCount = kpis ? kpis.resolvedIssues : replyAnalytics.likelyResolvedCount;
  const totalWithRepliesCount = kpis ? kpis.totalIssues : replyAnalytics.totalWithReplies;
  const answeredCount = kpis ? kpis.answeredIssues : replyAnalytics.answeredCount;
  const unansweredCount = kpis ? (kpis.totalIssues - kpis.answeredIssues) : replyAnalytics.unansweredCount;
  const responseRate = totalWithRepliesCount > 0 ? (answeredCount / totalWithRepliesCount) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface border shrink-0">
                <img src="/supabase-logo.svg" className="h-5 w-5" alt="Supabase Logo" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight truncate" style={{ fontFamily: 'var(--font-display)', fontStretch: '85%' }}>
                  Supabase Community Tracker
                </h1>
                <p className="agl-eyebrow truncate">
                  Channel <span className="font-mono normal-case tracking-normal">{channelId}</span>
                  {source ? ` · source: ${source}` : ''}
                  {lastFetchedAt ? ` · updated ${new Date(lastFetchedAt).toLocaleString()}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <a
                href="https://supabasehire.me"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex h-8 items-center gap-1.5 px-2 rounded-md font-medium hover:text-foreground hover:bg-surface-2 transition-colors"
                title="Devtool — supabasehire.me"
              >
                <Wrench className="size-4" />
                supabasehire.me
              </a>
              <a
                href="https://github.com/JesseVent/supa-agent"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex h-8 items-center gap-1.5 px-2 rounded-md font-medium hover:text-foreground hover:bg-surface-2 transition-colors"
                title="Extension — SupaAgent"
              >
                <Puzzle className="size-4" />
                Extension
              </a>
              <a
                href="https://github.com/JesseVent"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex h-8 w-8 items-center justify-center rounded-md hover:text-foreground hover:bg-surface-2 transition-colors"
                title="GitHub"
              >
                <Github className="size-4" />
              </a>
              <a
                href="https://www.linkedin.com/in/jessevent/"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex h-8 w-8 items-center justify-center rounded-md hover:text-foreground hover:bg-surface-2 transition-colors"
                title="LinkedIn"
              >
                <Linkedin className="size-4" />
              </a>
              <div className="border-l pl-1 ml-1">
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <ConfigPanel />

        {/* KPI cards — Agentic Labs metric strip style */}
        <section className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            title="Total Issues"
            value={kpis?.totalIssues?.toLocaleString() ?? (totalResults > 0 ? totalResults.toLocaleString() : issues.length)}
            subtitle={kpis ? 'server aggregated' : (totalResults > issues.length ? `${issues.length} loaded locally` : 'all loaded')}
            icon={AlertTriangle}
            accent="text-error"
            delta={weeklyTrends.issuesCreated}
          />
          <KpiCard
            title="Unique Users"
            value={uniqueUsers}
            subtitle="distinct reporters"
            icon={Users}
            accent="text-success"
            delta={weeklyTrends.uniqueUsers}
          />
          <KpiCard
            title="Total Messages"
            value={kpis?.totalMessages?.toLocaleString() ?? totalMessages.toLocaleString()}
            subtitle={kpis ? 'server aggregated' : `${avgMsgPerIssue} avg/issue`}
            icon={MessageSquare}
            accent="text-accent"
            delta={weeklyTrends.totalMessages}
          />
          <KpiCard
            title="Active"
            value={activeCount}
            subtitle="not archived"
            icon={Activity}
            accent="text-warning"
            delta={weeklyTrends.activeIssues}
          />
          <KpiCard
            title="Archived"
            value={archivedCount}
            subtitle={archivedPercentText}
            icon={Archive}
            accent="text-pending"
          />
          <KpiCard
            title="Distinct Tags"
            value={tagCounts.length}
            subtitle="forum categories"
            icon={Database}
            accent="text-cat-retrieval"
          />
        </section>

        {/* Response Analytics KPI strip */}
        {hasReplies ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageCircleReply className="h-4 w-4 text-cat-agent" />
              <h2 className="agl-eyebrow">Response Analytics</h2>
              {repliesFetchedAt && !hasServerMetrics ? (
                <span className="text-[10px] text-muted-foreground">
                  · loaded {new Date(repliesFetchedAt).toLocaleTimeString()}
                </span>
              ) : null}
              {hasServerMetrics ? (
                <span className="text-[10px] text-muted-foreground">
                  · server aggregated
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              <KpiCard
                title="Response Rate"
                value={`${Math.round(responseRate * 100)}%`}
                subtitle={`${answeredCount.toLocaleString()} of ${totalWithRepliesCount.toLocaleString()} answered`}
                icon={MessageCircleReply}
                accent="text-cat-agent"
                delta={weeklyTrends.responseRate}
              />
              <KpiCard
                title="Avg Response"
                value={fmtDuration(kpis?.avgResponseTimeMs ?? replyAnalytics.avgResponseTimeMs)}
                subtitle="time to first reply"
                icon={Clock}
                accent="text-cat-chain"
                delta={weeklyTrends.avgResponseTime}
              />
              <KpiCard
                title="Median Response"
                value={fmtDuration(kpis?.medianResponseTimeMs ?? replyAnalytics.medianResponseTimeMs)}
                subtitle={kpis ? 'middle value (server)' : 'client sample (last 1000)'}
                icon={Clock}
                accent="text-cat-retrieval"
              />
              <KpiCard
                title="Fast Responses"
                value={(kpis?.fastResponseCount ?? replyAnalytics.fastResponseCount).toLocaleString()}
                subtitle={kpis ? 'answered < 1h (server)' : 'client sample (last 1000)'}
                icon={Zap}
                accent="text-success"
              />
              <KpiCard
                title="Likely Resolved"
                value={resolvedCount.toLocaleString()}
                subtitle={`${totalWithRepliesCount > 0 ? Math.round((resolvedCount / totalWithRepliesCount) * 100) : 0}% of total`}
                icon={CheckCircle2}
                accent="text-success"
              />
              <KpiCard
                title="Unanswered"
                value={unansweredCount.toLocaleString()}
                subtitle={`${totalWithRepliesCount > 0 ? Math.round((unansweredCount / totalWithRepliesCount) * 100) : 0}% of total`}
                icon={AlertCircle}
                accent="text-error"
                delta={weeklyTrends.unanswered}
              />
            </div>
          </section>
        ) : null}

        {/* Charts row */}
        <section className="grid gap-4 lg:grid-cols-2">
          <IssuesOverTimeChart issues={issues} serverDailyStats={serverMetrics?.dailyStats} />
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

        {/* Response analytics charts row — only shown after replies are loaded */}
        {hasReplies ? (
          <section className="grid gap-4 lg:grid-cols-3">
            <ResponseTimeChart issues={issues} />
            <UnansweredIssues
              issues={issues}
              channelId={channelId}
              onSelectIssue={setSelectedIssueForDetail}
            />
            <TopResponders issues={issues} serverResponders={serverMetrics?.topResponders} />
          </section>
        ) : null}

        {/* Time-of-week heatmap — always shown if there are timestamped issues */}
        <TimeOfWeekHeatmap issues={issues} />

        {/* Sentiment + Duplicates row — shown when sentiment or duplicate data is loaded */}
        {sentimentFetchedAt || duplicatesFetchedAt ? (
          <section className="grid gap-4 lg:grid-cols-2">
            {sentimentFetchedAt ? (
              <SentimentPanel
                issues={issues}
                channelId={channelId}
                onSelectIssue={setSelectedIssueForDetail}
              />
            ) : null}
            {duplicatesFetchedAt ? (
              <DuplicateClusters
                issues={issues}
                clusters={duplicateClusters}
                channelId={channelId}
                onSelectIssue={setSelectedIssueForDetail}
              />
            ) : null}
          </section>
        ) : null}

        {/* Escalation watchlist — shown when replies are loaded */}
        {hasReplies ? (
          <EscalationWatchlist
            issues={issues}
            channelId={channelId}
            onSelectIssue={setSelectedIssueForDetail}
          />
        ) : null}

        {/* Filter bar */}
        <section className="rounded-lg border bg-card p-3">
          <FilterBar
            issues={issues}
            filters={filters}
            onChange={setFilters}
            onClear={() => {
              setFilters(EMPTY_FILTERS);
              setSelectedTagIds([]);
              setSelectedTheme(null);
            }}
            hasSentimentData={hasSentimentData}
            hasDuplicateData={hasDuplicateData}
            hasRepliesLoaded={hasReplies}
            totalLoaded={issues.length}
            filteredCount={filteredIssues.length}
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
                href={threadUrl({ guildId: '839993398554656828', channelId, threadId: issue.id })}
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

        <footer className="mt-8 border-t pt-4 text-center space-y-1.5">
          <p className="agl-eyebrow">
            Supabase Community Tracker · Data via Discord&rsquo;s{' '}
            <code className="font-mono normal-case tracking-normal text-muted-foreground">/threads/search</code>{' '}
            and{' '}
            <code className="font-mono normal-case tracking-normal text-muted-foreground">/post-data</code>{' '}
            APIs · Theme analysis by LLM
          </p>
          <p className="text-[11px] text-muted-foreground">
            <a
              href="https://github.com/JesseVent/discord-dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground font-medium transition-colors"
            >
              GitHub
            </a>
          </p>
        </footer>

        <IssueDetailDialog
          issue={selectedIssueForDetail}
          guildId="839993398554656828"
          channelId={channelId}
          onClose={() => setSelectedIssueForDetail(null)}
        />
      </main>
    </div>
  );
}
