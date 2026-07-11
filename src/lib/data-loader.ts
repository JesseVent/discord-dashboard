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
 *
 * Pass `method: 'fallback'` to skip the LLM call entirely and use the
 * deterministic keyword rules — useful when the user wants instant results
 * or when the LLM themes don't fit their community's vocabulary.
 */
export async function runThemeAnalysis(
  issues: Issue[],
  method: 'llm' | 'fallback' = 'llm',
): Promise<ThemeCluster[]> {
  if (issues.length === 0) return [];

  if (method === 'fallback') {
    return fallbackThemes(issues);
  }

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
 * Check whether the server has DISCORD_AUTH_TOKEN / DISCORD_CHANNEL_ID env vars set.
 * If so, the client can call /api/discord/* without pasting credentials.
 */
export async function getDiscordEnvConfig(): Promise<{
  hasEnvToken: boolean;
  hasEnvChannelId: boolean;
  envChannelId: string | null;
}> {
  try {
    const res = await fetch('/api/discord-config', { cache: 'no-store' });
    if (!res.ok) return { hasEnvToken: false, hasEnvChannelId: false, envChannelId: null };
    return await res.json();
  } catch {
    return { hasEnvToken: false, hasEnvChannelId: false, envChannelId: null };
  }
}

/**
 * Fetch all messages for a single thread (used for reply/response analysis).
 * Returns up to `limit` messages, oldest-first.
 */
export async function fetchThreadMessages(opts: {
  threadId: string;
  channelId?: string;
  authToken?: string;
  limit?: number;
}): Promise<DiscordMessage[]> {
  const { threadId, channelId, authToken, limit = 100 } = opts;
  const params = new URLSearchParams({ threadId, limit: String(limit) });
  if (channelId) params.set('channelId', channelId);
  if (authToken) params.set('authToken', authToken);

  const res = await fetch(`/api/discord/messages?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    console.warn(`[fetchThreadMessages] ${threadId} failed: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return (data.messages ?? []) as DiscordMessage[];
}

/**
 * Fetch replies for ALL loaded issues in parallel (with concurrency limit).
 * Updates each issue with: replies, responseTimeMs, responderCount, isAnswered, resolutionStatus.
 *
 * `maxConcurrency` controls how many threads to fetch simultaneously (default 6).
 * `onProgress` is called after each thread completes.
 */
export async function fetchRepliesForIssues(opts: {
  issues: Issue[];
  channelId?: string;
  authToken?: string;
  maxConcurrency?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<Issue[]> {
  const {
    issues,
    channelId,
    authToken,
    maxConcurrency = 6,
    onProgress,
  } = opts;

  // Only fetch for threads that have >1 message (i.e., they have replies)
  // or where we don't know (message_count missing). Skip 1-message threads — no replies to fetch.
  const toFetch = issues.filter((i) => i.messageCount === undefined || i.messageCount > 1);
  const skipIds = new Set(issues.filter((i) => !toFetch.includes(i)).map((i) => i.id));

  const updated = new Map<string, Issue>();
  for (const issue of issues) {
    if (skipIds.has(issue.id)) {
      // No replies to fetch — mark as unanswered with 0 response time
      updated.set(issue.id, {
        ...issue,
        replies: [],
        responseTimeMs: null,
        responderCount: 0,
        isAnswered: false,
        resolutionStatus: 'unanswered',
      });
    }
  }

  let done = 0;
  const total = toFetch.length;

  // Simple concurrency pool
  const queue = [...toFetch];
  const workers: Promise<void>[] = [];

  async function worker() {
    while (queue.length > 0) {
      const issue = queue.shift();
      if (!issue) break;
      try {
        const messages = await fetchThreadMessages({
          threadId: issue.id,
          channelId,
          authToken,
          limit: 100,
        });
        // Replies = all messages except the first message (matched by id or position)
        const replies = messages.filter((m) => m.id !== issue.firstMessageId);
        updated.set(issue.id, computeResponseAnalytics({ ...issue, replies }));
      } catch (err) {
        console.warn(`[fetchRepliesForIssues] ${issue.id} failed:`, err);
        updated.set(issue.id, {
          ...issue,
          replies: [],
          responseTimeMs: null,
          responderCount: 0,
          isAnswered: false,
          resolutionStatus: 'unknown',
        });
      } finally {
        done += 1;
        onProgress?.(done, total);
      }
    }
  }

  for (let i = 0; i < Math.min(maxConcurrency, toFetch.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Preserve original order
  return issues.map((issue) => updated.get(issue.id) ?? issue);
}

/**
 * Compute response analytics for a single issue given its replies.
 * - responseTimeMs: time from first message to first reply (from a different user)
 * - responderCount: distinct users who replied (excluding the issue creator)
 * - isAnswered: has at least one reply from a different user
 * - resolutionStatus: heuristic detection
 */
export function computeResponseAnalytics(issue: Issue): Issue {
  const replies = issue.replies ?? [];
  const firstMsgTime = issue.firstMessageCreatedAt
    ? new Date(issue.firstMessageCreatedAt).getTime()
    : null;

  // Find first reply from a DIFFERENT user than the issue creator
  const firstReply = replies.find(
    (m) => m.author?.id && m.author.id !== issue.ownerId && m.timestamp,
  );

  let responseTimeMs: number | null = null;
  if (firstReply && firstMsgTime) {
    const replyTime = new Date(firstReply.timestamp).getTime();
    responseTimeMs = Math.max(0, replyTime - firstMsgTime);
  }

  // Distinct responders (excluding issue creator)
  const responderIds = new Set<string>();
  for (const m of replies) {
    if (m.author?.id && m.author.id !== issue.ownerId) {
      responderIds.add(m.author.id);
    }
  }
  const responderCount = responderIds.size;
  const isAnswered = responderCount > 0;

  // Resolution heuristic: scan reply text for resolution keywords
  const resolutionKeywords = [
    'solved', 'fixed', 'resolved', 'thanks', 'thank you', 'that worked',
    'closing this', 'works now', 'got it working', 'appreciate it',
    'marked as resolved', 'issue resolved',
  ];
  const allReplyText = replies
    .map((m) => (m.content ?? '').toLowerCase())
    .join(' \n ');
  const hasResolutionSignal = resolutionKeywords.some((k) => allReplyText.includes(k));

  let resolutionStatus: Issue['resolutionStatus'] = 'unknown';
  if (!isAnswered) {
    resolutionStatus = 'unanswered';
  } else if (hasResolutionSignal) {
    resolutionStatus = 'likely-resolved';
  } else if (replies.length >= 2) {
    resolutionStatus = 'in-progress';
  } else {
    resolutionStatus = 'in-progress';
  }

  return {
    ...issue,
    replies,
    responseTimeMs,
    responderCount,
    isAnswered,
    resolutionStatus,
  };
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
