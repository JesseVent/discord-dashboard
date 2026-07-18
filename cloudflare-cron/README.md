# discord-dashboard/cloudflare-cron

Edge cron Worker for the discord-dashboard. Two responsibilities:

1. **Hourly cron** (`0 * * * *`) — pings `TARGET_URL` (the Supabase sync endpoint) to trigger the scraper.
2. **Daily clustering cron** (`15 3 * * *`) — finds near-duplicate issues via Vectorize and writes clusters back to `discord.duplicate_clusters`.

HTTP routes (authed by `Authorization: Bearer ${CRON_SECRET}`):

| Method | Path     | Purpose |
|--------|----------|---------|
| POST   | `/embed` | Embed a single issue (Workers AI → Vectorize upsert). Body: `{ issue: { id, name, first_message_content, applied_tags, channel_id, sentiment } }` |
| POST   | `/search`| Embed a free-text query, return top-K matching issue IDs. Body: `{ query, topK }` |
| POST   | `/cluster`| Run clustering for currently-unclustered issues |
| GET    | `/health`| Unauthed health check |

## Setup

### 1. Secrets (already needed by the sync ping)

```sh
bunx wrangler secret put CRON_SECRET              # same one used by the dashboard
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY # from discord-dashboard/.env
```

`SUPABASE_URL` + `TARGET_URL` are already in `wrangler.jsonc` as vars.

> The Worker talks to `discord.*` tables via PostgREST using the `Accept-Profile: discord` / `Content-Profile: discord` headers. This avoids needing `discord` in `pgrest.db_schemas` (which requires `postgres` superuser to set). If the bulk script later needs to fall back to direct Postgres, see `scripts/embed_bulk.py` for what was tried.

### 2. Deploy

```sh
bunx wrangler deploy
```

The Vectorize index `discord-issues-index` (768d, cosine) is already created on account `a4c62b0ff940768795be577c207abda5`. Re-creating with the same name fails — check `bunx wrangler vectorize list` first.

### 3. Bulk embed (one-shot, runs locally)

Set env (or drop in a `.env` next to the script — the script auto-loads it):

```sh
export SUPABASE_URL=https://gpfuhxmtidkynxhmfphg.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
export CLOUDFLARE_ACCOUNT_ID=a4c62b0ff940768795be577c207abda5
export CLOUDFLARE_API_TOKEN=...   # Vectorize:Edit permission
export VECTORIZE_INDEX_NAME=discord-issues-index
```

```sh
cd /Users/jvent/Dev/discord-dashboard
pip install sentence-transformers requests
python scripts/embed_bulk.py
```

Expect ~30 min for ~40k issues on a laptop. Skips empty issues (no name + no first message).

### 4. Trigger initial clustering

After the bulk embed finishes, kick off clustering (handle `/cluster` does 500/cycle):

```sh
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<worker-url>/cluster
```

Or wait for the next daily cron at 03:15 UTC.

## Architecture notes

- **Embed model**: `bge-base-en-v1.5` (768d). Same model used both locally (bulk) and via Workers AI (per-issue), so vectors are comparable.
- **Embed text**: `<name>\n\n<first_message_content>\n\nTags: <applied_tags joined>`. Truncated to 8000 chars.
- **Cluster threshold**: cosine 0.86. Tune via `DEFAULT_THRESHOLD` in `src/cluster.js`.
- **Singleton clusters discarded** — a "duplicate" with no neighbours isn't a duplicate.
- **Normalisation**: sentence-transformers runs with `normalize_embeddings=True` so cosine on Vectorize matches what we computed locally.

## Future-work deferred

- Reply-level embeddings (would enable "find best reply for question" search) — out of scope until issues are stable.
- Per-channel Vectorize indices — currently global; add a metadata `channelId` filter if cross-channel noise becomes an issue.
- Cluster name generation via Workers AI — currently uses the head issue's `name` truncated to 80 chars.
- Bulk clustering script (40k Vectorize queries is slow from Workers; faster to cluster locally after bulk embed).
