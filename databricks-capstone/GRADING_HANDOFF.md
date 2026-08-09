# Grading Handoff — Databricks AI Capstone (Discord Solution Data Engine)

**Last updated:** 2026-08-09 · **Deadline:** Sun 9 Aug 2026, 22:00 Australia/Adelaide (today)
**Project:** `databricks-capstone/` — a Databricks port of the Discord support-forum analytics
solution, built to satisfy every requirement of the "Rise of the AI Data Engineer" capstone.
**App (live):** https://discord-capstone-app-7474644913988012.aws.databricksapps.com

This handoff is the single document for grading prep: the **criteria**, the **scoring rubric**,
the **submission-format rules** (the thing that cost points last time), and **current status /
remaining work**.

---

## 1. Capstone criteria — the 5 mandatory requirements

Source: capstone README. **Every** project must include all five. Verified against live code +
deployment 2026-08-09.

| # | Requirement (verbatim) | Where it lives | Verification |
|---|---|---|---|
| 1 | **A data pipeline in Spark** | `notebooks/02_compute_analytics.py` | `pyspark.sql`, JDBC read from Lakebase, `.write.format("delta")` → 5 Delta tables in `workspace.discord` (`issues_enriched` 40570, `dashboard_issues_light`, `dashboard_daily_stats` 1445, `dashboard_global_metrics`, `top_responders` 4712). Ran on serverless. ✅ |
| 2 | **Integration with at least one third-party API** | `notebooks/01_ingest_discord_api.py` | Real `requests` calls to `discord.com/api/v9` (`threads/search`, `post-data`, `messages`). Self-contained, env-based config. **Code is the deliverable** — `discord.com` is egress-blocked from serverless/Apps, so live ingest runs locally; bulk data loaded from NDJSON. ✅ |
| 3 | **Processing of unstructured data (→ retrieval)** | `notebooks/03_build_embeddings.py`, `rag/retriever.py`, `notebooks/04_cluster_duplicates.py` | `SentenceTransformer` (all-MiniLM-L6-v2, 384d) embeds issue title+body+tags → pgvector `discord.issue_embeddings` (40,570 rows, HNSW cosine); semantic search smoke-tested (RLS query → 0.778); near-duplicate clustering via pgvector self-similarity + union-find, threshold 0.86. ✅ |
| 4 | **A Databricks App with a frontend** | `app/app.py` + `app.yaml` | Streamlit app: KPI strip (40570 issues / 19048 users / 306922 msgs / 19469 answered / 11541 resolved / 48% rate), 4 plotly charts, issues table, agent chat. Deployed & **RUNNING** (deployment `01f193a5582e162ca48c032c7ee106a3`, SUCCEEDED). ✅ |
| 5 | **An AI agent that does stuff (search/retrieve + real write actions)** | `agent/{tools,agent,prompts}.py` | LangGraph `create_react_agent` driven by `databricks-llama-4-maverick` via AI Gateway. **6 tools: 4 read + 2 write**. WRITE tools mutate real rows: `update_resolution_status` (UPDATE `discord.issues`), `add_note` (INSERT `discord.notes`). Full ReAct loop verified end-to-end. ✅ |

Shared skeleton that the rubric also rewards: **relational tables in Lakebase** (`sql/01_lakebase_schema.sql`: issues, replies, notes, duplicate_clusters, theme_clusters + views), **embeddings over unstructured text** for semantic retrieval, and a **read+write tool-using agent**.

---

## 2. Scoring rubric

### 2a. How grading works
- Submission is a **ZIP**, reviewed by a ChatGPT-based grader.
- The grader checks the **5 universal requirements** (above) plus a **project-specific rubric**
  (per-project functional requirements: API integration, Lakebase tables, context engineering,
  agent read/write capabilities).
- **Hard blockers = automatic failure:** hardcoded secrets/keys, fewer than 3 tools, reusing a
  provided MCP server instead of building one, missing server code. → **None apply here** (secret
  scan clean; 6 tools; Discord agent is net-new, not reused; all code present).

### 2b. Reference rubric (the weather capstone, scored 97/100 — included as the format template)
This is the rubric shape a grader applies. Map each dimension onto this Discord capstone:

