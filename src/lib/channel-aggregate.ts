/**
 * Combiners that fold per-channel KPI / daily-stats / responder rows into one
 * combined view. Shared by the `/api/dashboard/metrics` route (which combines
 * the "all channels" aggregate server-side) and the dashboard client (which
 * combines an arbitrary channel subset — e.g. the DataExpert preset — from the
 * per-channel maps the route already ships).
 *
 * ponytail: weighted avg + dominant-channel median; a true cross-channel
 * median / distinct-user count needs a raw query over the issues table, add
 * if subset accuracy matters.
 */

export interface ChannelKpiRow {
  channel_id: string | null;
  total_issues: number;
  answered_issues: number;
  total_messages: number;
  resolved_issues: number;
  avg_response_time_ms: number | null;
  median_response_time_ms: number | null;
  fast_response_count: number;
  unique_users: number;
  archived_issues: number;
}

export interface Kpis {
  totalIssues: number;
  answeredIssues: number;
  totalMessages: number;
  resolvedIssues: number;
  avgResponseTimeMs: number;
  medianResponseTimeMs: number;
  fastResponseCount: number;
  uniqueUsers: number;
  archivedIssues: number;
}

export const ZERO_KPIS: Kpis = {
  totalIssues: 0,
  answeredIssues: 0,
  totalMessages: 0,
  resolvedIssues: 0,
  avgResponseTimeMs: 0,
  medianResponseTimeMs: 0,
  fastResponseCount: 0,
  uniqueUsers: 0,
  archivedIssues: 0,
};

/**
 * Sum per-channel KPI rows into one combined KPI object.
 * avg/median response time are weighted by issue count so the combined value
 * reflects the channel mix rather than a naive mean-of-means.
 */
export function sumKpis(rows: ChannelKpiRow[]): Kpis {
  if (rows.length === 0) return { ...ZERO_KPIS };
  const totalIssues = rows.reduce((s, r) => s + (Number(r.total_issues) || 0), 0);
  const answeredIssues = rows.reduce((s, r) => s + (Number(r.answered_issues) || 0), 0);
  const totalMessages = rows.reduce((s, r) => s + (Number(r.total_messages) || 0), 0);
  const resolvedIssues = rows.reduce((s, r) => s + (Number(r.resolved_issues) || 0), 0);
  const fastResponseCount = rows.reduce((s, r) => s + (Number(r.fast_response_count) || 0), 0);
  const archivedIssues = rows.reduce((s, r) => s + (Number(r.archived_issues) || 0), 0);
  // Sum of distinct users across channels overcounts users active in >1 channel, but each
  // channel's unique_users is itself distinct; a true cross-channel distinct count would need a
  // raw `COUNT(DISTINCT owner_id)` over the issues table. ponytail: sum is a known overcount,
  // upgrade to a distinct query if cross-channel user accuracy matters.
  const uniqueUsers = rows.reduce((s, r) => s + (Number(r.unique_users) || 0), 0);

  // Weighted avg by issue count (rows with no response-time data contribute 0 weight).
  let avgWeight = 0;
  let avgSum = 0;
  for (const r of rows) {
    const w = Number(r.total_issues) || 0;
    const avg = Number(r.avg_response_time_ms) || 0;
    if (w > 0 && avg > 0) { avgWeight += w; avgSum += avg * w; }
  }
  const avgResponseTimeMs = avgWeight > 0 ? avgSum / avgWeight : 0;

  // Median: no faithful cross-channel median from per-channel medians; fall back to the
  // channel with the most issues (dominant), which is the best single proxy.
  const dominant = [...rows].sort((a, b) => (Number(b.total_issues) || 0) - (Number(a.total_issues) || 0))[0];
  const medianResponseTimeMs = Number(dominant?.median_response_time_ms) || 0;

  return {
    totalIssues,
    answeredIssues,
    totalMessages,
    resolvedIssues,
    avgResponseTimeMs,
    medianResponseTimeMs,
    fastResponseCount,
    uniqueUsers,
    archivedIssues,
  };
}

