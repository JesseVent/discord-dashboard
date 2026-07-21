# Discord Dashboard

Turns a Discord **support forum channel** into an issue tracker with analytics. It pulls forum
threads from Discord via the undocumented v9 REST API, normalizes them into `Issue` records, persists
them to Supabase Postgres, and layers on LLM-derived analytics — themes, sentiment, near-duplicate
clusters, and response-time/resolution heuristics. A single-page Next.js dashboard visualizes the
lot, with a scheduled cron keeping the data fresh and a Cloudflare Worker handling duplicate
detection via Vectorize.

![Stack](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-blue) ![Supabase](https://img.shields.io/badge/Supabase-Postgres-green) ![Bun](https://img.shields.io/badge/runtime-bun-fb9e00)

## Features

**KPI strips**
- Volume: total issues, unique reporters, total messages, active vs. archived, distinct forum tags
- Response: response rate, avg / median time-to-first-reply, fast-response count

**Charts**
- Issues over time (daily trend)
- Response-time distribution
- Tag distribution (forum categories)
- Time-of-week heatmap (when issues get filed)

**LLM analytics** (server-side via `z-ai-web-dev-sdk`, deterministic fallbacks if the model is unavailable)
- **Themes** — clustered topic groups with keywords and sample issues
- **Sentiment** — per-issue frustration/neutral/positive/resolved labeling with score
- **Duplicate clusters** — semantic near-duplicates via Cloudflare Vectorize (`bge-base-en-v1.5` embeddings, cosine 0.86 threshold)

**Lists & tables**
- Top contributors (reporters) and top responders (reply authors)
- Escalation watchlist (issues needing attention based on reply state)
- Unanswered issues
- Filterable, sortable issues table with a detail dialog (full thread + replies)

**Config**
- In-app `ConfigPanel` for channel ID + Discord auth token (client-supplied credentials win over env vars; the token never reaches the browser)

## Architecture

```
Discord v9 API ──▶ Next.js API routes ──▶ normalize ──▶ Supabase (discord schema)
                       │                         ▲
                       │                         │
            z-ai LLM analytics          /api/db/{load,sync,sync-incremental}
            (themes/sentiment)                       │
                                                    ▼
                                          Zustand store (localStorage)
                                                    │
                                                    ▼
                                          Single-page dashboard (src/app/page.tsx)

Vercel Cron ──▶ /api/cron/sync ──▶ Discord + Supabase  (hourly ingest)
Cloudflare Cron ─▶ /cluster ──▶ Vectorize ──▶ discord.duplicate_clusters  (daily)
```

**Data pipeline**

1. **Fetch** — `src/lib/discord-api.ts` calls `discord.com/api/v9/channels/:id/threads/search` and `/post-data` with a user-token `authorization` header. Proxied server-side through `src/app/api/discord/*` to avoid CORS and keep the token off the client.
2. **Resolve credentials** — `src/lib/discord-config.ts`: client-supplied values (from `ConfigPanel`) win over `DISCORD_AUTH_TOKEN` / `DISCORD_CHANNEL_ID` env vars. `/api/discord-config` only reports a boolean "is env configured" — never the token.
3. **Normalize** — `normalizeIssue()` maps a raw thread + first message to the app's `Issue` shape (`src/lib/discord-types.ts`).
4. **Orchestrate** — `src/lib/data-loader.ts` paginates `threads/search`, backfills missing first messages, and fetches full thread replies (bounded concurrency) to compute response analytics (first-reply latency, responder count, keyword-based resolution heuristic).
5. **Boot** — `initSampleDataIfEmpty()` hydrates in priority order: localStorage → Supabase (`/api/db/load`) → bundled sample JSON.
6. **Persist** — `/api/db/sync` upserts issues + replaces replies in Supabase via the shared `upsertIssuesAndReplies()` in `src/lib/persist-issues.ts`. Best-effort — the dashboard keeps working from in-memory/localStorage state if it fails.

**Database** — Supabase Postgres, schema `discord`. Tables: `issues`, `replies`, `duplicate_clusters`, `theme_clusters`. Materialized views power the dashboard without client-side aggregation: `dashboard_global_metrics` (KPI rollup), `dashboard_daily_stats` (trend), `top_responders_view`, `dashboard_issues_light` (slim projection for fast loads). `/api/dashboard/metrics` is edge-runtime with `revalidate = 3600`, so KPIs are served from cache and refreshed by the cron — not recomputed per request. PostgREST caps reads at 1000 rows, so bulk loads paginate with `.range()`.

> Prisma/SQLite is a **legacy** layer (`prisma/schema.prisma`, `src/lib/db.ts`) left over from the original stack and no longer wired into the app. Use Supabase migrations + the Supabase MCP for schema changes.

**Cron & duplicate detection**

- `/api/cron/sync` (nodejs, `maxDuration = 60`, `Bearer $CRON_SECRET`-gated) pulls recent active threads, upserts them, and backfills missing replies for up to 10 threads per run. Triggered hourly in production by the Cloudflare Worker.
- `cloudflare-cron/` is a separate Cloudflare Worker (own `package.json`, deploy with `bunx wrangler deploy`). Hourly cron pings the sync endpoint; daily cron (`15 3 * * *`) clusters unclustered issues via Cloudflare Vectorize and writes clusters back over PostgREST.
- Bulk one-shot backfill: `scripts/embed_bulk.py` (sentence-transformers → Vectorize) then `scripts/cluster_bulk.py` (encodes locally, queries Vectorize, writes `duplicate_cluster_id`). See [`cloudflare-cron/README.md`](cloudflare-cron/README.md).

## Setup

Package manager is **bun** (`bun.lock`).

```bash
bun install
bun dev          # next dev -p 3000, logs to dev.log
bun run build    # standalone build (copies .next/static + public into .next/standalone)
bun run start    # NODE_ENV=production bun .next/standalone/server.js
bun run lint     # eslint .
```

There is no test suite configured.

### Environment variables

Copy `.env` and fill in:

| Var | Purpose |
|-----|---------|
| `DISCORD_AUTH_TOKEN` | Discord **user** token (not a bot token) for the v9 API |
| `DISCORD_CHANNEL_ID` | Forum channel ID to track |
| `CRON_SECRET` | Bearer secret gating `/api/cron/sync` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS — server only) |
| `SUPABASE_SCHEMA` | Postgres schema, defaults to `discord` |

Apply DB schema from `supabase/migrations/` (or the Supabase MCP). `DATABASE_URL` is a Prisma leftover and unused.

## Deployment

- `next.config.ts` builds `output: "standalone"` with `typescript.ignoreBuildErrors = true`, `reactStrictMode = false`.
- `Caddyfile` reverse-proxies `:81` → `localhost:3000` (query-param override via `XTransformPort`).
- Production runs on **Vercel** (app + Vercel Cron for ingest + edge metrics) alongside the **Cloudflare Worker** for cron triggers and Vectorize clustering — two separate platforms.

> ⚠️ Never log or persist the Discord auth token or the Supabase service role key client-side. The service role key bypasses RLS.

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS + shadcn/ui · Zustand · Supabase (Postgres) · Prisma (legacy) · Cloudflare Workers + Vectorize · `z-ai-web-dev-sdk` · Recharts · bun