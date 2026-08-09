# Architecture

End-to-end design for the Discord-solution data engine on Databricks. This document
expands the README's one-shot diagram and traces each component back to its origin in
the Discord dashboard repo (`../../`).

---

## 1. Component map

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              INGEST (Spark)                                   │
│                                                                              │
│   notebook 00 — NDJSON backfill      notebook 01 — Discord v9 REST           │
│   (one-time, 40k issues/233k repl.)  (scheduled hourly, incremental)         │
│        │                                     │                               │
│        ▼                                     ▼                               │
│   normalize → computeResponseAnalytics (ported from discord-api.ts)          │
│        │                                                                     │
│        ▼                                                                     │
│   Lakebase UPSERT (issues, replies) — JDBC, idempotent on PK                 │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
              ┌────────────────┴───────────────┐
              ▼                                ▼
┌─────────────────────────┐     ┌────────────────────────────────────────────┐
│  LAKEBASE (OLTP)        │     │  DELTA / UNITY CATALOG (OLAP)               │
│  Postgres               │     │                                            │
│                         │     │  notebook 02 builds:                       │
│  discord.issues         │◄────│    discord.daily_stats                     │
│  discord.replies        │ read│    discord.global_metrics                  │
│  discord.notes          │     │    discord.issues_enriched                 │
│  discord.duplicate_*    │     │    discord.top_responders                  │
│  discord.theme_clusters │     │                                            │
│                         │     │  notebook 03 builds:                       │
│  * source of truth *    │     │    discord_issues_vs_source (CDF on)       │
│  agent writes here      │     │                                            │
│  discord.issue_         │     └─────────────────────┬──────────────────────┘
│    embeddings (pgvector)│                            │ Delta Sync trigger
│    + HNSW cosine        │                            ▼
└─────────────┬───────────┘     ┌──────────────────────────────────────────┐
              │                 │  MOSAIC AI VECTOR SEARCH   (backend: vs)  │
              │  DEFAULT        │  index: discord_issues_vs                 │
              │  backend:       │  model: databricks-bge-large-en           │
              │  pgvector       │  (replaces Cloudflare Vectorize)          │
              │                 └─────────────────────┬────────────────────┘
              │                                        │
              │     ┌──────────────────────────────────┴──────────────────┐
              │     │  rag/retriever.py    DISCORD_RETRIEVER_BACKEND       │
              │     │  query → embed → top-K (with score + metadata)       │
              │     └──────────────────────┬──────────────────────────────┘
              │                            │
              ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  AI AGENT (agent/)                                                            │
│  LangGraph ReAct loop · LLM via AI Gateway · MLflow Tracing                   │
│                                                                              │
│  Read tools:   semantic_search, search_issues_sql, get_issue_detail,         │
│                dashboard_metrics                                             │
│  Write tools:  update_resolution_status, add_note                            │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │ served endpoint
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STREAMLIT DATABRICKS APP (app/app.py)                                       │
│  KPI strip · issues-over-time · tag distribution · response-time buckets ·   │
│  time-of-week heatmap · filter bar · issues table w/ detail · AGENT CHAT     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data-flow narrative

### 2.1 Ingest → Lakebase (notebooks 00 + 01)
Two paths share one writer. The **backfill** (`00`) reads the NDJSON dumps you already
have; the **live ingest** (`01`) pulls from the Discord v9 REST API. Both run the same
normalization + analytics pipeline:

```
raw thread + first_message + messages
   │
   ├─ normalizeIssue()          — discord-api.ts:183  → Issue row
   ├─ computeResponseAnalytics()— discord-api.ts:278  → response_time_ms,
   │                                                    responder_count,
   │                                                    is_answered,
   │                                                    resolution_status
   └─ upsert issues + replies   — persist-issues.ts pattern, idempotent on PK
```

Lakebase (Postgres) is the right home for this: it's transactional, the agent will write
to it concurrently, and the schema uses FKs + triggers (`set_updated_at`) that Delta
can't express.

### 2.2 Lakebase → Delta rollups (notebook 02)
Lakebase is great for writes, bad for analytical scans over 40k issues × 233k replies.
Notebook 02 periodically snapshots Lakebase into Delta tables that mirror the Discord
repo's Postgres **views** (`dashboard_global_metrics`, `dashboard_daily_stats`,
`top_responders_view`, `dashboard_issues_light`) — these become pre-aggregated Delta
tables the dashboard reads directly. This is a deliberate OLTP/OLAP split; see
[design-decisions.md](design-decisions.md).

