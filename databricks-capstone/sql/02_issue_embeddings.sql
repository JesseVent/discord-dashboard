-- ============================================================
-- 02_issue_embeddings.sql
-- pgvector table for semantic issue search (Req 3 — retrieval).
--
-- Primary retrieval backend (HANDOFF decision 2): pgvector with an HNSW
-- cosine index. The model is `all-MiniLM-L6-v2` (384d) — proven in bootcamp
-- M3, lower-risk on serverless than bge-large (1024d), and fast to embed
-- locally on 40,570 issues. Mosaic Vector Search is the bonus path (kept
-- behind an env flag in rag/retriever.py).
--
-- Run on Lakebase (psql as admin/student both have the needed grants):
--   databricks psql bootcamp-lakebase -- -f sql/02_issue_embeddings.sql
-- ============================================================

-- pgvector ships enabled on bootcamp-lakebase (PG16); ensure the ext is present.
create extension if not exists vector;

-- One row per issue. issue_id is both PK and FK -> issues(id) on delete cascade,
-- so embeddings stay in lockstep with the issues table.
create table if not exists discord.issue_embeddings (
  issue_id    text primary key references discord.issues(id) on delete cascade,
  embedding   vector(384) not null,
  channel_id  text,
  sentiment   text,
  text        text not null default '',         -- the embedded text (name+body+tags)
  created_at  timestamptz not null default now()
);

-- HNSW cosine index for fast top-K (pgvector <=> is cosine distance).
create index if not exists idx_issue_embeddings_hnsw
  on discord.issue_embeddings using hnsw (embedding vector_cosine_ops);

-- Helpful secondary indexes for filtered retrieval.
create index if not exists idx_issue_embeddings_channel_id
  on discord.issue_embeddings (channel_id);
