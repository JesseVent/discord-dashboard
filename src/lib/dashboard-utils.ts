import type { Issue, ThemeCluster } from '@/lib/discord-types';

/**
 * Maps Discord tag IDs (from the Supabase help forum) to human-readable names.
 * These IDs were derived from the sample data. Unknown IDs fall back to a short hash.
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

export function tagName(tagId: string): string {
  return KNOWN_TAG_NAMES[tagId] ?? `Tag ${tagId.slice(-4)}`;
}

/**
 * A stable color for a tag ID, derived from a hash.
 */
export function tagColor(tagId: string): string {
  let h = 0;
  for (let i = 0; i < tagId.length; i++) {
    h = (h * 31 + tagId.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 70% 55%)`;
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
 */
export function filterIssues(
  issues: Issue[],
  opts: {
    query?: string;
    tagIds?: string[];
    archivedOnly?: boolean | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    theme?: string | null;
    themes?: ThemeCluster[];
  },
): Issue[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const tagSet = new Set(opts.tagIds ?? []);
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
