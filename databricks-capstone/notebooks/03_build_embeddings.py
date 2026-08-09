# Databricks notebook source
# ============================================================
# 03_build_embeddings.py
# Build pgvector embeddings for semantic issue search (Req 3 — retrieval).
#
# Ports cloudflare-cron/src/embed.js:
#   buildEmbedText(issue)  →  name + first_message_content + "Tags: ..."
#   embedAndUpsert(env, i) →  Workers AI embed + Vectorize upsert
#
# PRIMARY backend = pgvector (HANDOFF decision 2): `all-MiniLM-L6-v2` (384d),
# proven in bootcamp M3. Embeds run locally with `sentence-transformers` and
# upsert into `discord.issue_embeddings` (created by sql/02_issue_embeddings.sql)
# over psycopg — because serverless BLOCKS generic Spark-JDBC writes to Lakebase
# (see HANDOFF platform fact #1). `huggingface.co` is reachable locally.
#
# Run locally (writes to Lakebase):
#   uv run --with 'sentence-transformers[[onnx]]' --with 'psycopg[binary]' \
#     --from databricks-sdk python databricks-capstone/notebooks/03_build_embeddings.py
#
#   LAKEBASE_DSN must be set; if absent it's read from the `database/lakebase-url`
#   secret via the Databricks SDK (base64-decoded). To set it manually instead:
#       export LAKEBASE_DSN='postgresql://student:...@host:5432/databricks_postgres?sslmode=require'
#
# Vector Search / Foundation Model API (`ai_embed(bge-large-en-v1.5)`) is the
# BONUS path — the commented branch at the bottom runs server-side and writes a
# UC Delta table; a Delta Sync index can then be built on it. Kept for Phase 7.
# ============================================================

import base64
import json
import os
import sys
from pathlib import Path

# This file doubles as a notebook source (magic comment on line 1) and a local
# script. When run as a script, Path/psycopg/sentence_transformers import below.
REPO_ROOT = Path(__file__).resolve().parents[2]


def get_dsn() -> str:
    dsn = os.environ.get("LAKEBASE_DSN")
    if dsn:
        return dsn
    # read + base64-decode the secret via the SDK (bootcamp/day1b/lakebase.py path)
    from databricks.sdk import WorkspaceClient
    sec = WorkspaceClient().secrets.get_secret(scope="database", key="lakebase-url")
    return base64.b64decode(sec.value).decode("utf-8")


def build_embed_text(name: str, body: str, applied_tags) -> str:
    """Port of buildEmbedText in cloudflare-cron/src/embed.js.

    [name]
    [first_message_content]
    Tags: [applied_tags joined with space]
    truncated to 8000 chars (same cap as the JS).
    """
    name = name or ""
    body = body or ""
    tags = ""
    if isinstance(applied_tags, list):
        tags = " ".join(str(t) for t in applied_tags)
    elif isinstance(applied_tags, str) and len(applied_tags) > 2:
        try:
            tags = " ".join(str(t) for t in json.loads(applied_tags))
        except Exception:
            tags = ""
    parts = [p for p in ([name, body, f"Tags: {tags}" if tags else ""]) if p]
    return "\n\n".join(parts)[:8000]


