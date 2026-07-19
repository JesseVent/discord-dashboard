import type { Issue, ThemeCluster } from '@/lib/discord-types';

/**
 * Maps Discord tag IDs (from the Supabase help forum) to human-readable names
 * AND to Agentic Labs category color tokens.
 * Category colors use the trace-category palette (L=60% across hues, equal APCA).
 */
export const KNOWN_TAG_NAMES: Record<string, string> = {
  '1006941128441999421': 'Database',
  '1006941257274241114': 'Auth',
  '1006941275053899887': 'Edge Functions',
  '1006941348454207579': 'Realtime',
  '1006941367353737366': 'Storage',
  '1006941396873257041': 'Migrations',
  '1006941413101015110': 'Dashboard',
  '1050788587593023559': 'Self-Hosting',
  '1200092227200876554': 'Outage / Status',
  '1399429164783898665': 'Branching',
  '1399740852930089150': 'AI / Vectors',
};

/**
 * Maps tag IDs to Agentic Labs category color variable names.
 * Uses the trace-category palette for equal APCA across hues.
 */
export const TAG_CATEGORY_MAP: Record<string, string> = {
  '1006941128441999421': 'chain',      // Database → green
  '1006941257274241114': 'agent',      // Auth → blue
  '1006941275053899887': 'tool',       // Edge Functions → amber
  '1006941348454207579': 'retrieval',  // Realtime → cyan
  '1006941367353737366': 'retrieval',  // Storage → cyan
  '1006941396873257041': 'chain',      // Migrations → green
  '1006941413101015110': 'llm',        // Dashboard → purple
  '1050788587593023559': 'guardrail',  // Self-Hosting → red
  '1200092227200876554': 'guardrail',  // Outage / Status → red
  '1399429164783898665': 'chain',      // Branching → green
  '1399740852930089150': 'llm',        // AI / Vectors → purple
};

export function tagName(tagId: string): string {
  return KNOWN_TAG_NAMES[tagId] ?? `Tag ${tagId.slice(-4)}`;
}

/**
 * Returns the Agentic Labs category color CSS variable for a tag ID.
 * Falls back to a deterministic hash-based OKLCH color for unknown tags.
 */
