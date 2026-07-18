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

bun run db:push       # prisma db push (sync schema.prisma -> SQLite, no migration file)
bun run db:generate   # prisma generate
bun run db:migrate    # prisma migrate dev
bun run db:reset      # prisma migrate reset
```

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
   localStorage (Zustand `persist` under key `discord-issue-dashboard`) → SQLite via `/api/db/load` →
   bundled `public/sample-data/search-discord-sample.json`. Sample data, once loaded, is persisted to the
   DB in the background so subsequent visits skip straight to step 2.
6. **Persistence** — `/api/db/sync` upserts issues and replaces their replies in SQLite (Prisma); this is
   best-effort and non-fatal if it fails — the dashboard keeps working from in-memory/localStorage state.

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

`prisma/schema.prisma` targets SQLite (`db/custom.db`). Active models: `Issue`, `Reply`,
`DuplicateCluster`, `ThemeCluster`. `User`/`Post` are leftover scaffold models, unused by the issue tracker.
`src/lib/db.ts` exports a singleton `PrismaClient` cached on `globalThis` in dev to survive HMR.

### UI

shadcn/ui components live under `src/components/ui` (generated, not hand-rolled — regenerate via the
shadcn CLI rather than hand-editing broadly). Dashboard-specific components live in
`src/components/dashboard`. Path alias `@/*` maps to `src/*` (see `tsconfig.json`).

### Deployment

`next.config.ts` builds `output: "standalone"` with `typescript.ignoreBuildErrors: true` and
`reactStrictMode: false`. `Caddyfile` reverse-proxies port `:81` to `localhost:3000` by default, with a
query-param override (`XTransformPort`) to target another local port.

### Notes

- `next-auth` is a listed dependency but is not currently wired up anywhere in `src/`.
- `.env` holds `DISCORD_AUTH_TOKEN`, `DISCORD_CHANNEL_ID`, and `DATABASE_URL` — never log or persist the
  auth token client-side.
