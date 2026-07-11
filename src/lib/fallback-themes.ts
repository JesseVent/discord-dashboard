import type { Issue, ThemeCluster } from './discord-types';

/**
 * Simple keyword-based theme fallback (no LLM call, no SDK import).
 * Safe to import from client or server.
 */
export function fallbackThemes(issues: Issue[]): ThemeCluster[] {
  const rules: Array<{ theme: string; keywords: string[]; description: string }> = [
    { theme: 'Auth & JWT', keywords: ['auth', 'jwt', 'login', 'token', 'session', 'oauth', 'mfa', 'unauthorized'], description: 'Authentication, JWT, session, or login-related issues.' },
    { theme: 'Database & Connectivity', keywords: ['timeout', 'connection', 'database', 'postgres', 'sql', 'down', '522', '503', 'dns', 'failed to fetch'], description: 'Database connection, timeout, or service-down issues.' },
    { theme: 'Edge Functions', keywords: ['edge function', 'function', 'deploy', 'invoke', 'deno'], description: 'Edge Function deployment or invocation issues.' },
    { theme: 'Migrations & Branching', keywords: ['migration', 'branch', 'db pull', 'schema'], description: 'Database migration or branching issues.' },
    { theme: 'Billing & Quotas', keywords: ['quota', 'plan', 'free', 'pro', 'billing', 'limit', 'upgrade', 'paused'], description: 'Plan limits, billing, or paused-project issues.' },
    { theme: 'Dashboard & Access', keywords: ['dashboard', 'access', 'locked out', 'cannot access', 'suspended', 'lockout'], description: 'Dashboard access, account suspension, or login lockout issues.' },
    { theme: 'Compliance & Security', keywords: ['soc2', 'audit', 'pgaudit', 'compliance', 'security', 'vapt', 'role'], description: 'Compliance, audit, or security-configuration requests.' },
    { theme: 'Realtime & Storage', keywords: ['realtime', 'storage', 'bucket', 'upload'], description: 'Realtime subscriptions or Storage issues.' },
  ];

  const buckets: Record<string, string[]> = {};
  for (const rule of rules) buckets[rule.theme] = [];

  const unmatched: string[] = [];
  for (const issue of issues) {
    const text = `${issue.name} ${issue.firstMessageContent}`.toLowerCase();
    let matched = false;
    for (const rule of rules) {
      if (rule.keywords.some((k) => text.includes(k))) {
        buckets[rule.theme].push(issue.id);
        matched = true;
        break; // assign to first matching rule only
      }
    }
    if (!matched) unmatched.push(issue.id);
  }

  const result: ThemeCluster[] = rules
    .map((rule) => ({
      theme: rule.theme,
      description: rule.description,
      keywords: rule.keywords,
      count: buckets[rule.theme].length,
      sampleIssueIds: buckets[rule.theme].slice(0, 5),
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  if (unmatched.length > 0) {
    result.push({
      theme: 'Other',
      description: 'Issues that did not match any keyword rule.',
      keywords: [],
      count: unmatched.length,
      sampleIssueIds: unmatched.slice(0, 5),
    });
  }

  return result;
}