export function tagColor(tagId: string): string {
  const cat = TAG_CATEGORY_MAP[tagId];
  if (cat) {
    const varMap: Record<string, string> = {
      llm: 'var(--agl-cat-llm)',
      agent: 'var(--agl-cat-agent)',
      tool: 'var(--agl-cat-tool)',
      chain: 'var(--agl-cat-chain)',
      retrieval: 'var(--agl-cat-retrieval)',
      guardrail: 'var(--agl-cat-guardrail)',
    };
    return varMap[cat];
  }
  // Fallback: deterministic OKLCH at L=60%
  let h = 0;
  for (let i = 0; i < tagId.length; i++) {
    h = (h * 31 + tagId.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `oklch(0.60 0.15 ${hue})`;
}

/**
 * Returns the Agentic Labs category soft (background) color for a tag ID.
 */
export function tagColorSoft(tagId: string): string {
  const cat = TAG_CATEGORY_MAP[tagId];
  if (cat) {
    const varMap: Record<string, string> = {
      llm: 'var(--agl-cat-llm-soft)',
      agent: 'var(--agl-cat-agent-soft)',
      tool: 'var(--agl-cat-tool-soft)',
      chain: 'var(--agl-cat-chain-soft)',
      retrieval: 'var(--agl-cat-retrieval-soft)',
      guardrail: 'var(--agl-cat-guardrail-soft)',
    };
    return varMap[cat];
  }
  let h = 0;
  for (let i = 0; i < tagId.length; i++) {
    h = (h * 31 + tagId.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `oklch(0.94 0.035 ${hue})`;
}

/**
 * Format an ISO timestamp as a short date (e.g. "May 14, 2026").
 */
export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format an ISO timestamp as a relative-time string (e.g. "3 days ago").
 */
export function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diff = now - d.getTime();
  const sec = Math.round(diff / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 60) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 30) return `${day}d ago`;
  const month = Math.round(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.round(month / 12)}y ago`;
}

/**
 * Compute a date histogram of issues by day.
 */
export function issuesByDay(issues: Issue[]): Array<{ date: string; count: number }> {
  const map = new Map<string, number>();
  for (const issue of issues) {
    if (!issue.createdAt) continue;
    const d = new Date(issue.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([date, count]) => ({ date, count }));
}

/**
 * Cumulative version of issuesByDay (running total over time).
 */
export function cumulativeIssuesByDay(
  issues: Issue[],
): Array<{ date: string; count: number; cumulative: number }> {
  const daily = issuesByDay(issues);
  let running = 0;
  return daily.map((d) => {
    running += d.count;
    return { ...d, cumulative: running };
  });
}

/**
 * Group issues by tag ID. An issue with multiple tags is counted once per tag.
 */
export function issuesByTag(
  issues: Issue[],
): Array<{ tagId: string; name: string; color: string; count: number }> {
  const map = new Map<string, number>();
  for (const issue of issues) {
    for (const tag of issue.appliedTags) {
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([tagId, count]) => ({
      tagId,
      name: tagName(tagId),
      color: tagColor(tagId),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Return top N issues by message_count (descending).
 */
export function topIssuesByMessages(issues: Issue[], n = 10): Issue[] {
  return [...issues].sort((a, b) => b.messageCount - a.messageCount).slice(0, n);
}

/**
 * Return top N contributors by issue count.
 */
export function topContributors(
  issues: Issue[],
  n = 10,
): Array<{
  ownerId: string;
  username: string;
  globalName: string | null;
  count: number;
  totalMessages: number;
}> {
  const map = new Map<
    string,
    { ownerId: string; username: string; globalName: string | null; count: number; totalMessages: number }
  >();
  for (const issue of issues) {
    const existing = map.get(issue.ownerId);
    if (existing) {
      existing.count += 1;
      existing.totalMessages += issue.messageCount;
    } else {
      map.set(issue.ownerId, {
        ownerId: issue.ownerId,
        username: issue.ownerUsername,
        globalName: issue.ownerGlobalName,
        count: 1,
        totalMessages: issue.messageCount,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * Search/filter issues by keyword.
 *
 * All filter dimensions combine with AND. Empty/missing filters are no-ops.
 */
export function filterIssues(
  issues: Issue[],
  opts: {
    query?: string;
    tagIds?: string[];
    archivedOnly?: boolean | null;
    statuses?: ReadonlySet<Issue['resolutionStatus']> | null;
    sentiments?: ReadonlySet<NonNullable<Issue['sentiment']>> | null;
    hasReplies?: boolean | null;
    minMessageCount?: number | null;
    hasAttachment?: boolean | null;
    duplicateClusterOnly?: boolean | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    theme?: string | null;
    themes?: ThemeCluster[];
  },
): Issue[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const tagSet = new Set(opts.tagIds ?? []);
  const statusSet = opts.statuses ?? null;
  const sentimentSet = opts.sentiments ?? null;
  const minMsgs = opts.minMessageCount ?? null;
  const themeMap = new Map<string, Set<string>>();
  if (opts.theme && opts.themes) {
    for (const t of opts.themes) {
      themeMap.set(t.theme, new Set(t.sampleIssueIds));
    }
  }

  return issues.filter((issue) => {
    if (opts.archivedOnly === true && !issue.archived) return false;
    if (opts.archivedOnly === false && issue.archived) return false;

    if (tagSet.size > 0 && !issue.appliedTags.some((t) => tagSet.has(t))) return false;

    if (statusSet && statusSet.size > 0) {
      const s = issue.resolutionStatus ?? 'unknown';
      if (!statusSet.has(s)) return false;
    }

    if (sentimentSet && sentimentSet.size > 0) {
      const s = issue.sentiment ?? 'unknown';
      if (!sentimentSet.has(s as NonNullable<Issue['sentiment']>)) return false;
    }

    // hasReplies: true → issue.replies loaded AND has > 0 entries;
    //            false → issue.replies loaded AND empty (unanswered);
    //            null → either loaded or not (no filter).
    if (opts.hasReplies === true) {
      if (!issue.replies || issue.replies.length === 0) return false;
    } else if (opts.hasReplies === false) {
      if (issue.replies === undefined) return false; // not loaded yet — don't show under "no replies"
      if (issue.replies.length > 0) return false;
    }

    if (minMsgs != null && (issue.messageCount ?? 0) < minMsgs) return false;

    if (opts.hasAttachment === true && !issue.hasAttachment) return false;
    if (opts.hasAttachment === false && issue.hasAttachment) return false;

    if (opts.duplicateClusterOnly === true && !issue.duplicateClusterId) return false;

    if (opts.dateFrom) {
      const d = new Date(issue.createdAt);
      const from = new Date(opts.dateFrom);
      if (d < from) return false;
    }
    if (opts.dateTo) {
      const d = new Date(issue.createdAt);
      const to = new Date(opts.dateTo);
      to.setHours(23, 59, 59, 999);
      if (d > to) return false;
    }

    if (opts.theme && opts.themes) {
      const t = opts.themes.find((x) => x.theme === opts.theme);
      if (t) {
        // Issue is in this theme if its ID appears in sampleIssueIds (best effort)
        // OR if the issue's content contains any of the theme's keywords
        const inSamples = t.sampleIssueIds.includes(issue.id);
        const keywords = t.keywords.map((k) => k.toLowerCase());
        const text = `${issue.name} ${issue.firstMessageContent}`.toLowerCase();
        const matchesKeyword = keywords.some((k) => k && text.includes(k));
        if (!inSamples && !matchesKeyword) return false;
      }
    }

    if (q) {
      const text = `${issue.name} ${issue.ownerUsername} ${issue.ownerGlobalName ?? ''} ${issue.firstMessageContent}`.toLowerCase();
      if (!text.includes(q)) return false;
    }

    return true;
  });
}

/* ============================================================
   REPLY / RESPONSE ANALYTICS
   ============================================================ */

/**
 * Format a duration in milliseconds as a human-readable string.
 * e.g. "3m", "2h 15m", "1d 4h", "45s"
 */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${day}d ${remHr}h` : `${day}d`;
}

/**
 * Aggregate response analytics across all issues.
 * Only counts issues where replies have been fetched (issue.replies !== undefined).
 */
export function responseAnalytics(issues: Issue[]): {
  totalWithReplies: number;
  answeredCount: number;
  unansweredCount: number;
  responseRate: number; // 0-1
  avgResponseTimeMs: number | null;
  medianResponseTimeMs: number | null;
  fastResponseCount: number; // responded within 1h
  likelyResolvedCount: number;
  inProgressCount: number;
  totalReplies: number;
  avgRepliesPerIssue: number;
} {
  const withReplies = issues.filter((i) => i.replies !== undefined);
  const totalWithReplies = withReplies.length;
  if (totalWithReplies === 0) {
    return {
      totalWithReplies: 0,
      answeredCount: 0,
      unansweredCount: 0,
      responseRate: 0,
      avgResponseTimeMs: null,
      medianResponseTimeMs: null,
      fastResponseCount: 0,
      likelyResolvedCount: 0,
      inProgressCount: 0,
      totalReplies: 0,
      avgRepliesPerIssue: 0,
    };
  }

  const answered = withReplies.filter((i) => i.isAnswered);
  const unanswered = withReplies.filter((i) => !i.isAnswered);
  const responseTimes = answered
    .map((i) => i.responseTimeMs)
    .filter((v): v is number => v !== null && v !== undefined && v > 0)
    .sort((a, b) => a - b);

  const sumResponseTime = responseTimes.reduce((s, v) => s + v, 0);
  const avgResponseTimeMs = responseTimes.length > 0 ? sumResponseTime / responseTimes.length : null;
  const medianResponseTimeMs =
    responseTimes.length > 0
      ? responseTimes[Math.floor(responseTimes.length / 2)]
      : null;

  const fastResponseCount = responseTimes.filter((ms) => ms <= 60 * 60 * 1000).length;
  const likelyResolvedCount = withReplies.filter((i) => i.resolutionStatus === 'likely-resolved').length;
  const inProgressCount = withReplies.filter((i) => i.resolutionStatus === 'in-progress').length;
  const totalReplies = withReplies.reduce((s, i) => s + (i.replies?.length ?? 0), 0);

  return {
    totalWithReplies,
    answeredCount: answered.length,
    unansweredCount: unanswered.length,
    responseRate: answered.length / totalWithReplies,
    avgResponseTimeMs,
    medianResponseTimeMs,
    fastResponseCount,
    likelyResolvedCount,
    inProgressCount,
    totalReplies,
    avgRepliesPerIssue: totalReplies / totalWithReplies,
  };
}

/**
 * Top N responders — users who reply to issues (excluding issue creators).
 * Different from topContributors which counts issue creators.
 */
export function topResponders(
  issues: Issue[],
  n = 10,
): Array<{
  userId: string;
  username: string;
  globalName: string | null;
  replyCount: number;
  issuesHelped: number;
}> {
  const map = new Map<
    string,
    {
      userId: string;
      username: string;
      globalName: string | null;
      replyCount: number;
      issuesHelped: Set<string>;
    }
  >();

  for (const issue of issues) {
    const replies = issue.replies ?? [];
    for (const reply of replies) {
      const author = reply.author;
      if (!author?.id || author.id === issue.ownerId) continue; // skip issue creator
      const existing = map.get(author.id);
      if (existing) {
        existing.replyCount += 1;
        existing.issuesHelped.add(issue.id);
      } else {
        map.set(author.id, {
          userId: author.id,
          username: author.username ?? 'unknown',
          globalName: author.global_name ?? author.username ?? null,
          replyCount: 1,
          issuesHelped: new Set([issue.id]),
        });
      }
    }
  }

  return Array.from(map.values())
    .map((r) => ({
      userId: r.userId,
      username: r.username,
      globalName: r.globalName,
      replyCount: r.replyCount,
      issuesHelped: r.issuesHelped.size,
    }))
    .sort((a, b) => b.replyCount - a.replyCount)
    .slice(0, n);
}

/**
 * Return issues that are unanswered (no replies from other users),
 * sorted by age (oldest first).
 */
export function unansweredIssues(
  issues: Issue[],
  n = 10,
  sortBy: 'newest' | 'oldest' = 'newest'
): Issue[] {
  return issues
    .filter((i) => i.replies !== undefined && !i.isAnswered)
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return sortBy === 'newest' ? bTime - aTime : aTime - bTime;
    })
    .slice(0, n);
}