| Dimension (weather rubric, weight) | What it rewarded | Equivalent in THIS capstone |
|---|---|---|
| **Server correctness — 30** | 5 tools + Args/Returns docstrings; HTTP/parsing in a broker layer (tools are thin); streamable HTTP; errors as `{error,hint}` | 6 tools (4 read + 2 write), each `@tool`-docstringed in `agent/tools.py`; Lakebase/SQL logic in `tools.py` (tools are thin over psycopg); errors surface as `{ok, error, hint}`; LLM-driven ask-to-clarify via system prompt |
| **Prediction/recommendation logic — 15** | derived decision logic (thresholds) + rationale surfaced in response + README | Triage decisions: `update_resolution_status` re-classification with `reason`; `semantic_search` ranking by cosine score; rationale in `agent/prompts.py` + README |
| **Secrets & security — 15** | no keys committed; config from Databricks secrets at runtime | DSN from `database/lakebase-url` secret scope (`app.yaml.txt`); Discord token local-env only; **secret scan of ZIP = 0 hits** |
| **Agent configuration — 20** | MCP/UC wiring + system prompt routing + guardrails + behavior matches guardrails | Agent embedded in Streamlit app (in-process LangGraph); `prompts.py` gives read-before-write routing + "don't invent data" + ID-quoting guardrails; behavior matches (Turn 4 in DEMO.md) |
| **Documentation & deployment — 10** | README (architecture/tools/error contract/deployment) + `requirements.txt`/`app.yaml` pinned | `README.md` (12KB) + `docs/architecture.md` + `docs/design-decisions.md`; `app.yaml.txt` + `requirements.txt` (app) pinned for Databricks Apps |
| **Demonstration — 10** | ≥3 distinct Q&A demos with tool calls + final answers, screenshots | `DEMO.md` = 4 turns mapped to requirements; **screenshots + live transcripts NOT yet captured** ← the one open item |

**Predicted self-score (once screenshots/transcripts are filled in): ~95–98/100.** The only
soft spots are (a) the demo artifacts aren't captured yet, and (b) one model-behavior risk
(see §5 — `databricks-llama-4-maverick` occasionally emits a pseudo tool call as plain text; same
issue flagged in the weather rubric).

---

## 3. Submission-format constraints — CRITICAL (this caused point loss before)

The ChatGPT grader **silently skips** any file not in a supported format. Last submission's
rejections were `.mp4`, `.lock`, and ~40 `.tsx` files. This submission is rebuilt so **every file
is readable**.

**Supported formats:**
- Documents: PDF or plain text (`.txt`, `.md`, `.rtf`)
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`
- Wrapper: `.zip` (or a single image)

**This submission's handling** (`databricks-capstone-submission.zip`, 29 files):
- `.md` (7) — README, architecture, design-decisions, HANDOFF, notes, **DEMO.md** → readable
- `.txt` (16) — all `.py`/`.sql`/`.yaml` renamed `*.py.txt` / `*.sql.txt` / `*.yaml.txt` (ends in
  `.txt` = readable; stem keeps the language so the grader knows it's Python/SQL)
- `.pdf` — dropped the redundant `README copy.pdf` (README.md is canonical)
- **No** `.mp4`, `.lock`, `.tsx`, or raw `.py`/`.sql`/`.yaml` that the grader would skip

**Secret scan of the ZIP:** 0 hits (Discord token, Lakebase password, Databricks PAT patterns) —
the only `service_role` occurrence is a SQL comment explaining the RLS model, not a key.

---

## 4. Current deployment status (verified 2026-08-09 14:02)

- **App:** `discord-capstone-app` — state `RUNNING`, compute `ACTIVE`, "App is running"
- **URL:** https://discord-capstone-app-7474644913988012.aws.databricksapps.com
- **Latest deployment:** `01f193a5582e162ca48c032c7ee106a3` (SNAPSHOT, SUCCEEDED)
- **Source on workspace:** `/Workspace/Users/jesse@agenticlab.com.au/discord-capstone-app`
  (agent/ synced 2026-08-09 with the langgraph fix)
- **Auth:** Databricks SSO — the URL 302s to the OAuth consent page; open it in a browser logged
  into the `dbc-3f25e26b-55a4` workspace.

### Bug fixed this session (was blocking the agent)
`agent/agent.py` passed `prompt=build_system_prompt()` to `create_react_agent()`, but the pinned
`langgraph==0.2.34` **predates the `prompt` kwarg** (added in 0.2.40+/1.x) → app dashboard
rendered but the 🤖 Triage Agent panel threw
`create_react_agent() got an unexpected keyword argument 'prompt'`.

**Fix:** `prompt=` → `state_modifier=` (the 0.2.x param; a string is auto-wrapped as the system
message). Code-only change → requirements unchanged → redeploy reused the cached dependency
layer (no 4-min torch rebuild). Verified against langgraph 0.2.34 source
(`libs/langgraph/langgraph/prebuilt/chat_agent_executor.py`). Marked with a `# ponytail:`
comment flagging the version coupling — **re-evaluate if langgraph is bumped.**

### Known caveats (documented in README "Notes & caveats")
- **Heavy cold start (~4 min):** `app/requirements.txt` installs `sentence-transformers`→`torch`
  (genuinely needed — `semantic_search` embeds the query locally via pgvector; the Vector Search
  server-side-embed path is the unproven bonus alternative). Not a bug; budget time for first load.
- **Egress block:** `discord.com` blocked from serverless + Apps → live Discord ingest (notebook 01)
  + bulk embeddings (notebook 03) run **locally**; the Spark pipeline (notebook 02) runs serverless.
