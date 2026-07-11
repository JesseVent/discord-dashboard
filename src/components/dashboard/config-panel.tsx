'use client';

import { useState, useRef } from 'react';
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
} from 'lucide-react';
import { useDashboardStore } from '@/store/dashboard-store';
import {
  fetchFromDiscord,
  loadSampleData,
  loadFromJsonFile,
  runThemeAnalysis,
} from '@/lib/data-loader';

export function ConfigPanel() {
  const {
    channelId,
    authToken,
    setConfig,
    issues,
    themes,
    source,
    lastFetchedAt,
    progress,
    setIssues,
    setThemes,
    setTotalResults,
    setHasMore,
    setSource,
    setProgress,
    markFetched,
    reset,
  } = useDashboardStore();

  const [open, setOpen] = useState(false);
  const [maxThreads, setMaxThreads] = useState(50);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFetch() {
    setErr(null);
    setBusy(true);
    try {
      setProgress({ stage: 'fetching-threads', fetchedCount: 0, totalResults: 0, message: 'Starting…' });
      const { issues: newIssues, totalResults, hasMore } = await fetchFromDiscord({
        channelId,
        authToken,
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
      const newThemes = await runThemeAnalysis(newIssues);
      setThemes(newThemes);
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
      const newThemes = await runThemeAnalysis(newIssues);
      setThemes(newThemes);
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
      const newThemes = await runThemeAnalysis(newIssues);
      setThemes(newThemes);
      markFetched();
    } catch (err) {
      setErr(err instanceof Error ? err.message : String(err));
      setProgress({ stage: 'error', message: '' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleReanalyzeThemes() {
    if (issues.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      setProgress({ stage: 'analyzing-themes', message: 'Re-analyzing themes with LLM…' });
      const newThemes = await runThemeAnalysis(issues);
      setThemes(newThemes);
      markFetched();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
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
                {lastFetchedAt ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    updated {new Date(lastFetchedAt).toLocaleTimeString()}
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription className="mt-1">
                Pull live from Discord, load sample data, or upload a JSON snapshot.
              </CardDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="channelId" className="text-xs">
                  Discord Channel ID (forum)
                </Label>
                <Input
                  id="channelId"
                  value={channelId}
                  onChange={(e) => setConfig({ channelId: e.target.value })}
                  placeholder="1006358244786196510"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="authToken" className="text-xs">
                  Discord Authorization token
                </Label>
                <Input
                  id="authToken"
                  type="password"
                  value={authToken}
                  onChange={(e) => setConfig({ authToken: e.target.value })}
                  placeholder="Paste your Discord auth token"
                  className="font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  Stored locally in your browser only. Never sent anywhere except Discord.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="maxThreads" className="text-xs">
                Max threads to fetch (25 per page, max 200)
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
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="font-medium capitalize">{progress.stage.replace(/-/g, ' ')}</span>
                  {progress.totalResults > 0 ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {progress.fetchedCount} / {progress.totalResults}
                    </span>
                  ) : null}
                </div>
                {progress.message ? (
                  <p className="mt-1 text-xs text-muted-foreground">{progress.message}</p>
                ) : null}
              </div>
            ) : null}

            {err ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {err}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleFetch} disabled={busy || !authToken} size="sm">
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
              <Button
                onClick={handleReanalyzeThemes}
                disabled={busy || issues.length === 0}
                variant="outline"
                size="sm"
              >
                <Sparkles className="h-4 w-4 mr-1.5" />
                Re-analyze Themes
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
                Themes not yet analyzed. Click “Re-analyze Themes” to run LLM clustering.
              </p>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
