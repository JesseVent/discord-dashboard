'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  ChevronUp,
  Settings2,
  RefreshCw,
  Upload,
  Sparkles,
  Database,
  Trash2,
  KeyRound,
  ListChecks,
  ShieldCheck,
  MessageCircleReply,
  Brain,
  Layers,
  Download,
  FileJson,
  FileText,
} from 'lucide-react';
import { useDashboardStore } from '@/store/dashboard-store';
import {
  fetchFromDiscord,
  fetchRepliesForIssues,
  getDiscordEnvConfig,
  loadSampleData,
  loadFromJsonFile,
  persistToDb,
  runThemeAnalysis,
  runSentimentAnalysis,
} from '@/lib/data-loader';
import { exportIssuesToCsv, exportIssuesToJson, exportSummaryToMarkdown } from '@/lib/export-utils';
import { responseAnalytics } from '@/lib/dashboard-utils';
import type { DuplicateClusterData } from '@/components/dashboard/duplicate-clusters';

export function ConfigPanel() {
  const {
    channelId,
    authToken,
    setConfig,
    issues,
    themes,
    themeMethod,
    source,
    lastFetchedAt,
    repliesFetchedAt,
    fetchingReplies,
    replyProgress,
    progress,
    envConfig,
    setEnvConfig,
    setIssues,
    setThemes,
    setTotalResults,
    setHasMore,
    setSource,
    setProgress,
    markFetched,
    setRepliesFetchedAt,
    setFetchingReplies,
    setReplyProgress,
    sentimentFetchedAt,
    analyzingSentiment,
    setSentimentFetchedAt,
    setAnalyzingSentiment,
    duplicatesFetchedAt,
    detectingDuplicates,
    setDuplicatesFetchedAt,
    setDetectingDuplicates,
    duplicateClusters,
    setDuplicateClusters,
    reset,
  } = useDashboardStore();

  const [open, setOpen] = useState(false);
  const [maxThreads, setMaxThreads] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Query server-side env config once on mount
  useEffect(() => {
    getDiscordEnvConfig().then((c) => setEnvConfig(c));
  }, [setEnvConfig]);

  const hasEnvToken = !!envConfig?.hasEnvToken;
  const hasEnvChannel = !!envConfig?.hasEnvChannelId;
  const canFetchFromDiscord = !!authToken || hasEnvToken;
  const usingEnvCreds = !authToken && hasEnvToken;
  const replyAnalytics = responseAnalytics(issues);

  async function handleFetch() {
    setErr(null);
    setBusy(true);
    try {
      setProgress({ stage: 'fetching-threads', fetchedCount: 0, totalResults: 0, message: 'Starting…' });
      // Pass empty strings — server will fall back to env vars
      const { issues: newIssues, totalResults, hasMore } = await fetchFromDiscord({
        channelId: channelId || '',
        authToken: authToken || '',
        maxThreads,
        fetchMissingDetails: true,
        onProgress: (stage, fetched, total, message) => {
          setProgress({ stage: stage as any, fetchedCount: fetched, totalResults: total, message: message ?? '' });
        },
      });
      setIssues(newIssues);
      setTotalResults(totalResults);
      setHasMore(hasMore);
      setSource('discord');

      setProgress({ stage: 'analyzing-themes', message: 'Analyzing themes with LLM…' });
      const newThemes = await runThemeAnalysis(newIssues, 'llm');
      setThemes(newThemes, 'llm');
      // Persist to SQLite so reloads don't need to re-fetch from Discord
      persistToDb({ issues: newIssues, channelId }).catch((err) =>
        console.warn('[handleFetch] persist failed:', err),
      );
      markFetched();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setProgress({ stage: 'error', message: '' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSample() {
    setErr(null);
    setBusy(true);
    try {
      setProgress({ stage: 'fetching-threads', fetchedCount: 0, totalResults: 0, message: 'Loading sample data…' });
      const { issues: newIssues, totalResults, hasMore } = await loadSampleData();
      setIssues(newIssues);
      setTotalResults(totalResults);
      setHasMore(hasMore);
      setSource('sample');

      setProgress({ stage: 'analyzing-themes', message: 'Analyzing themes with LLM…' });
      const newThemes = await runThemeAnalysis(newIssues, 'llm');
      setThemes(newThemes, 'llm');
      // Persist sample data to DB so reloads are instant
      persistToDb({ issues: newIssues, channelId }).catch((err) =>
        console.warn('[handleSample] persist failed:', err),
      );
      markFetched();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setProgress({ stage: 'error', message: '' });
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      setProgress({ stage: 'fetching-threads', fetchedCount: 0, totalResults: 0, message: 'Parsing uploaded JSON…' });
      const { issues: newIssues, totalResults, hasMore } = await loadFromJsonFile(file);
      setIssues(newIssues);
      setTotalResults(totalResults);
      setHasMore(hasMore);
      setSource('upload');

      setProgress({ stage: 'analyzing-themes', message: 'Analyzing themes with LLM…' });
      const newThemes = await runThemeAnalysis(newIssues, 'llm');
      setThemes(newThemes, 'llm');
      // Persist uploaded data to DB
      persistToDb({ issues: newIssues, channelId }).catch((err) =>
        console.warn('[handleUpload] persist failed:', err),
      );
      markFetched();
    } catch (err) {
      setErr(err instanceof Error ? err.message : String(err));
      setProgress({ stage: 'error', message: '' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleReanalyzeLLM() {
    if (issues.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      setProgress({ stage: 'analyzing-themes', message: 'Re-analyzing themes with LLM…' });
      const newThemes = await runThemeAnalysis(issues, 'llm');
      setThemes(newThemes, 'llm');
      markFetched();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReanalyzeFallback() {
    if (issues.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      setProgress({ stage: 'analyzing-themes', message: 'Generating keyword themes…' });
      // Run async so UI can show the spinner briefly
      await new Promise((r) => setTimeout(r, 50));
      const newThemes = await runThemeAnalysis(issues, 'fallback');
      setThemes(newThemes, 'fallback');
      markFetched();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleFetchReplies() {
    if (issues.length === 0) return;
    setErr(null);
    setFetchingReplies(true);
    setReplyProgress({ done: 0, total: issues.length });
    try {
      const updated = await fetchRepliesForIssues({
        issues,
        channelId: channelId || undefined,
        authToken: authToken || undefined,
        maxConcurrency: 6,
        onProgress: (done, total) => setReplyProgress({ done, total }),
      });
      setIssues(updated);
      setRepliesFetchedAt(new Date().toISOString());
      // Persist replies to DB
      persistToDb({ issues: updated, channelId }).catch((err) =>
        console.warn('[handleFetchReplies] persist failed:', err),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingReplies(false);
      setReplyProgress(null);
    }
  }

  async function handleAnalyzeSentiment() {
    if (issues.length === 0) return;
    setErr(null);
    setAnalyzingSentiment(true);
    try {
      const results = await runSentimentAnalysis(issues);
      // Merge sentiment into issues
      const updated = issues.map((issue) => {
        const r = results.get(issue.id);
        if (!r) return issue;
        return {
          ...issue,
          sentiment: r.sentiment,
          sentimentScore: r.score,
          sentimentSummary: r.summary,
        };
      });
      setIssues(updated);
      setSentimentFetchedAt(new Date().toISOString());
      // Persist to DB
      persistToDb({ issues: updated, channelId }).catch((err) =>
        console.warn('[handleAnalyzeSentiment] persist failed:', err),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzingSentiment(false);
    }
  }

  async function handleDetectDuplicates() {
    if (issues.length === 0) return;
    setErr(null);
    setDetectingDuplicates(true);
    try {
      const res = await fetch('/api/detect-duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ issues }),
      });
      if (!res.ok) throw new Error(`detect-duplicates failed: ${res.status}`);
      const data = await res.json();
      const clusters: DuplicateClusterData[] = data.clusters ?? [];
      setDuplicateClusters(clusters);
      setDuplicatesFetchedAt(new Date().toISOString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetectingDuplicates(false);
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="rounded-md">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4" />
                Data Source
                {source ? (
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {source}
                  </Badge>
                ) : null}
                {issues.length > 0 ? (
                  <Badge variant="outline" className="text-[10px]">
                    {issues.length} issues loaded
                  </Badge>
                ) : null}
                {themeMethod ? (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {themeMethod === 'llm' ? <Sparkles className="h-3 w-3 mr-1" /> : <ListChecks className="h-3 w-3 mr-1" />}
                    {themeMethod === 'llm' ? 'LLM themes' : 'keyword themes'}
                  </Badge>
                ) : null}
                {lastFetchedAt ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    updated {new Date(lastFetchedAt).toLocaleTimeString()}
                  </span>
                ) : null}
              </CardTitle>
              {open ? (
                <CardDescription className="mt-1">
                  Pull live from Discord, load sample data, or upload a JSON snapshot.
                </CardDescription>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleFetch} disabled={busy || !canFetchFromDiscord} size="sm">
                <RefreshCw className={`h-4 w-4 mr-1.5 ${busy ? 'animate-spin' : ''}`} />
                Fetch from Discord
              </Button>
              <Button onClick={handleSample} disabled={busy} variant="outline" size="sm">
                <Database className="h-4 w-4 mr-1.5" />
                Load Sample Data
              </Button>
              <Button onClick={() => fileRef.current?.click()} disabled={busy} variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-1.5" />
                Upload JSON
              </Button>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Env-config banner — Agentic Labs Tip callout */}
            {hasEnvToken ? (
              <div className="agl-callout agl-callout-tip">
                <ShieldCheck className="h-4 w-4 mt-0.5 text-success shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-medium text-success text-sm">
                    Server-side token configured
                  </p>
                  <p className="text-xs text-fg">
                    {hasEnvChannel && envConfig?.envChannelId
                      ? `Using DISCORD_CHANNEL_ID=${envConfig.envChannelId} and DISCORD_AUTH_TOKEN from .env — click “Fetch from Discord” without pasting anything.`
                      : 'Using DISCORD_AUTH_TOKEN from .env. Channel ID below will be used.'}
                    {authToken ? (
                      <span className="ml-1 italic">Your pasted token overrides the env value.</span>
                    ) : null}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="channelId" className="text-xs flex items-center gap-1.5">
                  Discord Channel ID (forum)
                  {hasEnvChannel && !channelId ? (
                    <Badge variant="success" className="text-[9px]">from env</Badge>
                  ) : null}
                </Label>
                <Input
                  id="channelId"
                  value={channelId}
                  onChange={(e) => setConfig({ channelId: e.target.value })}
                  placeholder={envConfig?.envChannelId ?? 'e.g. 1006358244786196510'}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="authToken" className="text-xs flex items-center gap-1.5">
                  <KeyRound className="h-3 w-3" />
                  Discord Authorization token
                  {usingEnvCreds ? (
                    <Badge variant="success" className="text-[9px]">from env</Badge>
                  ) : null}
                </Label>
                <Input
                  id="authToken"
                  type="password"
                  value={authToken}
                  onChange={(e) => setConfig({ authToken: e.target.value })}
                  placeholder={hasEnvToken ? '(using env token — leave blank)' : 'Paste your Discord auth token'}
                  className="font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  {hasEnvToken
                    ? 'Optional override. Env var DISCORD_AUTH_TOKEN is used when this is blank.'
                    : 'Stored locally in your browser only. Or set DISCORD_AUTH_TOKEN in .env to skip this.'}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="maxThreads" className="text-xs">
                Max threads to fetch (25 per page, max 200) — higher = more accurate themes
              </Label>
              <Input
                id="maxThreads"
                type="number"
                min={25}
                max={200}
                step={25}
                value={maxThreads}
                onChange={(e) => setMaxThreads(Math.min(200, Math.max(25, Number(e.target.value) || 25)))}
                className="w-32"
              />
            </div>

            {progress.stage !== 'idle' && progress.stage !== 'done' && progress.stage !== 'error' ? (
              <div className="agl-callout agl-callout-note">
                <RefreshCw className="h-4 w-4 mt-0.5 animate-spin text-accent shrink-0" />
                <div className="space-y-0.5">
                  <span className="font-medium text-accent text-sm capitalize font-mono">{progress.stage.replace(/-/g, ' ')}</span>
                  {progress.totalResults > 0 ? (
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums font-mono">
                      {progress.fetchedCount} / {progress.totalResults}
                    </span>
                  ) : null}
                  {progress.message ? (
                    <p className="text-xs text-fg">{progress.message}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {err ? (
              <div className="agl-callout agl-callout-danger">
                <span className="h-4 w-4 mt-0.5 shrink-0 flex items-center justify-center rounded-full bg-error text-white text-[10px] font-bold">!</span>
                <p className="text-sm text-fg">{err}</p>
              </div>
            ) : null}

            {fetchingReplies && replyProgress ? (
              <div className="agl-callout agl-callout-note">
                <MessageCircleReply className="h-4 w-4 mt-0.5 animate-pulse text-accent shrink-0" />
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-accent text-sm font-mono">Fetching replies</span>
                    <span className="text-xs text-muted-foreground tabular-nums font-mono">
                      {replyProgress.done} / {replyProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-accent-soft overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-200"
                      style={{ width: `${replyProgress.total > 0 ? (replyProgress.done / replyProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleReanalyzeLLM}
                disabled={busy || issues.length === 0}
                variant="outline"
                size="sm"
                title="Re-run LLM theme clustering (slower, contextual)"
              >
                <Sparkles className="h-4 w-4 mr-1.5" />
                LLM Themes
              </Button>
              <Button
                onClick={handleReanalyzeFallback}
                disabled={busy || issues.length === 0}
                variant="outline"
                size="sm"
                title="Use deterministic keyword rules (instant, customizable)"
              >
                <ListChecks className="h-4 w-4 mr-1.5" />
                Keyword Themes
              </Button>

              <div className="w-px h-6 bg-border mx-1 self-center" />

              <Button
                onClick={handleFetchReplies}
                disabled={busy || fetchingReplies || issues.length === 0 || !canFetchFromDiscord}
                variant="secondary"
                size="sm"
                title="Fetch all replies for loaded issues — enables response analytics, top responders, unanswered detection"
              >
                <MessageCircleReply className={`h-4 w-4 mr-1.5 ${fetchingReplies ? 'animate-pulse' : ''}`} />
                {fetchingReplies ? 'Fetching Replies…' : 'Fetch Replies'}
              </Button>
              {repliesFetchedAt && !fetchingReplies ? (
                <span className="text-[10px] text-muted-foreground self-center">
                  replies loaded {new Date(repliesFetchedAt).toLocaleTimeString()}
                </span>
              ) : null}

              <div className="w-px h-6 bg-border mx-1 self-center" />

              {/* LLM analysis actions */}
              <Button
                onClick={handleAnalyzeSentiment}
                disabled={busy || analyzingSentiment || issues.length === 0}
                variant="outline"
                size="sm"
                title="LLM scores sentiment (frustrated/neutral/positive/resolved) for each issue"
              >
                <Brain className={`h-4 w-4 mr-1.5 ${analyzingSentiment ? 'animate-pulse' : ''}`} />
                {analyzingSentiment ? 'Scoring…' : 'Sentiment'}
              </Button>
              <Button
                onClick={handleDetectDuplicates}
                disabled={busy || detectingDuplicates || issues.length === 0}
                variant="outline"
                size="sm"
                title="LLM clusters semantically similar issues — spot recurring bugs"
              >
                <Layers className={`h-4 w-4 mr-1.5 ${detectingDuplicates ? 'animate-pulse' : ''}`} />
                {detectingDuplicates ? 'Clustering…' : 'Duplicates'}
              </Button>

              <div className="w-px h-6 bg-border mx-1 self-center" />

              {/* Export actions */}
              <Button
                onClick={() => exportIssuesToCsv(issues)}
                disabled={issues.length === 0}
                variant="ghost"
                size="sm"
                title="Export loaded issues as CSV"
              >
                <Download className="h-4 w-4 mr-1.5" />
                CSV
              </Button>
              <Button
                onClick={() => exportIssuesToJson(issues)}
                disabled={issues.length === 0}
                variant="ghost"
                size="sm"
                title="Export loaded issues (with replies) as JSON"
              >
                <FileJson className="h-4 w-4 mr-1.5" />
                JSON
              </Button>
              <Button
                onClick={() =>
                  exportSummaryToMarkdown({
                    issues,
                    totalResults,
                    channelId,
                    themes: themes.map((t) => ({ theme: t.theme, count: t.count, description: t.description })),
                    responseRate: replyAnalytics?.responseRate,
                    avgResponseTimeMs: replyAnalytics?.avgResponseTimeMs,
                    duplicateClusters,
                  })
                }
                disabled={issues.length === 0}
                variant="ghost"
                size="sm"
                title="Export a summary report as Markdown"
              >
                <FileText className="h-4 w-4 mr-1.5" />
                Report
              </Button>

              {issues.length > 0 ? (
                <Button
                  onClick={() => {
                    if (confirm('Clear all loaded data?')) reset();
                  }}
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear
                </Button>
              ) : null}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleUpload}
              className="hidden"
            />

            {themes.length === 0 && issues.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Themes not yet analyzed. Click <strong>LLM Themes</strong> for contextual clustering
                or <strong>Keyword Themes</strong> for instant deterministic rules.
              </p>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
