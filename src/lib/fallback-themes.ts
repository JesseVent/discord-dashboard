import type { Issue, ThemeCluster } from './discord-types';
import { DATAEXPERT_CHANNEL_IDS, DATAEXPERT_FILTER } from './discord-types';

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
type Rule = { theme: string; keywords: string[]; description: string };

// Default rule set — Supabase community forum. Used when no channel-specific
// set matches (including the Supabase channel id below).
const SUPABASE_RULES: Rule[] = [
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

// DataExpert.io "questions" forum — data engineering / Databricks community.
// Specific rules first; the generic "SQL / Queries" catch-all sits late so
// Databricks/Spark/dbt specifics win over a plain "sql" mention.
const DATAEXPERT_RULES: Rule[] = [
  {
    theme: 'Databricks Platform / Workspace',
    keywords: [
      'databricks', 'workspace', 'databricks sql', 'db sql', 'sql warehouse',
      'all-purpose cluster', 'compute', 'cluster', 'driver', 'worker node',
      'databricks ui', 'notebook', 'notebooks', 'repos', 'databricks connect',
    ],
    description: 'Databricks workspace, clusters, notebooks, or platform access issues.',
  },
  {
    theme: 'Spark / PySpark',
    keywords: [
      'spark', 'pyspark', 'spark sql', 'dataframe', 'rdd', 'spark session',
      'spark job', 'shuffle', 'catalyst', 'spark ui', 'executor', 'oom',
      'out of memory', 'spark.driver', 'spark.executor',
    ],
    description: 'Apache Spark / PySpark job, DataFrame, or runtime issues.',
  },
  {
    theme: 'Delta Lake / Lakehouse',
    keywords: [
      'delta', 'delta lake', 'delta table', 'merge into', 'optimize', 'z-order',
      'vacuum', 'time travel', 'lakehouse', 'liquid clustering',
      'delta live tables', 'dlt', 'pipelines', 'flow log',
    ],
    description: 'Delta Lake format, Lakehouse, or Delta Live Tables issues.',
  },
  {
    theme: 'Unity Catalog / Governance',
    keywords: [
      'unity catalog', 'catalog', 'metastore', 'grant', 'privilege', 'permissions',
      'external location', 'storage credential', 'data governance', 'lineage',
      'audit log', 'credential',
    ],
    description: 'Unity Catalog, metastore, grants, or data governance issues.',
  },
  {
    theme: 'Orchestration / Scheduling',
    keywords: [
      'airflow', 'dag', 'dags', 'airflow operator', 'prefect', 'dagster',
      'databricks jobs', 'job cluster', 'job run', 'schedule', 'trigger',
      'task', 'workflow', 'cron',
    ],
    description: 'Airflow, Databricks Jobs, or pipeline scheduling/orchestration issues.',
  },
  {
    theme: 'dbt / Modeling',
    keywords: [
      'dbt', 'dbt core', 'dbt cloud', 'model', 'models', 'materialization',
      'snapshot', 'staging', 'marts', 'seed', 'dbt project', 'jinjas',
      'ref(', 'source(', 'incremental',
    ],
    description: 'dbt project, models, materialization, or transformation issues.',
  },
  {
    theme: 'Streaming / Kafka',
    keywords: [
      'kafka', 'topic', 'consumer', 'producer', 'kafka connect',
      'autoloader', 'auto loader', 'structured streaming', 'streaming',
      'checkpoint', 'offset', 'kinesis', 'pubsub', 'eventhub',
    ],
    description: 'Kafka, Structured Streaming, Auto Loader, or streaming ingest issues.',
  },
  {
    theme: 'Data Ingestion / ETL',
    keywords: [
      'ingest', 'ingestion', 'etl', 'elt', 'pipeline', 'load', 'loading',
      'extract', 'copy into', 'autoloader', 'data load', 'batch', 's3',
      'adls', 'blob storage', 'data lake', 'parquet', 'csv', 'json file',
    ],
    description: 'ETL/ELT pipelines, data loading, or file-format ingest issues.',
  },
  {
    theme: 'SQL / Queries',
    keywords: [
      'sql', 'query', 'queries', 'select', 'join', 'group by', 'window function',
      'cte', 'subquery', 'nested query', 'sql error', 'syntax error',
      'slow query', 'query performance', 'analytic function',
    ],
    description: 'SQL query writing, syntax, or performance issues.',
  },
  {
    theme: 'Python / Pandas',
    keywords: [
      'python', 'pandas', 'pandas dataframe', 'numpy', 'pyspark pandas',
      'koalas', 'venv', 'pip install', 'import error', 'module not found',
      'pandas api', 'apply(', 'dataframe schema',
    ],
    description: 'Python, Pandas, or library/environment issues in data workflows.',
  },
  {
    theme: 'Performance / Cost',
    keywords: [
      'performance', 'slow', 'runtime', 'cost', 'expensive', 'dbu', 'pricing',
      'optimize cost', 'photon', 'caching', 'cache', 'persist(', 'broadcast',
      'skew', 'data skew', 'memory', 'heap',
    ],
    description: 'Job performance, runtime cost (DBUs), or optimization issues.',
  },
  {
    theme: 'Authentication / Access',
    keywords: [
      'auth', 'login', 'sso', 'saml', 'scim', 'token', 'pat', 'personal access token',
      'service principal', 'secret', 'key vault', 'databricks cli', 'unauthorized',
      '403', '401', 'permission',
    ],
    description: 'Authentication, SSO, tokens, or workspace access issues.',
  },
  {
    theme: 'Cloud / Infra Integration',
    keywords: [
      'aws', 's3', 'iam', 'role', 'azure', 'adls', 'gcp', 'gs bucket',
      'terraform', 'databricks terraform', 'vpc', 'peering', 'private link',
      'network', 'security group', 'bucket policy',
    ],
    description: 'Cloud provider integration, IAM, networking, or IaC issues.',
  },
  {
    theme: 'ML / Feature Engineering',
    keywords: [
      'feature store', 'feature engineering', 'mlflow', 'model', 'model registry',
      'training', 'inference', 'serving', 'sklearn', 'scikit', 'xgboost',
      'tensorflow', 'pytorch', 'spark ml', 'mllib', 'vector search',
    ],
    description: 'MLflow, feature stores, model training/serving, or ML issues.',
  },
  {
    theme: 'Certification / Learning',
    keywords: [
      'certification', 'exam', 'cert', 'bootcamp', 'course', 'tutorial',
      'learn', 'learning', 'study', 'practice', 'question about', 'how do i',
      'interview', 'career',
    ],
    description: 'Certification prep, course/bootcamp questions, or learning guidance.',
  },
];

// Channel id → rule set. Channel ids live in CHANNEL_LABELS (discord-types).
// All four DataExpert bootcamp channels share the data-engineering theme set
// (questions, study-group, faq, general). Unknown / 'all' / Supabase falls
// back to SUPABASE_RULES. The `dataexpert` filter sentinel also uses the
// DataExpert rule set so the combined view themes match.
const CHANNEL_RULES: Record<string, Rule[]> = {
  [DATAEXPERT_FILTER]: DATAEXPERT_RULES,
  ...Object.fromEntries(DATAEXPERT_CHANNEL_IDS.map((id) => [id, DATAEXPERT_RULES])),
};

function rulesForChannel(channelId?: string): Rule[] {
  return (channelId && CHANNEL_RULES[channelId]) || SUPABASE_RULES;
}

/**
 * Cluster issues into themes using the keyword rules above.
 * Falls back to an "Other" bucket for anything that doesn't match.
 *
 * When `channelId` is supplied, the channel-specific rule set is used
 * (e.g. DataExpert data-engineering themes vs the default Supabase set).
 */
export function fallbackThemes(issues: Issue[], channelId?: string): ThemeCluster[] {
  const RULES = rulesForChannel(channelId);
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
 * Export the default rule list so the UI can show a count of available themes.
 */
export const FALLBACK_THEME_RULES = SUPABASE_RULES;