- **Model:** `databricks-llama-4-maverick` (frontier models Claude/GPT/GLM rate-limited to 0 on this
  paid trial). Occasional pseudo-tool-call-as-plain-text behavior — same risk the weather rubric
  flagged; mitigate by retrying the turn or pinning a different model via `DISCORD_AGENT_MODEL`.

---

## 5. DONE vs REMAINING (deadline is today)

### ✅ Done
- All 5 requirements implemented + verified against live Lakebase/Delta/app.
- App deployed & RUNNING; dashboard renders real data (KPIs, 4 charts, issues table).
- **langgraph `prompt`→`state_modifier` fix deployed** — agent panel error resolved.
- `DEMO.md` written (4 demo turns, each mapped to a requirement, with transcript + screenshot slots).
- Submission ZIP rebuilt format-compliant (all `.md`/`.txt`, no rejected types).
- Secret scan clean.

### ⏳ Remaining (before final submit — needs your browser session)
1. **Capture 5 screenshots** → save as `.png` into `databricks-capstone/screenshots/`:
   - `app_overview.png` (dashboard on load)
   - `turn1_dashboard.png` (KPIs + chart, after "How are we doing overall this month?")
   - `turn2_triage.png` (agent writes: `update_resolution_status` + `add_note` confirmed)
   - `turn3_sql.png` (`search_issues_sql` top responders + `duplicate_cluster_id` link)
   - `turn4_guardrail.png` (empty-result "I couldn't find any…" honesty)
2. **Paste the 4 live transcripts** into the `Transcript (replace with live output)` blocks in `DEMO.md`.
3. **Rebuild the ZIP** so it includes `screenshots/*.png` + filled `DEMO.md`:
   `bash /tmp/build_submission.sh` (add a `screenshots/` include first, or just re-run after adding
   the folder — the script copies all `.md`/`.txt`/`.pdf`/`.png` automatically).
4. **Commit** the `agent.py` fix + `DEMO.md` + `GRADING_HANDOFF.md` to git.
5. (Optional bonus) MLflow-served agent endpoint; Mosaic Vector Search upgrade; CDC streaming.

---

## 6. Important details / gotchas (read before touching anything)

- **Workspace catalog is `workspace`, NOT `main`** (scaffolding's `CATALOG="main"` was a bug).
- **Serverless blocks generic JDBC writes** (`df.write.format("jdbc")`) — Lakebase writes go via
  local psycopg (`notebooks/00b`, `03`, `04`). JDBC **reads** are fine (notebook 02).
- **JDBC reads need split creds**, not an embedded-cred URL (password has URL-special chars).
  Recipe in `notebooks/02_compute_analytics.py`: `urlparse(dsn)` → JDBC url without creds →
  `.option("user"/"password"/"ssl"/"driver")`.
- **`duplicate_cluster_id` is real** — 342/40,570 issues reference a cluster; FK-load order matters
  (duplicate_clusters → issues → replies).
- **`database/lakebase-url`** secret is base64-encoded full DSN, connects **as `student`** — reuse it,
  don't create a new `discord` role.
- **`databricks fs cp`** to UC volumes needs the `dbfs:` scheme (`dbfs:/Volumes/...`).
- **Deploy command:** `databricks apps deploy discord-capstone-app --source-code-path
  /Workspace/Users/jesse@agenticlab.com.au/discord-capstone-app --mode SNAPSHOT --auto-approve`
- **Sync local→workspace:** `databricks sync <local-dir> /Workspace/.../<dest-dir>` (incremental).
- **Ponytail FULL:** reuse over rebuild, shortest diff. The DSN-from-secret pattern is the single
  highest-leverage simplification across notebooks 00/01/02.
- **Security:** never log/persist the Discord token or Supabase service key client-side; secrets
  via Databricks secret scope / `dbutils.secrets`; secret-scan the ZIP before every upload.

---

## File map (quick)

```
databricks-capstone/
├── README.md                 ← requirements-mapping table + architecture + setup
├── GRADING_HANDOFF.md        ← THIS doc (criteria + rubric + format + status)
├── HANDOFF.md                ← build/session handoff (platform facts, phases, bugs)
├── DEMO.md                   ← 4 demo turns + screenshot/transcript slots  ⏳ fill in
├── databricks-capstone-submission.zip   ← format-compliant ZIP (rebuild after screenshots)
├── app.yaml.txt / requirements.txt / app/{app.py.txt, requirements.txt}
├── agent/{agent.py.txt, tools.py.txt, prompts.py.txt}   ← langgraph fix in agent.py
├── rag/retriever.py.txt
├── notebooks/{00,00b,01,02,03,04}.py.txt
├── sql/{01_lakebase_schema.sql.txt, 02_issue_embeddings.sql.txt}
└── docs/{architecture.md, design-decisions.md}
```