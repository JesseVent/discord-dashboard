# Databricks AI Capstone — Discord Solution Data Engine

A Databricks port of the **Discord support-forum analytics solution** (`../`), built to satisfy
every requirement of the "Rise of the AI Data Engineer" capstone. The Discord repo is the
**standard**: every component here is a one-to-one port of an existing piece of that solution,
retargeted to the Databricks platform — with one net-new addition (the tool-using agent).

Real data ships with it: the NDJSON dumps in
`../supabase/backups/hosted-discord-schema-2026-07-25/` (**40,570 issues** / **233,147 replies**)
load straight into Lakebase, so there is real volume from day one — no scraping, no synthetic data.

---

## Capstone requirements → how this satisfies them

| # | Requirement | Where it lives | Ported from (Discord repo) |
|---|---|---|---|
| 1 | **Data pipeline in Spark** | `notebooks/00–04` | `src/lib/data-loader.ts`, `discord-api.ts`, `computeResponseAnalytics` |
| 2 | **Third-party API integration** | `notebooks/01_ingest_discord_api.py` | `src/lib/discord-api.ts` (Discord v9 REST) |
| 3 | **Unstructured data → retrieval** | `notebooks/03_build_embeddings.py`, `rag/retriever.py` | `cloudflare-cron/src/embed.js` (→ Mosaic AI Vector Search) |
| 4 | **Databricks App + frontend** | `app/app.py` | `src/app/page.tsx`, `components/dashboard/*` (→ Streamlit) |
| 5 | **AI agent that takes actions** | `agent/{tools,agent,prompts}.py` | *(new — fills a gap in the Discord repo)* |

Plus the shared architectural skeleton: **relational tables in Lakebase** (`sql/01_lakebase_schema.sql`),
**embeddings over unstructured text** for semantic retrieval, and an **agent with read/write tools**.

---

## Architecture in one diagram

```
                 ┌──────────────────────────┐   ┌─────────────────────────┐
   NDJSON dumps  │ issues.ndjson.gz         │   │  Discord v9 REST API    │
   (40k/233k)    │ replies.ndjson.gz        │   │  threads/search,        │
                 └─────────────┬────────────┘   │  post-data, messages    │
                               │                └───────────┬─────────────┘
                               │  one-time                  │  scheduled
                               ▼                            ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  SPARK PIPELINE  (notebooks/00 → 04)                                 │
   │  ingest → normalize → compute analytics → embed → cluster            │
   └────────────┬────────────────────────────┬───────────────────────────┘
                │ writes (OLTP)               │ writes (OLAP, append)
                ▼                             ▼
   ┌──────────────────────────┐   ┌──────────────────────────────────────┐
   │  Lakebase (Postgres)     │   │  Delta tables (Unity Catalog)        │
   │  issues, replies,        │   │  daily_stats, global_metrics,        │
   │  notes, duplicate_       │   │  issues_enriched, embeddings          │
   │  clusters, theme_clusters│   └───────────────┬──────────────────────┘
   └─────────────┬────────────┘                   │
                 │ source-of-truth                │ Delta Sync
                 │                                ▼
                 │              ┌──────────────────────────────────────┐
                 │              │  Mosaic AI Vector Search index        │
                 │              │  (discord_issues_vs, bge-large)       │
                 │              └───────────────┬──────────────────────┘
                 │                              │
                 │         ┌────────────────────┴───────────────┐
                 └────────►│  AI Agent (LangGraph + MLflow)       │
                           │  tools: semantic_search, sql,        │
                           │  detail, metrics + 2 write tools     │
                           └───────────────┬──────────────────────┘
                                           │
                                           ▼
                           ┌───────────────────────────────────────┐
                           │  Streamlit Databricks App              │
                           │  KPIs · charts · filter · agent chat   │
                           └───────────────────────────────────────┘
```

See [`docs/architecture.md`](docs/architecture.md) for the expanded flow and
[`docs/design-decisions.md`](docs/design-decisions.md) for the rationale.

---

## Setup — build order

> All commands assume the Databricks CLI is configured (`databricks auth login`)
> and you are on a cluster/serverless SQL warehouse with the **Mosaic AI**,
> **Lakebase**, and **Apps** features enabled.

1. **Lakebase + schema**
   ```bash
   databricks lakebase create --name discord-capstone       # provision a Lakebase
   # grab the JDBC host from `databricks lakebase get`, then:
   psql "$LAKEBASE_JDBC" -f sql/01_lakebase_schema.sql
   ```

2. **One-time backfill** (load your real data) — notebook `00_load_ndjson_backfill.py`.
   Upload the NDJSON dumps to a UC volume, set the path in the notebook, run it.

3. **Scheduled ingest** — notebook `01_ingest_discord_api.py`. Wire it to a Databricks Job
   (hourly). Put the Discord token in a secret scope:
   ```bash
   databricks secrets create-scope discord
   databricks secrets put-secret discord auth_token
   ```

4. **Analytics rollups** — notebook `02_compute_analytics.py`. Schedule after ingest.

5. **Embeddings + Vector Search** — notebook `03_build_embeddings.py` creates the
   `discord_issues_vs` index (Delta Sync) and backfills vectors.

6. **Duplicate clustering** — notebook `04_cluster_duplicates.py` (daily).

7. **Agent** — `agent/agent.py` registers the LangGraph agent in MLflow and serves it
   via AI Gateway.

8. **App** — `app/app.py`:
   ```bash
   databricks apps deploy discord-dashboard-app --source ./app
   ```

---

## Project layout

```
databricks-capstone/
├── README.md                         ← you are here
├── docs/
│   ├── architecture.md               ← end-to-end data flow + component map
│   └── design-decisions.md           ← why Lakebase/Delta, model & framework choices
├── sql/
│   └── 01_lakebase_schema.sql        ← Lakebase DDL (ported from hosted Supabase backup)
├── notebooks/
│   ├── 00_load_ndjson_backfill.py    ← load NDJSON dumps → Lakebase (Spark)
│   ├── 01_ingest_discord_api.py      ← Discord v9 REST ingest (PySpark)
│   ├── 02_compute_analytics.py       ← response analytics + Delta rollups
│   ├── 03_build_embeddings.py        ← Vector Search index (replaces Cloudflare Vectorize)
│   └── 04_cluster_duplicates.py      ← near-duplicate clustering (ports cluster.js)
├── rag/
│   └── retriever.py                  ← Vector Search query helper
├── agent/
│   ├── tools.py                      ← 6 tools: 4 read + 2 write
│   ├── prompts.py                    ← system prompt
│   └── agent.py                      ← LangGraph agent + MLflow tracing
└── app/
    ├── app.py                        ← Streamlit dashboard + agent chat
    └── requirements.txt              ← pinned deps for Databricks Apps
```

---

## Notes & caveats

- **Two fast-moving Databricks surfaces** — Lakebase and the Mosaic AI Agent Framework —
  evolve quickly. Each artifact flags the exact API call to re-check against current docs;
  the structure and logic are stable.
- **No code outside `databricks-capstone/` is modified.** The Discord repo is treated as
  read-only reference.
- **Secrets** (Discord token, Databricks PAT) are always referenced from the Databricks
  secret scope or `dbutils.secrets`, never hardcoded.
