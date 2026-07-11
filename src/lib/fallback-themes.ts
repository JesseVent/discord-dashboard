import type { Issue, ThemeCluster } from './discord-types';

/**
 * Deterministic, keyword-based theme clustering.
 *
 * Used as an instant fallback when LLM analysis is unavailable, skipped, or
 * produces themes that don't fit the community's vocabulary. Users can switch
 * to these via the "Use keyword themes" button in the Config Panel.
 *
 * Rules are evaluated top-to-bottom; an issue is assigned to the FIRST matching
 * theme only. Order matters — more specific rules must come before more general
 * ones (e.g. "RLS / Permissions" before "Database & Connectivity").
 */
const RULES: Array<{ theme: string; keywords: string[]; description: string }> = [
  {
    theme: 'Outage / Service Down',
    keywords: [
      'down', 'outage', '522', '503', '500', '504', '502', '520',
      'all services are down', 'service unavailable', 'unavailable',
      'incident', 'status page', 'supabase down',
    ],
    description: 'Reports of Supabase services being down or returning 5xx errors.',
  },
  {
    theme: 'Network / DNS / Region',
    keywords: [
      'dns', 'nxdomain', 'failed to fetch', 'err_name_not_resolved',
      'routing', 'peering', 'region', 'brazil', 'singapore',
      'cdn', 'cloudflare', 'warp', 'isp', 'latency', 'timeout connecting',
      'network',
    ],
    description: 'DNS, routing, region-specific, or ISP connectivity problems.',
  },
  {
    theme: 'Auth / JWT / OAuth',
    keywords: [
      'auth', 'jwt', 'login', 'logout', 'session', 'token', 'oauth',
      'mfa', '2fa', 'multifactor', 'unauthorized', '401',
      'magic link', 'otp', 'verify email', 'go true', 'gotrue',
    ],
    description: 'Authentication, JWT, OAuth, MFA, session, or login flow issues.',
  },
  {
    theme: 'Database / Connectivity / Timeouts',
    keywords: [
      'database', 'postgres', 'pg_', 'sql', 'pooler', 'connection pool',
      'connection terminated', 'connection timeout', 'pool',
      'slow query', 'hangs', 'hanging', 'psql',
    ],
    description: 'Database connection, pooler, query timeout, or performance issues.',
  },
  {
    theme: 'RLS / Permissions',
    keywords: [
      'rls', 'row level security', 'policy', 'policies', 'permission denied',
      'access denied', 'forbidden', '403', 'role', 'anon', 'authenticated role',
    ],
    description: 'Row-Level Security policy or Postgres permission issues.',
  },
  {
    theme: 'Edge Functions',
    keywords: [
      'edge function', 'edge functions', 'functions', 'deno', 'deploy function',
      'invoke', 'supabase functions', 'serve', 'boot',
    ],
    description: 'Edge Function deployment, invocation, or runtime issues.',
  },
  {
    theme: 'Migrations & Branching',
    keywords: [
      'migration', 'migrations', 'branch', 'branching', 'db pull',
      'supabase db push', 'schema', 'seed', 'reset',
    ],
    description: 'Database migration, schema, or Supabase branching issues.',
  },
  {
    theme: 'Realtime / WebSockets',
    keywords: [
      'realtime', 'websocket', 'websockets', 'subscribe', 'subscription',
      'presence', 'broadcast', 'node.js 20', 'ws package',
    ],
    description: 'Realtime subscriptions, WebSockets, or presence issues.',
  },
  {
    theme: 'Storage',
    keywords: [
      'storage', 'bucket', 'buckets', 's3', 'upload', 'download file',
      'presigned url', 'public url', 'cdn attachment',
    ],
    description: 'Storage buckets, file uploads, or signed URL issues.',
  },
  {
    theme: 'Billing / Plans / Quotas',
    keywords: [
      'quota', 'plan', 'free plan', 'pro plan', 'team plan', 'enterprise',
      'billing', 'invoice', 'limit', 'limits', 'upgrade', 'downgrade',
      'paused', 'unpause', 'pause', 'over quota', 'exceeded',
    ],
    description: 'Plan limits, billing, paused projects, or quota-exceeded errors.',
  },
  {
    theme: 'Dashboard / Access',
    keywords: [
      'dashboard', 'cannot access', "can't access", 'locked out', 'locked out',
      'suspended', 'lockout', 'account suspended', 'sign in', 'sign up',
      'login page', 'reset password', 'forgot password',
    ],
    description: 'Dashboard UI access, account lockout, or login page issues.',
  },
  {
    theme: 'Vectors / AI',
    keywords: [
      'vector', 'vectors', 'embedding', 'embeddings', 'pgvector',
      'openai', 'ai', 'semantic search', 'huggingface',
    ],
    description: 'Vector embeddings, pgvector, or AI/search issues.',
  },
  {
    theme: 'Compliance / Security',
    keywords: [
      'soc2', 'soc 2', 'audit', 'pgaudit', 'compliance', 'hipaa',
      'gdpr', 'vapt', 'security review', 'penetration test', 'pentest',
      'cli_login_postgres', 'role expired',
    ],
    description: 'Compliance audits, security configuration, or role cleanup requests.',
  },
  {
    theme: 'CLI / Tooling',
    keywords: [
      'cli', 'supabase cli', 'npm run', 'bun', 'yarn',
      'typescript', 'ts-node', 'env var', 'environment variable',
    ],
    description: 'Supabase CLI, local dev tooling, or environment configuration issues.',
  },
  {
    theme: 'Integrations / Frameworks',
    keywords: [
      'next.js', 'nextjs', 'nuxt', 'vercel', 'netlify', 'cloudflare workers',
      'react native', 'flutter', 'swift', 'kotlin', 'laravel', 'python',
      'fastapi', 'django', 'remix', 'sveltekit',
    ],
    description: 'Issues integrating Supabase with specific frameworks or platforms.',
  },
];

/**
 * Cluster issues into themes using the keyword rules above.
 * Falls back to an "Other" bucket for anything that doesn't match.
 */
export function fallbackThemes(issues: Issue[]): ThemeCluster[] {
  const buckets: Record<string, string[]> = {};
  for (const rule of RULES) buckets[rule.theme] = [];

  const unmatched: string[] = [];
  for (const issue of issues) {
    const text = `${issue.name} ${issue.firstMessageContent}`.toLowerCase();
    let matched = false;
    for (const rule of RULES) {
      if (rule.keywords.some((k) => text.includes(k.toLowerCase()))) {
        buckets[rule.theme].push(issue.id);
        matched = true;
        break; // assign to first matching rule only
      }
    }
    if (!matched) unmatched.push(issue.id);
  }

  const result: ThemeCluster[] = RULES.map((rule) => ({
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

/**
 * Export the rule list so the UI can show a count of available themes.
 */
export const FALLBACK_THEME_RULES = RULES;
