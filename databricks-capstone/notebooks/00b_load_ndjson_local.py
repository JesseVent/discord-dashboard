#!/usr/bin/env python3
# ============================================================
# 00b_load_ndjson_local.py
# Local fallback for 00_load_ndjson_backfill.py.
#
# WHY THIS EXISTS
#   The Spark-JDBC notebook (00) cannot run on serverless compute in this
#   workspace: serverless's edge check rejects generic `format("jdbc")` writes
#   with [UNSUPPORTED_DATA_SOURCE_WRITE] at analysis time (the named
#   `postgresql` connector is allowed, but the generic `JdbcRelationProvider`
#   that Spark uses is not). Confirmed empirically + per Databricks docs:
#   https://docs.databricks.com/aws/en/compute/serverless/limitations
#
#   Notebook 00 is just data LOADING; the Req-1 Spark pipeline is satisfied by
#   notebook 02 (Lakebase -> Delta rollups, which runs on serverless fine).
#   So loading locally over psycopg is acceptable and is the approved fallback.
#
# WHAT IT DOES
#   Reads the .ndjson.gz dumps from supabase/backups/hosted-discord-schema-2026-07-25/,
#   connects to Lakebase with the plaintext DSN decoded from the
#   `database/lakebase-url` secret, and bulk-INSERTs in FK order:
#     1. duplicate_clusters (155)   <- parents
#     2. issues          (40,570)   <- FK duplicate_cluster_id (342 non-null in the
#                                      dump; notebook 04 re-clusters over pgvector
#                                      afterwards and raises this to 1,978 / 701 clusters)
#     3. replies         (233,147)  <- FK issue_id
#   (theme_clusters.ndjson.gz is an empty payload -> skipped.)
#
# RUN (from the repo root):
#   uv run --with psycopg[binary] python databricks-capstone/notebooks/00b_load_ndjson_local.py
#
#   The DSN must be in LAKEBASE_DSN (plaintext `postgresql://...`). If absent
#   the script also accepts it via stdin (prompted, not echoed) so the password
#   never lands in shell history. To obtain it once:
#       # from a notebook cell:
#       print(dbutils.secrets.get("database", "lakebase-url"))
#       # or via the SDK (base64-decoded):
#       python -c "from databricks.sdk import WorkspaceClient; import base64; print(base64.b64decode(WorkspaceClient().secrets.get_secret(scope='database', key='lakebase-url').value).decode())"
# ============================================================

import gzip
import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

REPO_ROOT = Path(__file__).resolve().parents[2]  # discord-dashboard/
DUMP_DIR = REPO_ROOT / "supabase" / "backups" / "hosted-discord-schema-2026-07-25"

# (filename, table, columns-in-table-order) — column order matches
# sql/01_lakebase_schema.sql exactly so executemany binds positionally.
DUPLICATE_CLUSTERS_COLS = ["id", "name", "description", "issue_count", "created_at"]
ISSUES_COLS = [
    "id", "name", "channel_id", "guild_id", "owner_id", "owner_username",
    "owner_global_name", "owner_avatar", "created_at", "archived_at", "archived",
    "locked", "message_count", "member_count", "total_message_sent",
    "applied_tags", "first_message_id", "first_message_content",
    "first_message_author_id", "first_message_author_name", "first_message_created_at",
    "response_time_ms", "responder_count", "is_answered", "resolution_status",
    "sentiment", "sentiment_score", "sentiment_summary", "duplicate_cluster_id",
    "fetched_at", "updated_at",
]
REPLIES_COLS = [
    "id", "issue_id", "author_id", "author_username", "author_global_name",
    "content", "timestamp", "has_attachment", "attachment_count",
    "sentiment", "sentiment_score", "created_at",
]


def get_dsn() -> str:
    dsn = os.environ.get("LAKEBASE_DSN")
    if dsn:
        return dsn
    print("LAKEBASE_DSN not set. Paste the Lakebase DSN", file=sys.stderr)
    print("(postgresql://student:...@host:5432/databricks_postgres?sslmode=require):", file=sys.stderr, end=" ")
    return sys.stdin.readline().strip()


def read_ndjson_gz(path: Path):
    """Yield dict rows from a gzipped NDJSON file."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def normalize(row: dict, columns: list[str]) -> tuple:
    """Project + coerce a row to the column order the table expects.

    - missing keys -> None (so Postgres applies column defaults / null)
    - applied_tags -> Jsonb (psycopg serializes to ::jsonb)
    """
    out = []
    for c in columns:
        v = row.get(c)
        if c == "applied_tags":
            v = Jsonb(v if v is not None else [])
        out.append(v)
    return tuple(out)


def load_table(cur, file_name: str, table: str, columns: list[str], batch: int = 5000):
    path = DUMP_DIR / file_name
    if not path.exists():
        print(f"  skip {file_name}: not found at {path}")
        return 0
    # theme_clusters.gz is a 42-byte empty payload -> no lines -> 0 inserts.
    cols_sql = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    insert = f'INSERT INTO discord.{table} ({cols_sql}) VALUES ({placeholders})'

    n = 0
    buf = []
    for row in read_ndjson_gz(path):
        buf.append(normalize(row, columns))
        if len(buf) >= batch:
            cur.executemany(insert, buf)
            n += len(buf)
            buf = []
            print(f"  {table}: {n:,} rows...", flush=True)
    if buf:
        cur.executemany(insert, buf)
        n += len(buf)
    print(f"  {table}: inserted {n:,} rows total")
    return n


def main():
    dsn = get_dsn()
    print(f"Connecting to Lakebase...")
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            # Safety: abort the whole batch if anything violates (e.g. FK).
            conn.autocommit = False
            print("Loading in FK order (parents -> children):")
            n_dc = load_table(cur, "duplicate_clusters.ndjson.gz", "duplicate_clusters", DUPLICATE_CLUSTERS_COLS)
            n_is = load_table(cur, "issues.ndjson.gz", "issues", ISSUES_COLS)
            n_rp = load_table(cur, "replies.ndjson.gz", "replies", REPLIES_COLS)
            conn.commit()
            print(f"\n✓ Committed: duplicate_clusters={n_dc}, issues={n_is}, replies={n_rp}")


if __name__ == "__main__":
    main()
