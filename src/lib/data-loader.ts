'use client';

import type { DiscordMessage, Issue, ThemeCluster } from '@/lib/discord-types';
import { normalizeIssue } from '@/lib/discord-api';
import { fallbackThemes } from '@/lib/fallback-themes';
import { useDashboardStore } from '@/store/dashboard-store';

/**
 * Load sample data from /sample-data/search-discord-sample.json
 * (a snapshot of the user's Discord threads/search response)
 */
export async function loadSampleData(): Promise<{
  issues: Issue[];
  totalResults: number;
  hasMore: boolean;
}> {
  const res = await fetch('/sample-data/search-discord-sample.json');
  if (!res.ok) throw new Error(`Failed to load sample data: ${res.status}`);
  const data = await res.json();

  // Build a lookup of first_messages by channel_id
  const firstMessages = new Map<string, DiscordMessage>();
  for (const fm of data.first_messages ?? []) {
    if (fm?.channel_id) firstMessages.set(fm.channel_id, fm);
  }

  const issues: Issue[] = (data.threads ?? []).map((t: any) =>
    normalizeIssue(t, firstMessages.get(t.id)),
  );

  return {
    issues,
    totalResults: data.total_results ?? issues.length,
    hasMore: data.has_more ?? false,
  };
}

/**
 * Load data from an uploaded JSON file (drag-drop or file picker).
 * Accepts either a threads/search response or a post-data response.
 */
export async function loadFromJsonFile(file: File): Promise<{
  issues: Issue[];
  totalResults: number;
  hasMore: boolean;
}> {
  const text = await file.text();
  const data = JSON.parse(text);

  // Build first_messages map (could be array or post-data object form)
  const firstMessages = new Map<string, DiscordMessage>();
  if (Array.isArray(data.first_messages)) {
    for (const fm of data.first_messages) {
      if (fm?.channel_id) firstMessages.set(fm.channel_id, fm);
    }
  } else if (data.threads && typeof data.threads === 'object' && !Array.isArray(data.threads)) {
    // post-data response shape: { threads: { [id]: { first_message, owner } } }
    for (const [tid, info] of Object.entries<any>(data.threads)) {
      if (info?.first_message) firstMessages.set(tid, info.first_message);
    }
  }

  let threads: any[] = [];
  if (Array.isArray(data.threads)) {
    threads = data.threads;
  }

  const issues: Issue[] = threads.map((t: any) =>
    normalizeIssue(t, firstMessages.get(t.id)),
  );

  return {
    issues,
    totalResults: data.total_results ?? issues.length,
    hasMore: data.has_more ?? false,
  };
}

/**
 * Fetch fresh data from Discord via the local API proxy.
 * Paginates through threads/search, then optionally fetches missing first_messages
 * via post-data.
 */
export async function fetchFromDiscord(opts: {
  channelId: string;
  authToken: string;
  maxThreads?: number;
  fetchMissingDetails?: boolean;
  onProgress?: (stage: string, fetched: number, total: number, message?: string) => void;
}): Promise<{
  issues: Issue[];
  totalResults: number;
  hasMore: boolean;
}> {
  const { channelId, authToken, maxThreads = 100, fetchMissingDetails = true, onProgress } = opts;
  const pageSize = 25;

  const allThreads: any[] = [];
  const firstMessages = new Map<string, DiscordMessage>();
  let totalResults = 0;
  let hasMore = false;
  let offset = 0;

  // 1) paginate threads/search
  while (true) {
    onProgress?.('fetching-threads', allThreads.length, totalResults, `Fetching threads (offset ${offset})…`);
    const res = await fetch('/api/discord/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelId, authToken, archived: true, limit: pageSize, offset }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `Discord search failed: ${res.status}`);
    }
    const page = await res.json();
    totalResults = page.total_results ?? totalResults;
    hasMore = page.has_more ?? false;
    for (const t of page.threads ?? []) allThreads.push(t);
    for (const fm of page.first_messages ?? []) {
      if (fm?.channel_id) firstMessages.set(fm.channel_id, fm);
    }
    onProgress?.('fetching-threads', allThreads.length, totalResults);
    if (!page.has_more) break;
    if (allThreads.length >= maxThreads) break;
    offset += pageSize;
  }

  // 2) fetch missing first_messages via post-data (10 IDs per call)
  if (fetchMissingDetails) {
    const missing = allThreads
      .filter((t) => !firstMessages.has(t.id))
      .map((t) => t.id);
    const BATCH = 10;
    onProgress?.('fetching-details', 0, missing.length, 'Fetching message details…');
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const res = await fetch('/api/discord/post-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId, authToken, threadIds: batch }),
      });
      if (res.ok) {
        const data = await res.json();
        for (const [tid, info] of Object.entries<any>(data.threads ?? {})) {
          if (info?.first_message) firstMessages.set(tid, info.first_message);
        }
      }
      onProgress?.('fetching-details', Math.min(i + BATCH, missing.length), missing.length);
    }
  }

  const issues: Issue[] = allThreads.map((t: any) =>
    normalizeIssue(t, firstMessages.get(t.id)),
  );

  return { issues, totalResults, hasMore };
}

/**
 * Run LLM theme analysis on the current issues, with a keyword-based fallback
 * if the LLM call fails.
 */
export async function runThemeAnalysis(issues: Issue[]): Promise<ThemeCluster[]> {
  if (issues.length === 0) return [];
  try {
    const res = await fetch('/api/analyze-themes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issues }),
    });
    if (!res.ok) throw new Error(`analyze-themes failed: ${res.status}`);
    const data = await res.json();
    const themes: ThemeCluster[] = data.themes ?? [];
    if (themes.length > 0) return themes;
    // fall through to fallback
  } catch (err) {
    console.warn('[runThemeAnalysis] LLM failed, using fallback:', err);
  }
  return fallbackThemes(issues);
}

/**
 * Convenience: load sample data into the store on first visit.
 */
export async function initSampleDataIfEmpty() {
  const store = useDashboardStore.getState();
  if (store.issues.length > 0) return;
  try {
    store.setProgress({ stage: 'fetching-threads', fetchedCount: 0, totalResults: 0, message: 'Loading sample data…' });
    const { issues, totalResults, hasMore } = await loadSampleData();
    store.setIssues(issues);
    store.setTotalResults(totalResults);
    store.setHasMore(hasMore);
    store.setSource('sample');
    store.setProgress({ stage: 'analyzing-themes', message: 'Analyzing themes…' });
    const themes = await runThemeAnalysis(issues);
    store.setThemes(themes);
    store.markFetched();
  } catch (err) {
    console.error('[initSampleDataIfEmpty]', err);
    store.setProgress({ stage: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}
