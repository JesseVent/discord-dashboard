# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **bun** (`bun.lock` is the only lockfile).

```bash
bun install          # install deps
bun dev               # next dev -p 3000, logs to dev.log
bun run build         # next build, then copies static/public into .next/standalone
bun run start         # runs the standalone build (NODE_ENV=production), logs to server.log
bun run lint          # eslint .

bun run db:push       # prisma db push — VESTIGIAL (see Database: Prisma is legacy)
bun run db:generate   # prisma generate — VESTIGIAL
bun run db:migrate    # prisma migrate dev — VESTIGIAL
bun run db:reset      # prisma migrate reset — VESTIGIAL
```

The real DB is Supabase Postgres — apply schema changes via `supabase/migrations/` + the Supabase MCP, not Prisma.

There is no test suite / test runner configured in this repo.

## Architecture

This is a single-page dashboard (`src/app/page.tsx`) that turns a Discord support forum channel into an
issue tracker: it pulls forum threads from Discord, normalizes them into `Issue` records, and layers on
LLM-derived analytics (themes, sentiment, duplicate clusters, response-time/resolution heuristics).

### Data pipeline

1. **Discord fetch** — `src/lib/discord-api.ts` calls the *undocumented* Discord v9 REST API
   (`discord.com/api/v9/channels/:id/threads/search` and `/post-data`) using a raw `authorization` header
   (a user token, not a bot token). This only runs server-side, proxied through `src/app/api/discord/*`
   routes, to avoid CORS and keep the token off the client.
2. **Credential resolution** — `src/lib/discord-config.ts` resolves `{ channelId, authToken }` per request:
   client-supplied values (typed into `ConfigPanel`, held in the Zustand store) win over the
   `DISCORD_AUTH_TOKEN` / `DISCORD_CHANNEL_ID` env vars. `/api/discord-config` only ever reports back a
   boolean "is env configured" — the token itself never reaches the client.
3. **Normalization** — `normalizeIssue()` in `discord-api.ts` maps a raw Discord thread + first message into
   the app's `Issue` shape (`src/lib/discord-types.ts`).
4. **Client orchestration** — `src/lib/data-loader.ts` is the client-side coordinator: `fetchFromDiscord`
   paginates `threads/search`, backfills missing first messages via `post-data`, and
   `fetchRepliesForIssues` fetches full thread messages (bounded concurrency pool) to compute response
   analytics (`computeResponseAnalytics`: first-reply latency, responder count, a keyword-based
   resolution-status heuristic).
5. **Boot sequence** — `initSampleDataIfEmpty()` (called once from `page.tsx`) hydrates in priority order:
   localStorage (Zustand `persist` under key `discord-issue-dashboard`) → Supabase via `/api/db/load` →
   bundled `public/sample-data/search-discord-sample.json`. Sample data, once loaded, is persisted to the
   DB in the background so subsequent visits skip straight to step 2.
6. **Persistence** — `/api/db/sync` upserts issues and replaces their replies in Supabase via the shared
   `upsertIssuesAndReplies()` in `src/lib/persist-issues.ts` (also used by `/api/db/sync-incremental` so
   both paths persist identically). Best-effort and non-fatal if it fails — the dashboard keeps working
   from in-memory/localStorage state.

### LLM analytics

`analyze-themes`, `analyze-sentiment`, and `detect-duplicates` API routes each call `z-ai-web-dev-sdk`
server-side only (it depends on Node's `fs`/`path`/`os`, so it **must not** be imported from client
components). Every LLM call has a deterministic fallback (e.g. `src/lib/fallback-themes.ts`) that kicks in
if the model call throws or returns no results — callers should not assume LLM output is always present.

### State

`src/store/dashboard-store.ts` is a single Zustand store (persisted to localStorage) holding the loaded
issues, themes, per-feature "last fetched at" timestamps, and in-flight progress state for long-running
operations (thread fetch, reply fetch, sentiment, duplicates). Most dashboard components read directly from
this store rather than receiving data via props.

### Database

Primary store is **Supabase Postgres**, schema `discord` (tables `issues`, `replies`, `duplicate_clusters`,
`theme_clusters`). `src/lib/supabase.ts` exports `supabaseAdmin` — a server-only client using the
**service role key** (bypasses RLS, never import from client components). Migrations live in
`supabase/migrations/`; several **materialized/views** power the dashboard without client-side aggregation:

- `dashboard_global_metrics` — single-row KPI rollup (totals, avg/median response time, fast-response count, unique users).
- `dashboard_daily_stats` — per-day timeseries for trend charts.
- `top_responders_view` — top 20 reply authors.
- `dashboard_issues_light` — slim issue projection used by `/api/db/load` to keep payloads small (falls back to explicit column select on the `issues` table if the view is missing, error code `42P01`).