/**
 * Response time distribution histogram (buckets).
 * Returns counts per bucket for charting.
 */
export function responseTimeDistribution(
  issues: Issue[],
): Array<{ bucket: string; count: number; bucketMs: number }> {
  const buckets = [
    { label: '< 1h', maxMs: 60 * 60 * 1000 },
    { label: '1–6h', maxMs: 6 * 60 * 60 * 1000 },
    { label: '6–24h', maxMs: 24 * 60 * 60 * 1000 },
    { label: '1–3d', maxMs: 3 * 24 * 60 * 60 * 1000 },
    { label: '3–7d', maxMs: 7 * 24 * 60 * 60 * 1000 },
    { label: '> 7d', maxMs: Infinity },
  ];

  const counts = buckets.map((b) => ({ bucket: b.label, count: 0, bucketMs: b.maxMs }));
  for (const issue of issues) {
    if (issue.responseTimeMs === null || issue.responseTimeMs === undefined) continue;
    for (let i = 0; i < buckets.length; i++) {
      if (issue.responseTimeMs <= buckets[i].maxMs) {
        counts[i].count += 1;
        break;
      }
    }
  }
  return counts;
}

/**
 * Resolution status badge variant for a given resolution status.
 */
export function resolutionBadgeVariant(
  status: Issue['resolutionStatus'],
): 'success' | 'warning' | 'error' | 'secondary' {
  switch (status) {
    case 'likely-resolved':
      return 'success';
    case 'in-progress':
      return 'warning';
    case 'unanswered':
      return 'error';
    default:
      return 'secondary';
  }
}

