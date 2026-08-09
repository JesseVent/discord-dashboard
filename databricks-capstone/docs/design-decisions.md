# Design Decisions

Rationale for the key choices. Each ties back to a capstone requirement and forward to
the artifact it shapes.

---

## 1. Lakebase (Postgres) for writes, Delta for reads — an OLTP/OLAP split

**Decision:** Keep `issues`, `replies`, `notes`, `duplicate_clusters`, `theme_clusters`
in **Lakebase** (Postgres). Snapshot/aggregate them into **Delta tables** in Unity
Catalog for the dashboard and embeddings pipeline.

**Why not just Delta everywhere?**
- The Discord schema uses **foreign keys with `on delete cascade`**, a `set_updated_at()`
  trigger, and `gen_random_uuid()` defaults. Delta/Parquet cannot express any of these.
- The **agent writes concurrently** with the ingest pipeline (e.g. `add_note`,
  `update_resolution_status`). Postgres row-level transactions + FK integrity make those
  writes safe; Delta append-only semantics would require manual de-dup/MERGE logic.
- The original solution is itself transactional Postgres (Supabase) — Lakebase is the
  most faithful port, preserving the schema's integrity guarantees.

**Why not just Lakebase everywhere?**
- Analytical scans over 40,570 issues × 233,147 replies are exactly what columnar Delta
  is built for. The dashboard's global-metrics / daily-stats rollups would hammer Postgres.
- **Vector Search requires a Delta source** for a Delta Sync index. The embeddings table
  must live in Delta (synced from Lakebase) for the index to auto-update.

**How they stay in sync:** notebook `02_compute_analytics` periodically reads Lakebase
and MERGEs into the Delta rollups. The embeddings Delta table (`issue_embeddings`) is
fed the same way by notebook `03`.

**Requirement served:** "relational tables in Lakebase."

---

## 2. Reuse the real data — NDJSON backfill on day one

**Decision:** The initial load (notebook `00`) ingests the NDJSON dumps already in
`../../supabase/backups/hosted-discord-schema-2026-07-25/` (40,570 issues / 233,147
replies), rather than scraping from scratch.

**Why:**
- Real volume makes every downstream piece meaningful — analytics rollups, clustering,
  Vector Search, and the agent all operate at a realistic scale the grader can see.
- Zero scraping risk: the Discord v9 endpoint uses a user token, is undocumented, and is
  rate-limited. A 40k+ backfill would take hours and risk the token.
- The dumps are already the exact normalized shape Lakebase expects (they were exported
  from the original hosted Postgres).

The live Discord ingest (notebook `01`) then runs incrementally on top, for ongoing
freshness and to demonstrate the **third-party-API-integration** requirement.

---

## 3. Embeddings: pgvector primary, Vector Search (Delta Sync) as the second backend

**Original decision:** replace Cloudflare Workers AI + Vectorize with the Databricks
Foundation Model API `bge-large-en-v1.5` and a Mosaic AI Vector Search **Delta Sync** index.

**Decision as shipped (revised during build):** `all-MiniLM-L6-v2` (384-d) into **pgvector**
in the same Lakebase database as the issue rows is the **default** backend; the Vector Search
Delta Sync index is provisioned and works, but sits behind `DISCORD_RETRIEVER_BACKEND=vs`.

**Why the revision.** The agent's two write tools (`update_resolution_status`, `add_note`)
run over psycopg against Lakebase. Keeping retrieval in the *same* database means a search
and the write it justifies share one connection and one transaction boundary — the agent
cannot retrieve from a store that has drifted from the store it writes to. A Delta Sync index
is, by construction, eventually consistent with Lakebase (Lakebase → Delta → index). For a
read-only RAG app that is fine; for an agent that mutates the rows it just retrieved it is a
real correctness gap, and closing it was worth more than the retrieval-quality delta between
MiniLM-384 and bge-large-1024.

Both paths are live: see `FEATURES.md` → *Vector Search* for the provisioned endpoint, index,
and the exact command that runs retrieval through it.

**Why `bge-large` for the Vector Search path and not the repo's `bge-base`?**
- Same model family → comparable embedding geometry, so the 0.86 cosine duplicate-
  detection threshold ports cleanly.