`/api/dashboard/metrics` is **edge runtime**, `revalidate = 3600`, and reads only those views — KPIs are
served from cache and refreshed by the cron sync, not computed per-request.

**Prisma is legacy.** `prisma/schema.prisma` (SQLite, `db/custom.db`) and `src/lib/db.ts` (singleton
`PrismaClient`) are left over from the original stack and **no longer imported anywhere in `src/`** except
`db.ts` itself — the `db:*` package scripts are vestigial. Don't add new persistence through Prisma; use
`supabaseAdmin` + a migration instead. PostgREST caps a single request at 1000 rows, so bulk reads
(`/api/db/load`) paginate server-side with `.range()`.

### Cron & background sync

`/api/cron/sync` (nodejs, `maxDuration = 60`) is the scheduled ingest path: it pulls recent active threads
from Discord v9, upserts them into `discord.issues`, then backfills missing replies for up to 10 threads
per run (oldest `fetched_at` first, cycling already-synced ones forward). Protected by `Bearer $CRON_SECRET`
— if `CRON_SECRET` is unset the route is unauthenticated (dev only). On Vercel this is wired as a Vercel
Cron job; the `cloudflare-cron/` Worker is the production trigger (see below).

API route map: `/api/discord/{search,post-data,messages}` (Discord proxy), `/api/discord-config`
(credential probe), `/api/db/{load,sync,sync-incremental,clear}` (Supabase persistence),
`/api/dashboard/metrics` (edge KPIs), `/api/cron/sync` (scheduled ingest).

### Duplicate detection (Cloudflare Worker + Vectorize)

`cloudflare-cron/` is a **separate Cloudflare Worker** (own `package.json`, `wrangler.jsonc`, deploy with
`bunx wrangler deploy`). Two cron jobs: hourly `0 * * * *` pings the dashboard's `/api/cron/sync`
(`TARGET_URL`), and daily `15 3 * * *` runs near-duplicate clustering via **Cloudflare Vectorize**.

- Embeddings: `bge-base-en-v1.5` (768d, cosine), index `discord-issues-index`. Same model is used by
  Workers AI (per-issue, incremental) and locally (bulk), so vectors are comparable.
- Embed text: `<name>\n\n<first_message_content>\n\nTags: <applied_tags>` (truncated 8000 chars).
- Cluster threshold cosine 0.86 (`DEFAULT_THRESHOLD` in `src/cluster.js`); singleton clusters discarded.
- Worker writes clusters back to `discord.duplicate_clusters` over PostgREST using
  `Accept-Profile: discord` / `Content-Profile: discord` headers (avoids needing `discord` in
  `pgrest.db_schemas`, which needs a superuser).

**Bulk backfill** (one-shot, run locally): `scripts/embed_bulk.py` (sentence-transformers → Vectorize
upsert, ~30 min for ~40k issues) then `scripts/cluster_bulk.py` (encodes locally, queries Vectorize,
writes clusters + `duplicate_cluster_id`, ~55 min; run with `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0`). See
`cloudflare-cron/README.md` for required env vars. The root-level `scrape-*.mjs` scripts are ad-hoc
reply-scraping helpers, not part of the scheduled pipeline.

### UI

shadcn/ui components live under `src/components/ui` (generated, not hand-rolled — regenerate via the
shadcn CLI rather than hand-editing broadly). Dashboard-specific components live in
`src/components/dashboard`. Path alias `@/*` maps to `src/*` (see `tsconfig.json`).

### Deployment

`next.config.ts` builds `output: "standalone"` with `typescript.ignoreBuildErrors: true` and
`reactStrictMode: false`. `bun run build` copies `.next/static` and `public/` into `.next/standalone/`
so `bun run start` (`bun .next/standalone/server.js`) is self-contained. `Caddyfile` reverse-proxies
port `:81` to `localhost:3000` by default, with a query-param override (`XTransformPort`) to target
another local port. Production also runs on Vercel (cron + edge metrics) alongside the Cloudflare
Worker — two separate platforms, not one.

### Notes

- `next-auth` is a listed dependency but is not currently wired up anywhere in `src/`.
- Env vars: `DISCORD_AUTH_TOKEN`, `DISCORD_CHANNEL_ID`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SCHEMA` (defaults to `discord`). `DATABASE_URL` is a Prisma
  leftover. Never log or persist the Discord auth token or the Supabase service role key client-side —
  the service key bypasses RLS.