/**
 * Human-readable label for a resolution status.
 */
export function resolutionLabel(status: Issue['resolutionStatus']): string {
  switch (status) {
    case 'likely-resolved':
      return 'Likely Resolved';
    case 'in-progress':
      return 'In Progress';
    case 'unanswered':
      return 'Unanswered';
    default:
      return 'Unknown';
  }
}

export interface WeeklyTrend {
  value: string;
  direction: 'up' | 'down' | 'neutral';
  status: 'success' | 'error' | 'neutral';
}

export interface WeeklyTrends {
  issuesCreated: WeeklyTrend;
  uniqueUsers: WeeklyTrend;
  totalMessages: WeeklyTrend;
  activeIssues: WeeklyTrend;
  responseRate: WeeklyTrend;
  avgResponseTime: WeeklyTrend;
  unanswered: WeeklyTrend;
}

export function calculateWeeklyTrends(issues: Issue[]): WeeklyTrends {
  const issueTimes = issues
    .map((i) => (i.createdAt ? new Date(i.createdAt).getTime() : 0))
    .filter((t) => t > 0);
  const maxTime = issueTimes.length > 0 ? Math.max(...issueTimes) : Date.now();

  const oneDay = 24 * 60 * 60 * 1000;
  const currentStart = maxTime - 7 * oneDay;
  const previousStart = maxTime - 14 * oneDay;

  const currentIssues = issues.filter((i) => {
    const t = i.createdAt ? new Date(i.createdAt).getTime() : 0;
    return t >= currentStart && t <= maxTime;
  });

  const previousIssues = issues.filter((i) => {
    const t = i.createdAt ? new Date(i.createdAt).getTime() : 0;
    return t >= previousStart && t < currentStart;
  });

  const getDelta = (curr: number, prev: number, higherIsBetter = true) => {
    if (prev === 0 && curr === 0) {
      return { value: '0%', direction: 'neutral' as const, status: 'neutral' as const };
    }
    if (prev === 0) {
      return {
        value: `+${curr}`,
        direction: 'up' as const,
        status: higherIsBetter ? ('success' as const) : ('error' as const),
      };
    }
    const pct = ((curr - prev) / prev) * 100;
    const absPct = Math.abs(pct).toFixed(0);
    const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
    const direction = pct > 0 ? ('up' as const) : pct < 0 ? ('down' as const) : ('neutral' as const);
    
    let status: 'success' | 'error' | 'neutral' = 'neutral';
    if (pct > 0) {
      status = higherIsBetter ? 'success' : 'error';
    } else if (pct < 0) {
      status = higherIsBetter ? 'error' : 'success';
    }
    
    return {
      value: `${sign}${absPct}%`,
      direction,
      status,
    };
  };

  // 1. Issues Created
  const issuesCreated = getDelta(currentIssues.length, previousIssues.length, true);

  // 2. Unique Users (distinct ownerIds)
  const currUsers = new Set(currentIssues.map((i) => i.ownerId).filter(Boolean)).size;
  const prevUsers = new Set(previousIssues.map((i) => i.ownerId).filter(Boolean)).size;
  const uniqueUsers = getDelta(currUsers, prevUsers, true);

  // 3. Total Messages
  const currMsgs = currentIssues.reduce((sum, i) => sum + (i.messageCount || 0), 0);
  const prevMsgs = previousIssues.reduce((sum, i) => sum + (i.messageCount || 0), 0);
  const totalMessages = getDelta(currMsgs, prevMsgs, true);

  // 4. Active Issues
  const currActive = currentIssues.filter((i) => !i.archived).length;
  const prevActive = previousIssues.filter((i) => !i.archived).length;
  const activeIssues = getDelta(currActive, prevActive, true);

  // 5. Response Rate
  const currRRCount = currentIssues.filter((i) => i.replies !== undefined).length;
  const currRRAny = currentIssues.filter((i) => i.replies !== undefined && i.isAnswered).length;
  const prevRRCount = previousIssues.filter((i) => i.replies !== undefined).length;
  const prevRRAny = previousIssues.filter((i) => i.replies !== undefined && i.isAnswered).length;

  let responseRate: WeeklyTrend;
  if (currRRCount === 0 || prevRRCount === 0) {
    responseRate = { value: '0%', direction: 'neutral', status: 'neutral' };
  } else {
    const currRate = (currRRAny / currRRCount) * 100;
    const prevRate = (prevRRAny / prevRRCount) * 100;
    const diff = currRate - prevRate;
    const absDiff = Math.abs(diff).toFixed(0);
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    responseRate = {
      value: `${sign}${absDiff}%`,
      direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral',
      status: diff > 0 ? 'success' : diff < 0 ? 'error' : 'neutral',
    };
  }

  // 6. Avg Response Time
  const currTimes = currentIssues.map((i) => i.responseTimeMs).filter((t) => t != null && t > 0) as number[];
  const prevTimes = previousIssues.map((i) => i.responseTimeMs).filter((t) => t != null && t > 0) as number[];
  const currAvg = currTimes.length > 0 ? currTimes.reduce((a, b) => a + b, 0) / currTimes.length : 0;
  const prevAvg = prevTimes.length > 0 ? prevTimes.reduce((a, b) => a + b, 0) / prevTimes.length : 0;
  const avgResponseTime = getDelta(currAvg, prevAvg, false);

  // 7. Unanswered
  const currUnanswered = currentIssues.filter((i) => i.replies !== undefined && !i.isAnswered).length;
  const prevUnanswered = previousIssues.filter((i) => i.replies !== undefined && !i.isAnswered).length;
  const unanswered = getDelta(currUnanswered, prevUnanswered, false);

  return {
    issuesCreated,
    uniqueUsers,
    totalMessages,
    activeIssues,
    responseRate,
    avgResponseTime,
    unanswered,
  };
}