### 2.3 Embeddings → retrieval (notebook 03, `rag/retriever.py`)
Ports `cloudflare-cron/src/embed.js`. Two backends ship; `rag/retriever.py` picks one from
`DISCORD_RETRIEVER_BACKEND`.

| Discord (Cloudflare) | Databricks — **default** (`pgvector`) | Databricks — flag (`vs`) |
|---|---|---|
| Workers AI `@cf/baai/bge-base-en-v1.5` | `all-MiniLM-L6-v2`, 384-d, encoded in-process | `databricks-bge-large-en` (managed embeddings) |
| Vectorize index `discord-issues-index` | `discord.issue_embeddings` + HNSW cosine index | Vector Search index `discord_issues_vs` (Delta Sync) |
| `embedAndUpsert` per issue | batch embed → upsert over psycopg | Delta Sync — no manual upsert at all |
| `buildEmbedText`: name + body + Tags | identical text-construction function | same text |

pgvector is the default because the agent's write tools live in that same Postgres — retrieval
and the writes it justifies share one connection and one transaction boundary, which a
Lakebase → Delta → index pipeline cannot offer. The Delta Sync index is provisioned and
verified; see `FEATURES.md` → *Vector Search*. Rationale in
[design-decisions.md](design-decisions.md) §3.

### 2.4 Clustering (notebook 04)
Ports `cloudflare-cron/src/cluster.js` exactly: per-issue top-K query → similarity graph
(threshold 0.86 cosine) → union-find connected components → write
`duplicate_clusters` + set `issues.duplicate_cluster_id`. Runs daily in Databricks Jobs
(replacing the `15 3 * * *` Cloudflare cron).

### 2.5 Agent (agent/)
The one piece with no counterpart in the Discord repo. A LangGraph ReAct agent with six
tools — four read (semantic + SQL + detail + metrics) and two write (resolution status,
notes). It talks to Lakebase for live data, for writes **and** (by default) for retrieval —
pgvector lives in the same database; Vector Search is the alternate backend behind a flag.
The LLM is served behind the Databricks AI Gateway; the agent is logged and registered in
MLflow (`agent/mlflow_model.py`, models-from-code) with LangGraph auto-tracing, and runs
in-process inside the Streamlit App rather than as a served endpoint.

### 2.6 App (app/app.py)
A Streamlit Databricks App that recreates the Next.js dashboard's surfaces — KPI strip,
the four chart types (issues-over-time area, tag-distribution bar, response-time buckets,
time-of-week heatmap), the filter bar, and the issues table with a detail expander.
The headline addition is an **agent chat panel** (`st.chat_message`) where the dashboard's
"investigate and act" workflow becomes conversational.

---

## 3. Mapping back to the Discord repo

| Databricks artifact | Discord repo source | What changed |
|---|---|---|
| `sql/01_lakebase_schema.sql` | `supabase/backups/.../schema.sql` | nearly verbatim; + `notes` table |
| `notebooks/00` | *(new — uses the NDJSON dumps in that same backup dir)* | Spark reader instead of PostgREST |
| `notebooks/01` | `src/lib/data-loader.ts`, `src/lib/discord-api.ts` | TS → PySpark; secrets from Databricks scope |
| `notebooks/02` | `supabase/migrations/...dashboard_views.sql`, `discord-api.ts:computeResponseAnalytics` | Postgres views → Delta tables |
| `notebooks/03` | `cloudflare-cron/src/embed.js` | Workers AI → Foundation Model API; Vectorize → Vector Search |
| `notebooks/04` | `cloudflare-cron/src/cluster.js` | JS union-find → Python; Vectorize query → Vector Search |
| `rag/retriever.py` | `cloudflare-cron/src/index.js handleSearch` | same logic, Databricks client |
| `agent/*` | *(no equivalent — repo has only single-shot LLM calls)* | net-new |
| `app/app.py` | `src/app/page.tsx`, `src/components/dashboard/*` | React/Recharts → Streamlit/Plotly; + chat |