export function rowToKpis(r: ChannelKpiRow): Kpis {
  return {
    totalIssues: Number(r.total_issues) || 0,
    answeredIssues: Number(r.answered_issues) || 0,
    totalMessages: Number(r.total_messages) || 0,
    resolvedIssues: Number(r.resolved_issues) || 0,
    avgResponseTimeMs: Number(r.avg_response_time_ms) || 0,
    medianResponseTimeMs: Number(r.median_response_time_ms) || 0,
    fastResponseCount: Number(r.fast_response_count) || 0,
    uniqueUsers: Number(r.unique_users) || 0,
    archivedIssues: Number(r.archived_issues) || 0,
  };
}

/**
 * Sum a list of already-camelCase `Kpis` objects (the shape stored in the
 * metrics route's `byChannel` map) into one combined KPI object. Same weighting
 * as `sumKpis` but operates on post-`rowToKpis` objects, not raw DB rows.
 */
export function sumKpisList(list: Kpis[]): Kpis {
  if (list.length === 0) return { ...ZERO_KPIS };
  const totalIssues = list.reduce((s, k) => s + (k.totalIssues || 0), 0);
  const answeredIssues = list.reduce((s, k) => s + (k.answeredIssues || 0), 0);
  const totalMessages = list.reduce((s, k) => s + (k.totalMessages || 0), 0);
  const resolvedIssues = list.reduce((s, k) => s + (k.resolvedIssues || 0), 0);
  const fastResponseCount = list.reduce((s, k) => s + (k.fastResponseCount || 0), 0);
  const archivedIssues = list.reduce((s, k) => s + (k.archivedIssues || 0), 0);
  const uniqueUsers = list.reduce((s, k) => s + (k.uniqueUsers || 0), 0);

  let avgWeight = 0;
  let avgSum = 0;
  for (const k of list) {
    if (k.totalIssues > 0 && k.avgResponseTimeMs > 0) {
      avgWeight += k.totalIssues;
      avgSum += k.avgResponseTimeMs * k.totalIssues;
    }
  }
  const avgResponseTimeMs = avgWeight > 0 ? avgSum / avgWeight : 0;
  const dominant = [...list].sort((a, b) => (b.totalIssues || 0) - (a.totalIssues || 0))[0];
  const medianResponseTimeMs = dominant?.medianResponseTimeMs || 0;

  return {
    totalIssues,
    answeredIssues,
    totalMessages,
    resolvedIssues,
    avgResponseTimeMs,
    medianResponseTimeMs,
    fastResponseCount,
    uniqueUsers,
    archivedIssues,
  };
}

export interface DailyStatRow {
  date: string;
  channel_id: string | null;
  issue_count: number;
  total_messages: number;
  answered_count: number;
}

/** Group per-(date,channel) rows by date, summing counts across channels. */
export function combineDailyStats(rows: DailyStatRow[]) {
  const byDate = new Map<string, { date: string; issue_count: number; total_messages: number; answered_count: number }>();
  for (const r of rows) {
    const key = String(r.date);
    const acc = byDate.get(key) ?? { date: key, issue_count: 0, total_messages: 0, answered_count: 0 };
    acc.issue_count += Number(r.issue_count) || 0;
    acc.total_messages += Number(r.total_messages) || 0;
    acc.answered_count += Number(r.answered_count) || 0;
    byDate.set(key, acc);
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface ResponderRow {
  channel_id: string | null;
  author_id: string;
  author_username: string;
  author_global_name: string | null;
  reply_count: number;
  issues_helped: number;
}

/** Group per-(channel,author) rows by author, summing across channels, then take top N. */
export function combineResponders(rows: ResponderRow[], limit = 20) {
  const byAuthor = new Map<string, ResponderRow>();
  for (const r of rows) {
    const acc = byAuthor.get(r.author_id) ?? { ...r, reply_count: 0, issues_helped: 0 };
    acc.reply_count += Number(r.reply_count) || 0;
    acc.issues_helped += Number(r.issues_helped) || 0;
    byAuthor.set(r.author_id, acc);
  }
  return Array.from(byAuthor.values())
    .sort((a, b) => (Number(b.reply_count) || 0) - (Number(a.reply_count) || 0))
    .slice(0, limit);
}