- `large` gives better retrieval quality for the agent's `semantic_search` tool; cost is
  trivial for ~40k one-time embeddings + incremental.

**Why Vector Search (Delta Sync) over the Worker's manual upsert loop?**
- Delta Sync indexes **auto-update** when the source Delta table changes — new issues
  flow into search with no explicit upsert call. The Discord repo had to hand-roll
  `embedAndUpsert` per issue and run a daily cron.
- It's the native Databricks RAG primitive — what the capstone is asking you to use.

**Text construction is identical** to `embed.js:buildEmbedText` —
`name + first_message_content + Tags` — so semantics match the original. Both backends embed
the same text, which is what makes the 0.86 duplicate threshold portable between them.

**Requirement served:** "unstructured-data retrieval (vector search / RAG)."

---

## 4. Agent is the net-new centerpiece

**Decision:** Build a LangGraph ReAct agent with six tools (four read, two write),
served via the AI Gateway and traced in MLflow. This component has **no equivalent** in
the Discord repo — the closest thing there is single-shot `chat.completions` calls for
theme clustering.

**Why this is the right place to invest:**
- The capstone explicitly asks for "an agent with tools that can both read and **take
  real actions (writes)** against your data." Every other requirement has a direct port;
  this one does not.
- The Discord domain gives the agent genuinely useful write actions: re-classify a
  resolution status, attach a triage note, flag a duplicate. These mutate Lakebase and
  show up immediately in the dashboard.

**Tool design:**
- **Read:** `semantic_search` (Vector Search), `search_issues_sql` (free-form safe SQL),
  `get_issue_detail` (issue + replies), `dashboard_metrics` (KPIs).
- **Write:** `update_resolution_status`, `add_note`.

**Why LangGraph + MLflow:** LangGraph's `create_react_agent` is the documented Databricks
agent pattern; MLflow Tracing gives the grader observable tool calls; the AI Gateway
gives governed serving. See `agent/agent.py`.

---

## 5. Streamlit for the app (not a port of the Next.js UI)

**Decision:** Build the Databricks App in Streamlit, rather than porting the React/
Recharts/shadcn dashboard.

**Why:**
- **Single language end-to-end** (Python) — the whole capstone stays in one stack, which
  matters for a graded project with limited time.
- **Native to Databricks Apps** — first-class deployment path, no build step.
- **`st.chat_message`** is the cleanest way to host the agent conversationally; the
  React app had no chat surface and would need one built from scratch.
- Plotly covers every chart type the original uses (area, bar, heatmap) with parity.

**What carries over conceptually** from `src/app/page.tsx` + `components/dashboard/`:
the KPI strip layout, the four-chart grid, the filter bar, and the issues table with a
detail expander (chat-style reply rendering). The Streamlit versions re-implement those
layouts; they don't share code with the React components.

---

## 6. Secrets via Databricks secret scope

**Decision:** The Discord auth token, Databricks PAT, and any model API keys are read
from `dbutils.secrets` / the secret scope — never hardcoded, never logged.

This replaces the Discord repo's pattern of env vars (`DISCORD_AUTH_TOKEN`) and
client-pasted tokens (held in Zustand). In a served Databricks context the secret scope
is the only correct place.

---

## 7. What we explicitly are *not* doing

- **Not porting the Cloudflare cron Worker.** Its two jobs (hourly sync ping, daily
  cluster) become Databricks Jobs notebooks. The Worker's separate `package.json`,
  `wrangler.jsonc`, and AI/Vectorize bindings are retired.
- **Not porting the Supabase Lite / PGlite local-SQLite notes feature.** Notes move
  server-side into Lakebase (`discord.notes`) so the agent can write them and every
  dashboard viewer sees them — the original was per-browser.
- **Not wiring next-auth / Supabase Auth.** The original had none either (the dependency
  was unused). The Databricks App inherits workspace auth.
- **Not fixing the Discord repo's missing LLM routes** (`/api/analyze-themes` etc.).
  Those 404 in the original; here their function is superseded by the agent + notebook 02.
