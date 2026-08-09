# Session Handoff — Databricks Capstone

**Last updated: 2026-08-08 (ALL phases done, app deployed). Deadline: Sun 9 Aug 2026, 22:00 Australia/Adelaide.**
Resume from here. The full plan is at `~/.claude/plans/luminous-knitting-swing.md`.
Bootcamp env history: `../bootcamp/STATUS.md` (M0–M6). Project plan: `README.md`.

## ⚠️ CRITICAL platform facts discovered this session (read before any Spark/Lakebase work)
1. **Serverless BLOCKS generic JDBC writes** (`df.write.format("jdbc")`) with
   `[UNSUPPORTED_DATA_SOURCE_WRITE]` at *analysis* time — the named `postgresql` connector is
   allowed but Spark's generic `JdbcRelationProvider` is not. Confirmed empirically + per
   https://docs.databricks.com/aws/en/compute/serverless/limitations. **Workarounds**: (a) load
   locally via psycopg (what `notebooks/00b_load_ndjson_local.py` does — approved, notebook 02 still
   satisfies Req 1), or (b) use a JDBC **Unity Catalog connection** (Remote Query SQL API) — bonus.
   ⇒ Any "write to Lakebase from Spark" plan must go local-psycopg. **Reads via JDBC are fine.**
2. **JDBC reads need split creds, NOT an embedded-cred URL.** The `database/lakebase-url` secret's
   password contains URL-special chars; embedding it in `jdbc:postgresql://user:pw@host/db` fails with
   `FAILED_JDBC.CONNECTION HV000`. The verified recipe: `urlparse(dsn)` → build the JDBC url *without*
   creds → pass `.option("user", p.username).option("password", p.password).option("ssl","true")
   .option("driver","org.postgresql.Driver")`. See `notebooks/02_compute_analytics.py`.
3. **`duplicate_cluster_id` is NOT all-null** — 342 of 40,570 issues reference a real cluster. FK-order
   loading (duplicate_clusters → issues → replies) is MANDATORY. (The HANDOFF's earlier `rg` check
   gave a false positive because minified JSON is `"key":null` with no space.)
4. **dbutils.secrets.get() returns plaintext** inside a notebook (do NOT base64-decode — that's only
   for the SDK path in `bootcamp/day1b/lakebase.py`).
5. **Notebook stdout isn't surfaced in `jobs get-run-output`** for the `submit` one-shot shape. To
   capture notebook output, write to a UC volume (`dbutils.fs.put("/Volumes/workspace/discord/raw/_x.txt", …)`),
   then `databricks fs cat dbfs:/Volumes/...`. Proven pattern.
6. **Run a notebook on serverless**: omit ALL cluster config. `databricks jobs submit --json
   '{"queue":{"enabled":true},"tasks":[{"task_key":"k","notebook_task":{"notebook_path":"/p","source":"WORKSPACE"}}]}'`.
   Import: `databricks workspace import /bootcamp/capstone/<name> --file <local.py> --format SOURCE
   --language PYTHON --overwrite`. Folder: `/bootcamp/capstone` (created this session).
7. **Delta `mode("overwrite")` does NOT evolve schema.** A prior partial run leaves a stale table; a
   changed-column re-run throws `DELTA_METADATA_MISMATCH`. Fix: `databricks tables delete workspace.discord.<t>`
   then re-run. (Happened to `issues_enriched` etc. — the scaffolding dropped `owner_id` which
   `dashboard_global_metrics.countDistinct("owner_id")` then needed.)

## Goal
Build out `databricks-capstone/` end-to-end on the connected Databricks env. It's a Databricks
port of the Discord support-forum analytics solution (`discord-dashboard/`), satisfying the 5-req
capstone rubric: (1) Spark pipeline, (2) third-party API, (3) unstructured→retrieval (vector/RAG),
(4) Databricks App + frontend, (5) AI agent with read **and** write tools. Real NDJSON data:
**40,570 issues / 233,147 replies / 155 duplicate_clusters**.

