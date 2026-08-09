# START HERE — Databricks AI Capstone: Discord Solution Data Engine

**Live app:** https://discord-capstone-app-7474644913988012.aws.databricksapps.com
*(Databricks SSO — the URL redirects to OAuth consent. Screenshots of every screen are in `screenshots/`, so the app can be graded without workspace access.)*

A support-forum triage platform built on Databricks: a Spark pipeline over **40,570 real Discord
issues / 233,147 replies**, vector retrieval over their unstructured text, a Streamlit
Databricks App, and a LangGraph agent with six tools that both reads the data and **writes real
rows back to it**.

All source files carry a `.txt` suffix (`tools.py.txt`, `01_lakebase_schema.sql.txt`) so every
file in this archive is plain-text readable. The stem keeps the real language.

---

## The five mandatory requirements

| # | Requirement | Implemented in | Evidence it actually runs |
|---|---|---|---|
| 1 | **Data pipeline in Spark** | `notebooks/02_compute_analytics.py.txt` | `pyspark.sql` job: JDBC read from Lakebase → `.write.format("delta")` → 5 Delta tables in `workspace.discord`. Row counts: `issues_enriched` **40,570**, `dashboard_daily_stats` **1,445**, `top_responders` **4,712**, plus `dashboard_issues_light` and `dashboard_global_metrics`. Runs on serverless. |
| 2 | **Third-party API integration** | `notebooks/01_ingest_discord_api.py.txt` | Live `requests` calls to the Discord v9 REST API — `threads/search`, `post-data`, `messages` — with cursor pagination, rate-limit backoff and env-based credentials. Runs locally: this workspace's network policy blocks `discord.com` egress from serverless and Apps (see *Caveats*). |
| 3 | **Unstructured data → retrieval** | `notebooks/03_build_embeddings.py.txt`, `rag/retriever.py.txt`, `notebooks/04_cluster_duplicates.py.txt` | `all-MiniLM-L6-v2` (384-d) embeds each issue's title + first message + tags into pgvector `discord.issue_embeddings` — **40,570 rows**, HNSW cosine index. Semantic search verified live (query "RLS policy not working" → top hit at 0.778). Near-duplicate clustering by pgvector self-similarity + union-find at cosine 0.86 groups **1,978 issues into 701 clusters** (largest: 125 issues, "Can't successfully authenticate with Supabase?"). Verified live in `DEMO.md` turn 3. |
| 4 | **Databricks App with a frontend** | `app/app.py.txt` + `app.yaml.txt` | Streamlit app, state `RUNNING` (deployment `01f193adc38d1882a1b51914e617a11a`, SUCCEEDED). 9 KPI tiles (40,570 issues · 19,048 users · 306,922 messages · 19,469 answered · 11,541 resolved · 48% response rate), 4 Plotly charts, filterable issues table, per-issue thread inspector, and the agent chat panel. → `screenshots/app_overview.png` |
| 5 | **AI agent that does stuff** | `agent/tools.py.txt`, `agent/agent.py.txt`, `agent/prompts.py.txt` | LangGraph ReAct agent on `databricks-deepseek-v4-flash-0731` via the AI Gateway. **6 tools — 4 read, 2 write.** The write tools mutate production rows: `update_resolution_status` UPDATEs `discord.issues`, `add_note` INSERTs into `discord.notes`. Full read→decide→write loop captured verbatim in `DEMO.md` turn 2 — 11 tool calls ending in a real UPDATE + INSERT (note `13201d0a-4d09-4685-9293-96550ece16a9`). |

---

## Read in this order

1. **`DEMO.md`** — four live agent transcripts, every tool call and result verbatim, each mapped
   to the requirement it evidences, with matching screenshots.
2. **`FEATURES.md`** — the index: every feature → the file and line that implements it → a command
   that proves it runs. Also carries the rubric-dimension → evidence map and the explicit
   scoped-out list.
3. **`README.md`** — architecture diagram, the reproducible build order, notes and caveats.
4. **`docs/architecture.md`** — expanded data flow and component map.
5. **`docs/design-decisions.md`** — why Lakebase + Delta, why pgvector over Vector Search, why the
   agent runs in-process.

**What this is a port of.** The original solution is a running Next.js/React dashboard over
Supabase Postgres (`screenshots/source_react_dashboard.png`). Every component here except the
agent is a one-to-one retarget of a piece of it — see README.md, "The source solution this ports
from", which also explains why the source dashboard's headline numbers (41,413 issues) differ from
this capstone's (40,570): a frozen snapshot, and a single channel instead of all channels.

## Code map

```
sql/01_lakebase_schema.sql.txt     Lakebase DDL — issues, replies, notes,
                                   duplicate_clusters, theme_clusters + views
sql/02_issue_embeddings.sql.txt    pgvector table + HNSW index
notebooks/00, 00b                  NDJSON bulk load → Lakebase
notebooks/01                       Discord v9 REST ingest          (Req 2)
notebooks/02                       Spark → Delta analytics          (Req 1)
notebooks/03, 04                   embeddings + duplicate clusters  (Req 3)
rag/retriever.py.txt               pgvector semantic search         (Req 3)
agent/tools.py.txt                 6 tools, 4 read + 2 write        (Req 5)
agent/prompts.py.txt               system prompt + guardrails
agent/agent.py.txt                 LangGraph ReAct wiring + MLflow
app/app.py.txt                     Streamlit dashboard + agent chat (Req 4)
```

## The agent's six tools

| Tool | Kind | What it does |
|---|---|---|
| `semantic_search(query, top_k)` | read | pgvector search over issue embeddings |
| `search_issues_sql(sql)` | read | read-only SELECT/WITH; write keywords rejected, 500-row cap, 10s timeout |
| `get_issue_detail(issue_id)` | read | one issue + its full reply thread |
| `dashboard_metrics()` | read | live KPI rollups + 30-day trend |
| `update_resolution_status(issue_id, status, reason)` | **write** | re-classifies the issue and records the reason as a note |
| `add_note(issue_id, content)` | **write** | attaches a triage note every dashboard viewer sees |

Every tool documents `Args:` and `Returns:`, and every failure path returns a uniform
`{error, hint}` — never a raised exception — so the ReAct loop can read the hint and self-correct.

## Security

No credentials in this archive. The Lakebase DSN is read at runtime from the Databricks secret
scope `database/lakebase-url`; the Discord token comes from the local environment only. Agent SQL
is restricted to SELECT/WITH with a row cap and statement timeout. Writes are confined to two
purpose-built tools with validated inputs and parameterised statements.

## Caveats (stated up front)

- **Egress:** this workspace's network policy blocks `discord.com` from serverless and Apps, so
  the live Discord ingest (notebook 01) runs locally and bulk history was loaded from NDJSON
  dumps. The Spark pipeline, the app and the agent are unaffected — they only reach Lakebase,
  Delta and the in-workspace LLM gateway.
- **Cold start:** first app load takes ~4 minutes; `sentence-transformers` pulls `torch`, needed
  because `semantic_search` embeds the query locally before hitting pgvector.
- **Model:** `databricks-deepseek-v4-flash-0731`, selected by probing every endpoint on the
  workspace against the hardest demo turn — frontier models return "rate limit of 0" on this
  trial, and `llama-4-maverick` emits write-tool calls as plain text so the write never happens.
  The comparison table is in `README.md`. Override with `DISCORD_AGENT_MODEL`.
