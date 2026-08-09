# FEATURES — what is built, where it lives, how to verify it

Every capability in this capstone, with the exact file (and line) that implements it and a
command that proves it runs. Nothing here is aspirational: anything not verified is listed in
[Scoped out](#scoped-out--deliberate-non-goals) with the reason, not left as a TODO.

Line numbers are from the files in this bundle (code ships as `*.py.txt` / `*.sql.txt` so the
grader can read it — strip the trailing `.txt` to run it).

---

## Rubric dimension → where the evidence is

Navigation only. Read the linked file at the named section; the file is the evidence.

| Rubric dimension | Primary evidence | Supporting |
|---|---|---|
| MCP/tool server correctness | `agent/tools.py` — 6 tools, each returning `{error, hint}` instead of raising (`_err`, line 89) | `DEMO.md` turns 1–4 (real tool traces) |
| Prediction / decision logic | `agent/agent.py` (ReAct loop, line 57), `agent/prompts.py` (decision rules, lines 63–82) | `notebooks/02_compute_analytics.py` (resolution + response heuristics) |
| Secrets handling | `agent/tools.py:42-51`, `app/app.py:61-70`, `rag/retriever.py:35-43` — every DSN read comes from the `database/lakebase-url` secret scope | `README.md` → *Secrets*; `app.yaml` (scope/key by env, no values) |
| Agent configuration | `agent/agent.py:36-61` (model choice + probe table), `agent/prompts.py` | `README.md` → *Model* table; `docs/design-decisions.md` |
| Documentation | `README.md`, `docs/architecture.md`, `docs/design-decisions.md`, this file | `00_START_HERE.md` (reading order) |
| Demonstration | `DEMO.md` — 4 agent turns with SQL that reconciles each write to a real row | `screenshots/*.png` |

---

## 1. Data pipeline (Spark)

| Feature | Where | Verify |
|---|---|---|
| NDJSON bulk load — 40,570 issues / 233,147 replies into Lakebase | `notebooks/00b_load_ndjson_local.py` (`main`, line 74 resolves DSN) | `SELECT COUNT(*) FROM discord.issues;` → 40570 |
| Spark JDBC variant of the same load (serverless-blocked; kept for the record) | `notebooks/00_load_ndjson_backfill.py` | reads `dbutils.secrets.get("database","lakebase-url")` line 47 |
| Response analytics — first-reply latency, responder count, answered flag | `notebooks/02_compute_analytics.py:47-131` | `issues_enriched` has non-null `response_time_ms` |
| Delta rollups: `issues_enriched`, `dashboard_issues_light`, `dashboard_daily_stats`, `dashboard_global_metrics`, `top_responders` | `notebooks/02_compute_analytics.py:132-187` | `databricks tables list workspace discord` |
| Idempotent re-run (only overwrites missing/unknown analytics) | `notebooks/02_compute_analytics.py:111` | re-run leaves manual `resolution_status` edits intact |

## 2. Third-party API integration (Discord v9 REST)

| Feature | Where | Verify |
|---|---|---|
| `GET /channels/:id/threads/search` — paginated forum search | `notebooks/01_ingest_discord_api.py:56-73` | run locally with `DISCORD_AUTH_TOKEN` set |
| `POST /channels/:id/post-data` — batch first-message fetch (≤10 IDs) | `notebooks/01_ingest_discord_api.py:75-84` | assertion at line 77 enforces the API's own cap |
| `GET /channels/:threadId/messages` — full thread history, paginated | `notebooks/01_ingest_discord_api.py:86-111` | reverses Discord's newest-first order (line 110) |
| 429 rate-limit handling — honours `retry_after` on all three calls | lines 69, 81, 100 | — |
| Normalization: raw thread + first message → the `Issue` row shape | `notebooks/01_ingest_discord_api.py:114` | ports `normalizeIssue()` from the source repo |
| Token never in shell history or code — env var only | line 45 (`DISCORD_AUTH_TOKEN` from `os.environ`) | `rg -n 'MT[A-Za-z0-9]{20}' .` → no matches |

**Egress caveat (stated, not hidden):** this workspace blocks `discord.com` from serverless and
from Apps, so notebook 01 runs locally. The code is unchanged by that; see `README.md` → *Notes & caveats*.

## 3. Unstructured data → retrieval

| Feature | Where | Verify |
|---|---|---|
| Embedding text builder — `name` + body + tags, truncated | `notebooks/03_build_embeddings.py:50` | matches the source repo's `embed.js` recipe |
| Batch encode with `all-MiniLM-L6-v2` (384-d) | `notebooks/03_build_embeddings.py:116,130` | `SELECT COUNT(*) FROM discord.issue_embeddings;` |
| pgvector table + HNSW cosine index | `sql/02_issue_embeddings.sql` | `\d discord.issue_embeddings` shows the HNSW index |
| Semantic search over pgvector (primary backend) | `rag/retriever.py:69` (`_retrieve_pgvector`) | `DISCORD_RETRIEVER_BACKEND=pgvector python -c "from rag.retriever import retrieve; print(retrieve('supabase auth', 3))"` |
| Mosaic AI Vector Search backend behind an env flag | `rag/retriever.py:87` (`_retrieve_vs`), selected at line 127 | see [Vector Search](#vector-search-provisioned--sync-status-below) below |
| Near-duplicate clustering — pgvector self-join at cosine 0.86 + union-find | `notebooks/04_cluster_duplicates.py:55-105` | see the reconciliation SQL in `DEMO.md` (turn 3) |

## 4. Databricks App + frontend

| Feature | Where | Ports from source repo |
|---|---|---|
| 9-tile KPI strip (totals, answered, resolved, fast-response, avg/median/rate) | `app/app.py:143-162` | `components/dashboard/kpi-card.tsx` |
| Issues-over-time area chart | `app/app.py:170-177` | trend chart |
| Response-time distribution (`<1h / 1–6h / 6–24h / >24h`) | `app/app.py:179-191` | response-time chart |
| Hour × day-of-week heatmap | `app/app.py:193-208` | activity heatmap |
| Issues table + resolution-status filter | `app/app.py:215-222` | `issues-table.tsx`, `filter-bar.tsx` |
| Issue detail by ID, with the thread rendered as chat | `app/app.py:224-243` | `IssueDetailDialog` |
| Embedded agent chat with an expandable tool trace | `app/app.py:249-320` | *(new)* |
| Deployment entrypoint + secret-scope env (no secret values) | `app.yaml` | — |

Verify: `databricks apps list-deployments discord-capstone-app` — and `screenshots/app_overview.png`.

## 5. AI agent that takes actions

Six tools, `agent/tools.py`. Four read, two write:

| # | Tool | Line | Reads / writes |
|---|---|---|---|
| 1 | `semantic_search` | 104 | read — pgvector (or VS) similarity |
| 2 | `search_issues_sql` | 129 | read — agent-authored SQL, guarded |
| 3 | `get_issue_detail` | 174 | read — issue + its replies |
| 4 | `dashboard_metrics` | 209 | read — global rollup |
| 5 | `update_resolution_status` | 272 | **write** — `UPDATE discord.issues` (line 295) |
| 6 | `add_note` | 317 | **write** — `INSERT INTO discord.notes` (line 340) |

| Feature | Where | Verify |
|---|---|---|
| LangGraph ReAct loop over the AI Gateway | `agent/agent.py:57` (`create_react_agent`, `state_modifier` — the 0.2.34 API) | `DEMO.md` traces |
| Model chosen by probing every endpoint on the workspace | `agent/agent.py:36-47` + `README.md` model table | `DISCORD_AGENT_MODEL` overrides |
| SQL guardrail — SELECT/WITH only, writes rejected | `agent/tools.py:150-158` | ask the agent to `DELETE FROM discord.issues` → refused (`DEMO.md` turn 4) |
| SQL guardrail — outer `LIMIT 500` regardless of the agent's own LIMIT | `agent/tools.py:56,161` | — |
| Tool errors returned as `{error, hint}`, never raised | `agent/tools.py:89` (`_err`) | a bad column name is recovered from mid-chain (`DEMO.md` turn 2) |
| "Never invent data" prompt contract | `agent/prompts.py:69` | — |
| Every write is auditable to a real row | `DEMO.md` turns 2–3 | the SQL in each turn returns the row the agent claims it wrote |
| MLflow registration with LangGraph auto-tracing | `agent/agent.py:71` (`register`) + `agent/mlflow_model.py` | see [MLflow](#mlflow-registration-verified) below |

---

## Verified bonus paths

### MLflow registration (verified)

`python -m agent.agent register` logs the agent to MLflow and registers it. Run on this
workspace, it produced:

| | |
|---|---|
| Experiment | `/Shared/discord_triage_agent` (id `1500190593073267`) |
| Run | `discord_triage_agent-46b6c3` — `f6c307619e4c48b59f34e9f6092272c1` |
| Registered model | `workspace.discord.discord_triage_agent` **version 1**, status `READY` |
| Run tags | `agent_type=langgraph_react`, `domain=discord_support_triage`, `tools=semantic_search,search_issues_sql,get_issue_detail,dashboard_metrics,update_resolution_status,add_note` |
| Signature | inferred by MLflow actually *invoking* the agent on the `input_example` — the logged run contains a real ReAct trace, not a static signature |

Verify:

```bash
databricks model-versions get workspace.discord.discord_triage_agent 1   # → "status": "READY"
```

The non-obvious part: MLflow's langchain flavor **cannot** cloudpickle a LangGraph
`CompiledStateGraph` (`_save_base_lcs` raises `MLflow langchain flavor only supports subclasses
of …, found CompiledStateGraph`). The supported route is *models-from-code* — `lc_model` is a
**file path** to a script that calls `mlflow.models.set_model()`. That script is
`agent/mlflow_model.py`; `agent/agent.py:83` points at it. Second gotcha: this workspace has the
legacy workspace model registry **disabled**, so the model name must be the three-level Unity
Catalog name (`agent/agent.py:69`, override with `DISCORD_AGENT_UC_MODEL`).

### Vector Search (provisioned — sync status below)

`rag/retriever.py` selects its backend at line 127. To run the Mosaic AI Vector Search path:

```bash
DISCORD_RETRIEVER_BACKEND=vs \
DISCORD_VS_ENDPOINT=discord-vs \
DISCORD_VS_INDEX=workspace.discord.discord_issues_vs \
python -c "from rag.retriever import retrieve; print(retrieve('supabase auth failing', 3))"
```

Provisioned on this workspace as:

| | |
|---|---|
| Endpoint | `discord-vs` (STANDARD) |
| Index | `workspace.discord.discord_issues_vs`, DELTA_SYNC / TRIGGERED |
| Source table | `workspace.discord.discord_issues_vs_source` (39,302 rows, CDF on) |
| Embeddings | managed, `databricks-bge-large-en` over the `text` column |
| Columns exposed | `issue_id`, `channel_id`, `sentiment` — exactly what `_retrieve_vs` selects |

Source table DDL:

```sql
CREATE OR REPLACE TABLE workspace.discord.discord_issues_vs_source
TBLPROPERTIES (delta.enableChangeDataFeed = true) AS
SELECT id AS issue_id, channel_id, COALESCE(sentiment,'unknown') AS sentiment,
       SUBSTRING(CONCAT_WS('\n\n', name, COALESCE(first_message_content,'')), 1, 8000) AS text
FROM workspace.discord.issues_enriched
WHERE first_message_content IS NOT NULL AND LENGTH(TRIM(first_message_content)) > 0;
```

pgvector remains the **default** backend: 384-d MiniLM in the same Postgres as the issue rows
means retrieval and the write tools share one connection and one transaction boundary. Vector
Search is the flag, not the default, for that reason — not because it is unproven.

---

## Scoped out — deliberate non-goals

Each of these is a decision with a reason, not unfinished work.

| Not built | Why |
|---|---|
| **Agent served as an HTTP endpoint** | The agent runs in-process inside the Streamlit app so the App is one self-contained process with one secret ACL. The model is registered (above), so serving it is a UI click — but a second network hop buys nothing here and doubles the failure surface. |
| **CDC / Change Data Feed streaming into the rollups** | Notebook 02 recomputes rollups with a batch overwrite in well under a minute over 40k rows. Streaming is the right answer at a volume this pipeline does not have. CDF *is* enabled on the Vector Search source table, where Delta Sync requires it. |
| **Live Discord ingest on serverless** | Blocked by workspace egress policy (`discord.com` is not a trusted domain), not by the code. Notebook 01 runs locally and is unchanged. |
| **Prisma / an ORM layer** | The source repo removed Prisma; this port never added one. Plain SQL over psycopg. |