def main():
    import psycopg
    from sentence_transformers import SentenceTransformer

    MODEL = os.environ.get("DISCORD_EMBED_MODEL", "all-MiniLM-L6-v2")
    DIM = int(os.environ.get("DISCORD_EMBED_DIM", "384"))
    BATCH = int(os.environ.get("DISCORD_EMBED_BATCH", "256"))

    dsn = get_dsn()
    print(f"Loading embedding model {MODEL} (dim={DIM})...")
    model = SentenceTransformer(MODEL)

    print("Connecting to Lakebase and reading issues...")
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "select id, name, first_message_content, applied_tags, channel_id, sentiment "
            "from discord.issues"
        )
        rows = cur.fetchall()
        print(f"  {len(rows):,} issues to embed")

        # Build + filter embed text, group into batches.
        # `psycopg` adapts a python list to a PG array; for vector(384) we pass
        # the float list and cast ::vector.
        upsert_sql = (
            "insert into discord.issue_embeddings "
            "(issue_id, embedding, channel_id, sentiment, text) "
            "values (%s, %s::vector, %s, %s, %s) "
            "on conflict (issue_id) do update set "
            "embedding = excluded.embedding, channel_id = excluded.channel_id, "
            "sentiment = excluded.sentiment, text = excluded.text"
        )

        done = 0
        batch_rows, batch_texts, batch_meta = [], [], []
        for issue_id, name, body, tags, channel_id, sentiment in rows:
            text = build_embed_text(name, body, tags)
            if not text:
                continue
            batch_rows.append(issue_id)
            batch_texts.append(text)
            batch_meta.append((channel_id, sentiment))

            if len(batch_texts) >= BATCH:
                vecs = model.encode(batch_texts, show_progress_bar=False).tolist()
                # psycopg adapts python list[float] -> PG array; the %s::vector
                # cast lets Postgres build the pgvector from that array.
                params = [
                    (batch_rows[i], vecs[i], batch_meta[i][0], batch_meta[i][1], batch_texts[i])
                    for i in range(len(batch_rows))
                ]
                cur.executemany(upsert_sql, params)
                conn.commit()
                done += len(params)
                batch_rows, batch_texts, batch_meta = [], [], []
                print(f"  embedded+upserted {done:,} / {len(rows):,}", flush=True)

        if batch_texts:
            vecs = model.encode(batch_texts, show_progress_bar=False).tolist()
            params = [
                (batch_rows[i], vecs[i], batch_meta[i][0], batch_meta[i][1], batch_texts[i])
                for i in range(len(batch_rows))
            ]
            cur.executemany(upsert_sql, params)
            conn.commit()
            done += len(params)

        print(f"\n✓ Embedded + upserted {done:,} rows into discord.issue_embeddings")


# ============================================================
# BONUS path (Vector Search / Foundation Model API) — not run for MVP.
# Kept here for Phase 7. To use, run on serverless (reads from UC Delta,
# writes a UC Delta + builds a Delta Sync VS index). Requires the
# embeddings Delta + a Vector Search endpoint (VS_ENDPOINT).
# ============================================================
#
# from pyspark.sql import functions as F
# import mlflow.deployments
# CATALOG = "workspace"; SCHEMA = "discord"
# EMBED_MODEL = "bge-large-en-v1.5"        # Foundation Model API endpoint
# VS_ENDPOINT = ""                         # set to your workspace's VS endpoint
#
# issues = spark.table(f"{CATALOG}.{SCHEMA}.issues_enriched")
# @F.udf("string")
# def build_embed_text(name, body, applied_tags):
#     import json
#     name = name or ""; body = body or ""; tags = ""
#     if isinstance(applied_tags, list):
#         tags = " ".join(str(t) for t in applied_tags)
#     elif isinstance(applied_tags, str) and len(applied_tags) > 2:
#         try: tags = " ".join(str(t) for t in json.loads(applied_tags))
#         except Exception: pass
#     parts = [p for p in ([name, body, f"Tags: {tags}" if tags else ""]) if p]
#     return "\n\n".join(parts)[:8000]
# emb_df = (issues.select(F.col("id").alias("issue_id"), "channel_id", "sentiment",
#         build_embed_text("name","first_message_content","applied_tags").alias("text"))
#     .where(F.length("text") > 0)
#     .withColumn("embedding", F.expr(f"ai_embed(text, '{EMBED_MODEL}')"))
#     .withColumn("id", F.concat(F.lit("issue:"), F.col("issue_id"))))
# (emb_df.select("id","issue_id","channel_id","sentiment","text","embedding")
#    .write.format("delta").mode("overwrite")
#    .saveAsTable(f"{CATALOG}.{SCHEMA}.issue_embeddings"))

if __name__ == "__main__":
    main()
