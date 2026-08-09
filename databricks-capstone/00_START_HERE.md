# START HERE — Databricks AI Capstone: Discord Solution Data Engine

**Live app:** https://discord-capstone-app-7474644913988012.aws.databricksapps.com
*(Databricks SSO — the URL redirects to OAuth consent. Screenshots of every screen are in `screenshots/`, so the app can be graded without workspace access.)*

A support-forum triage platform built on Databricks: a Spark pipeline over **40,570 real Discord
issues / 233,147 replies**, vector retrieval over their unstructured text, a Streamlit
Databricks App, and a LangGraph agent with six tools that both reads the data and **writes real
rows back to it**.

**Every file in this archive is `.txt`, `.png` or `.pdf`** — the only formats the submission
accepts. Source and docs therefore carry a `.txt` suffix (`tools.py.txt`,
`01_lakebase_schema.sql.txt`, `DEMO.md.txt`), keeping the original stem so the real language and
format stay obvious. Strip the trailing `.txt` to run or render any of them.

**Read `00_START_HERE.md.txt` → `DEMO.md.txt` → `FEATURES.md.txt` → `README.md.txt`.** Where the
text below names a file as `DEMO.md` or `agent/tools.py`, the archived copy is that name plus
`.txt`.

---

## The mandatory requirements

| # | Requirement | Implemented in | Evidence it actually runs |
|---|---|---|---|
| 1 | **Data pipeline in Spark** | `notebooks/02_compute_analytics.py.txt` | `pyspark.sql` job: JDBC read from Lakebase → `.write.format("delta")` → 5 Delta tables in `workspace.discord`. Row counts: `issues_enriched` **40,570**, `dashboard_daily_stats` **1,445**, `top_responders` **4,712**, plus `dashboard_issues_light` and `dashboard_global_metrics`. Runs on serverless. |
| 2 | **Third-party API integration** | `notebooks/01_ingest_discord_api.py.txt` | Live `requests` calls to the Discord v9 REST API — `threads/search`, `post-data`, `messages` — with cursor pagination, rate-limit backoff and env-based credentials. Runs locally: this workspace's network policy blocks `discord.com` egress from serverless and Apps (see *Caveats*). |
| 3 | **Unstructured data → retrieval** | `notebooks/03_build_embeddings.py.txt`, `rag/retriever.py.txt`, `notebooks/04_cluster_duplicates.py.txt` | `all-MiniLM-L6-v2` (384-d) embeds each issue's title + first message + tags into pgvector `discord.issue_embeddings` — **40,570 rows**, HNSW cosine index. Semantic search verified live (query "RLS policy not working" → top hit at 0.778). Near-duplicate clustering by pgvector self-similarity + union-find at cosine 0.86 groups **1,978 issues into 701 clusters** (largest: 125 issues, "Can't successfully authenticate with Supabase?"). Verified live in `DEMO.md` turn 3. |
| 4 | **Databricks App with a frontend** | `app/app.py.txt` + `app.yaml.txt` | Streamlit app, state `RUNNING` (deployment `01f193adc38d1882a1b51914e617a11a`, SUCCEEDED). 9 KPI tiles (40,570 issues · 19,048 users · 306,922 messages · 19,469 answered · 11,541 resolved · 48% response rate), 3 Plotly charts, filterable issues table (`app/app.py.txt:215`), per-issue thread inspector (`:224`), and the agent chat panel (`:249`). All six are captured, full-page and at native resolution, across `screenshots/app_overview.png` (tiles, charts, table, inspector) and `screenshots/turn1_dashboard.png` (the agent panel) — two consecutive slices of one continuous scroll of the running app. |
| 5 | **AI agent that does stuff** | `agent/tools.py.txt`, `agent/agent.py.txt`, `agent/prompts.py.txt`, `mcp_server.py.txt` | LangGraph ReAct agent on `databricks-deepseek-v4-flash-0731` via the AI Gateway. **6 tools — 4 read, 2 write**, also published over **MCP streamable HTTP** (`mcp_server.py.txt`, one implementation behind both surfaces). The write tools mutate production rows: `update_resolution_status` UPDATEs `discord.issues`, `add_note` INSERTs into `discord.notes`. Seven verbatim transcripts in `DEMO.md`; the write path fires **12 times across turns 2 and 5**, every write reconcilable to a row by id. |
| 6 | **Change Data Feed → Delta analytics** | `notebooks/02_compute_analytics.py.txt`, `notebooks/05_cdf_change_analytics.py.txt`, `app/app.py.txt` | `issues_enriched` carries `delta.enableChangeDataFeed` and is **MERGEd** (guarded on 7 tracked columns with null-safe equality) rather than overwritten — so the feed records real transitions, not a full rewrite per run. Notebook 05 reads `readChangeFeed` into `workspace.discord.issues_changes`: one row per issue per commit, with `changed_cols` and `old → new` resolution status; resumes from `MAX(_commit_version)` so it is incremental and idempotent. A daily rollup is mirrored into Lakebase `discord.issues_changes`, and the app renders it as the **Triage Activity** panel (3 KPIs + stacked daily bars). Closes the loop on the agent: `update_resolution_status` → Lakebase → merge → CDF → dashboard. **Verified on this workspace:** `discord.issues_changes` holds `(2026-08-09, update, change_count=4, status_changes=4)` — all four captured changes are `resolution_status` moves, i.e. exactly the agent's triage writes and nothing else. See `FEATURES.md` → *6*. |


**"306,922 messages" vs "233,147 replies" — different measures, not a contradiction.** Replies are
rows actually loaded into `discord.replies`. `total_messages` is `SUM(issues.message_count)`
(`notebooks/02_compute_analytics.py.txt:152`) — Discord's *own* per-thread counter, carried on each
thread record, which counts every message the thread ever held including ones never scraped and
ones since deleted. The tile reports what Discord says the forum contains; the reply count reports
what this pipeline holds. `DEMO.md` turn 6 is the agent finding one such gap on its own.

---

## Read in this order

1. **`DEMO.md`** — seven live agent transcripts, every tool call and result verbatim, each mapped
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
notebooks/05                       CDF -> issues_changes analytics  (Req 6)
rag/retriever.py.txt               pgvector semantic search         (Req 3)
agent/tools.py.txt                 6 tools, 4 read + 2 write        (Req 5)
agent/prompts.py.txt               system prompt + guardrails
agent/agent.py.txt                 LangGraph ReAct wiring + MLflow
mcp_server.py.txt                  same 6 tools over MCP streamable HTTP
                                   (one impl, two surfaces; --selftest)
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