## ✅ STATUS — all 5 requirements verified (2026-08-08)
- **Req 1 (Spark pipeline)** ✓ — notebook 02 builds 5 Delta tables in `workspace.discord`
  (issues_enriched 40570, dashboard_issues_light 40570, dashboard_daily_stats 1445,
  dashboard_global_metrics, top_responders 4712). Run on serverless.
- **Req 2 (third-party API)** ✓ — notebook 01 (`01_ingest_discord_api.py`) is the self-contained,
  correct Discord v9 REST integration (env/psycopg, no dbutils). **Code is the deliverable** —
  `discord.com` is egress-blocked from serverless + Apps, so live ingest runs locally; bulk data
  loaded from NDJSON via notebook 00b. (See README "egress limitation.")
- **Req 3 (unstructured→retrieval)** ✓ — `discord.issue_embeddings` (pgvector, vector(384),
  HNSW cosine) populated with 40,570 rows; `rag/retriever.py` smoke-tested: 4 queries return
  relevant hits (scores 0.46–0.78; RLS query → 0.778).
- **Req 4 (Databricks App + frontend)** ✓ — **LIVE**: `discord-capstone-app` deployed &
  RUNNING at `https://discord-capstone-app-7474644913988012.aws.databricksapps.com`
  (deployment_id `01f1928d71a91424a2826e5a42f9f6b8`, SUCCEEDED). Locally verified: KPI strip
  (40570 issues, 19048 users, 306922 msgs, 19469 answered, 11541 resolved, 48% response rate) +
  4 charts + issues table + agent chat all render from Lakebase.
- **Req 5 (AI agent, read+write)** ✓ — all 6 tools verified against live Lakebase:
  READ: semantic_search, search_issues_sql, get_issue_detail, dashboard_metrics.
  WRITE (core acceptance): `add_note` + `update_resolution_status` mutate real rows (confirmed
  via SQL, then rolled back). Full LLM ReAct loop (llama-4-maverick) works end-to-end.
  Fixed 3 bugs this session: `ChatDatabricks` import deprecation, int-ID coercion, anti-
  hallucination prompt.

## Environment (verified this session)
- **Workspace**: paid trial `dbc-3f25e26b-55a4` (id `7474644913988012`). Auth profile DEFAULT.
- **Lakebase**: `bootcamp-lakebase` (PG16, CU_1, pgvector ON, `student` role).
  - Connect: `databricks psql bootcamp-lakebase -- -c "…"` (connects as admin/jesse).
  - Secret `database/lakebase-url` (base64-encoded full DSN) connects **as `student`** — reuse this,
    do NOT create a new `discord` role. Decode pattern: `bootcamp/day1b/lakebase.py`.
- **UC catalog**: `workspace` is the default (NOT `main`). The scaffolding's `CATALOG="main"` is a bug.
- **SQL warehouse** `da70f4ff99847b47` (Serverless Starter, stopped, auto-starts).
- **Hard constraint — egress**: outbound to non-trusted domains is BLOCKED from serverless AND
  Databricks Apps (Enterprise-tier network policy; confirmed on paid trial too). `discord.com` is
  blocked (same as `api.massive.com`/`api.weather.gov`). → Live Discord ingest runs **locally**;
  bulk load via NDJSON in a UC volume. Code is "correct wherever egress is permitted."

## Decisions locked
1. **Reuse `bootcamp-lakebase` + `student` + `database/lakebase-url`** — zero new roles/secrets.
2. **pgvector is the PRIMARY retrieval backend** (proven M3: 384d HNSW + `<=>` cosine). Mosaic
   Vector Search + `ai_embed(bge-large)` is unproven on this workspace → bonus only. Skip Probe B
   for MVP; commit to pgvector.
3. **CDC**: batch MERGE now (notebook 02 as-written); CDF streaming = bonus only if time permits.
4. **Agent**: embedded in-process in the Streamlit app (primary); MLflow-served endpoint = bonus.

## DONE (cumulative, verified)

### Phase 1 — NDJSON backfill to Lakebase ✓ (2026-08-07)
- [x] `notebooks/00_load_ndjson_backfill.py` rewritten: 1 widget (`ndjson_volume`), DSN-from-secret,
  plain `mode("append")`, FK load order. **Could not run on serverless** (platform fact #1 above).
- [x] `notebooks/00b_load_ndjson_local.py` (NEW, approved fallback): local psycopg `executemany`
  batch insert, 5000-row batches, `applied_tags`→Jsonb, FK order. Run via
  `LAKEBASE_DSN=$(...decode secret...) uv run --with 'psycopg[binary]' python .../00b_load_ndjson_local.py`.
- [x] **Lakebase loaded + verified**: `duplicate_clusters`=155, `issues`=40570, `replies`=233147,
  `theme_clusters`=0 (empty dump, skipped). **0 orphan replies, 0 orphan FK refs, 342 FK refs resolve.**
  Sample row sanity-check passed (jsonb `applied_tags` deserializes, status populated).

### Phase 2 — Spark analytics → Delta ✓ (2026-08-07)
- [x] `notebooks/02_compute_analytics.py` fixed: `CATALOG="workspace"`, DSN-from-secret + split creds
  (platform fact #2), **removed the overly-aggressive `.drop("owner_id")`** so `dashboard_global_metrics`
  `countDistinct("owner_id")` resolves.
- [x] Ran on serverless → 5 Delta tables in `workspace.discord`: `issues_enriched` (40570),
  `dashboard_issues_light` (40570), `dashboard_daily_stats` (1445 rows, 2022-08-11→2026-07-25),
  `dashboard_global_metrics` (1 channel row, `sum(total_issues)`=40570, `answered`=19449),
  `top_responders` (4712; top garyaustin 64048 replies/14413 issues).

## DONE this session (Phase 0, verified)
- [x] **0.1** UC schema `workspace.discord` created
  (`databricks schemas create discord workspace`). Owner jesse@agenticlab.com.au.
- [x] **0.2** `student` granted `USAGE, CREATE` on schema `discord` + `SELECT, INSERT, UPDATE, DELETE`
  on all tables in `discord`. (Deviated from plan: reused `student`, did NOT create a `discord` role.)
- [x] **0.3** Lakebase DDL `sql/01_lakebase_schema.sql` run via
  `databricks psql bootcamp-lakebase -- -f sql/01_lakebase_schema.sql` → SUCCESS.
  Tables: `duplicate_clusters, issues, replies, notes, theme_clusters` + views
  `issues_light, issue_notes_recent` + `set_updated_at()` trigger + 11 indexes. Owned by admin(jesse);
  `student` has full DML grants.
- [x] **0.4** UC managed volume `workspace.discord.raw` created
  (`databricks volumes create workspace discord raw MANAGED`), 4 NDJSON.gz uploaded via
  `databricks fs cp <f> dbfs:/Volumes/workspace/discord/raw/<f> --overwrite`. **Gotcha**: `databricks fs`
  requires the `dbfs:` scheme for UC volumes (bare `/Volumes/...` resolves to local macOS paths).
- [x] **0.9** Egress: confirmed blocked (known from M2/M3/M6 — `discord.com` will fail server-side).

## NOT done (resume here)
- **Probes A & C** — folded forward: Probe A (embeddings via `sentence-transformers` on serverless)
  is low-risk (proven M3, HF reachable) → test inside Phase 3. Probe C (`ChatDatabricks` +
  `langgraph.create_react_agent` import) → test inside Phase 5 (agent local REPL).
- **0.5 secret scope**: `database/lakebase-url` already covers Lakebase. Discord `auth_token` for
  notebook 01 is read locally from `discord-dashboard/.env` (notebook 01 runs locally due to egress),
  so no server-side secret scope needed for MVP. Skip unless wiring a scheduled job.

## NEXT STEPS (in order; deadline-driven, land MVP before bonus)
**Phases 1 & 2 are DONE — resume at Phase 3.** (Old Phase 1/2 detail kept below for reference.)

### Phase 3 — Embeddings + retrieval (Req 3) — pgvector primary ← RESUME HERE
1. Add to Lakebase: `discord.issue_embeddings (issue_id text PK FK→issues(id), embedding
   vector(1024), channel_id text, sentiment text, created_at timestamptz default now())` + HNSW
   index `vector_cosine_ops`. (Decide dim from Probe A: bge-large-en-v1.5 = 1024d; all-MiniLM = 384d.
   Pick whichever embeds cleanly on serverless — 384d proven M3, lower risk.) **Embeddings WRITE to
   Lakebase → cannot use Spark JDBC (platform fact #1). Either embed+write locally via psycopg, or
   embed on serverless to a UC Delta then load to Lakebase locally. Simplest: local psycopg loop
   over `discord.issues` using `sentence-transformers` (`uv run --with sentence-transformers`).**
2. Rewrite `notebooks/03_build_embeddings.py` pgvector branch: embed via `sentence-transformers`
   (HF reachable on serverless, M3-proven), upsert `::double precision[]`. Drop `ai_embed`/VS path
   to a commented bonus branch. Fix `CATALOG`.
3. `rag/retriever.py`: pgvector branch =
   `SELECT issue_id, 1-(embedding<=>q) score, channel_id, sentiment FROM discord.issue_embeddings
    ORDER BY embedding<=>q LIMIT k`. Keep VS branch behind an env flag for bonus.
4. Smoke test: `retrieve("RLS policy not working")` → ≥1 sensible hit.

### Phase 5 — Agent (Req 5 — the centerpiece; do before Phase 6)
1. `agent/tools.py`: DSN from env (`LAKEBASE_DSN`, decoded from `database/lakebase-url` secret).
   `dashboard_metrics` → read KPIs from **Lakebase via psycopg** (not the SQL warehouse) for MVP.
   `search_issues_sql`: add LIMIT guard + `statement_timeout`. Keep 4 read + 2 write tools
   (`semantic_search, search_issues_sql, get_issue_detail, dashboard_metrics,
   update_resolution_status, add_note`).
2. Local REPL: `python agent/agent.py chat` with env set. Verify each read tool, then **write tools**
   — `update_resolution_status` + `add_note` mutate Lakebase; verify via
   `databricks psql bootcamp-lakebase -- -c "select * from discord.notes where issue_id=…"` and
   `issues.resolution_status`. **This is the core acceptance (agent takes real write actions).**

### Phase 6 — Streamlit Databricks App (Req 4)
1. Refactor `app/app.py`: embed `build_agent()` in-process; read Lakebase via psycopg (issues/
   replies/notes + KPIs); **parameterize the `iid` query** (line ~158, currently string-interpolated
   → SQL injection); drop the served-endpoint HTTP call + `databricks.sql` reads.
2. `app/requirements.txt`: `streamlit`, `plotly`, `psycopg[binary]`, `langchain-databricks`,
   `langgraph`, `sentence-transformers`.
3. Deploy: `databricks apps create discord-capstone-app` + `--source ./app`; wire env
   (`LAKEBASE_DSN` from secret, embed model); grant the app SP secret-scope ACL on `database`
   (mirror M5 support-tickets deploy).
4. Verify live URL: KPI strip + 4 charts render from Lakebase; agent chat answers a read question
   ("most frustrating unresolved RLS issues?") AND a write ("mark issue <id> likely-resolved")
   → note/status appear in the table.

### Phase 4 + 7 — Local ingest, clustering, submission
1. `notebooks/01_ingest_discord_api.py`: make self-contained (own lakebase widgets / DSN-from-secret);
   run **locally** for a small batch (`max_threads=25`) to demonstrate the live Discord v9 API
   integration; bulk data stays from NDJSON. Document egress limitation in README.
2. `notebooks/04_cluster_duplicates.py`: rework — writes clusters to **Lakebase** via JDBC upsert
   (NOT `spark.sql("INSERT INTO discord.duplicate_clusters…")` which targets UC). For pgvector
   self-similarity: `ORDER BY embedding <=> (SELECT embedding FROM discord.issue_embeddings WHERE
   issue_id=…)`. Union-find, threshold 0.86, TOP_K=6. Run → clusters + `issues.duplicate_cluster_id`.
3. Update README + add a `STATUS.md` block: env specifics, egress limitation, pgvector-vs-VS
   decision, embedded-agent decision, CDC/endpoint-as-bonus.
4. Build submission ZIP (DDL + notebooks + agent + app + docs). **Secret-scan** for Discord token,
   Lakebase password, Databricks PAT (`rg` patterns + `git log -S`). 0 hits required.
5. **Bonus**: CDC streaming; MLflow-served agent endpoint; Mosaic Vector Search upgrade.

## Bugs already identified in the scaffolding (fix during the relevant phase)
- `notebooks/02,03,04`: `CATALOG="main"` → `"workspace"`.
- `notebooks/00,01`: JDBC MERGE via `df.limit(0).write.option("query",…)` doesn't run DML; lakebase
  widgets are over-specified (use DSN-from-secret instead). Notebook 01 also references notebook
  00's widgets (not self-contained).
- `notebooks/04`: writes to UC via `spark.sql("INSERT INTO discord.duplicate_clusters…")` but the
  table is in **Lakebase**; `similarity_search(query_filters={"id":…})` is wrong VS API.
- `app/app.py`: `iid` SQL injection at line ~158; reads Delta via SQL warehouse (→ Lakebase psycopg);
  calls a served agent endpoint (→ embed in-process).
- `agent/tools.py` `dashboard_metrics`: reads Delta via SQL warehouse (→ Lakebase psycopg for MVP).

## File map
- `sql/01_lakebase_schema.sql` — RUN ✓ (+ needs `issue_embeddings` pgvector table added for Phase 3).
- `notebooks/00_load_ndjson_backfill.py` — fix FK order + append-only + DSN-from-secret; run.
- `notebooks/01_ingest_discord_api.py` — self-contained; run locally.
- `notebooks/02_compute_analytics.py` — fix CATALOG; run serverless.
- `notebooks/03_build_embeddings.py` — pgvector branch; fix CATALOG; run.
- `notebooks/04_cluster_duplicates.py` — JDBC upsert to Lakebase; fix similarity query.
- `rag/retriever.py` — pgvector branch primary.
- `agent/{tools,agent,prompts}.py` — DSN env; `dashboard_metrics`→Lakebase; local REPL verify.
- `app/app.py` — embed agent; Lakebase psycopg; parameterize `iid`; deploy.
- `README.md` — the plan (update env/decision notes in Phase 7).

## Security (non-negotiable)
- Never log/persist the Discord auth token or Supabase service role key client-side.
- Secrets via Databricks secret scope / `dbutils.secrets`, never hardcoded.
- Secret-scan the submission ZIP before upload (Discord token, Lakebase password, Databricks PAT).
- Per CLAUDE.md: never `psql "postgresql://…"` inline (use MCP/`databricks psql`); never `curl`
  localhost; never inline `node -e`/`python3 -c` (write to /tmp and execute).
- Ponytail mode FULL: reuse over rebuild, shortest diff, no over-engineering. The DSN-from-secret
  refactor is the single highest-leverage simplification — apply it across notebooks 00/01/02.