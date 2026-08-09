# Databricks notebook source
"""
05_cdf_change_analytics.py — Change Data Feed → change-analytics Delta table.

Reads the Change Data Feed of `workspace.discord.issues_enriched` (enabled and
MERGE-fed by notebook 02) and materialises `workspace.discord.issues_changes`:
one row per issue per commit in which a tracked column actually moved, with the
column names that moved and the before/after resolution status.

Why this exists, concretely: the agent's `update_resolution_status` tool writes
to Lakebase. Notebook 02 merges Lakebase into `issues_enriched`. CDF therefore
captures exactly the triage decisions the agent (or a human) made since the last
run — so "what changed, when, and who moved it" becomes a query rather than a
guess. That is the loop the dashboard could not close before: the app showed
state, never transitions.

Incremental by construction: it resumes from `MAX(_commit_version)` already in
`issues_changes`, so re-running is safe and cheap. First run backfills from the
earliest version CDF retains.

Runs on serverless (needs Spark + Unity Catalog for `readChangeFeed`). It also
upserts a small daily summary into Lakebase over psycopg, because the Streamlit
app reads Lakebase, not Delta — that summary is what the app's change chart
renders.

    databricks jobs submit ...  # or run as a notebook on serverless
"""

# COMMAND ----------

import base64
from urllib.parse import urlparse

from pyspark.sql import functions as F

CATALOG = "workspace"
SCHEMA = "discord"
ENRICHED = f"{CATALOG}.{SCHEMA}.issues_enriched"
CHANGES = f"{CATALOG}.{SCHEMA}.issues_changes"

# Must match notebook 02's TRACKED list — these are the columns whose movement
# counts as a change worth recording.
TRACKED = ["resolution_status", "is_answered", "response_time_ms",
           "responder_count", "message_count", "sentiment", "archived"]

# COMMAND ----------

# ---------- where to resume from ----------
# CDF versions are monotonic per table. Storing the high-water mark in the output
# table itself avoids a separate checkpoint to keep in sync (and to corrupt).
if spark.catalog.tableExists(CHANGES):
    start = spark.sql(f"SELECT COALESCE(MAX(_commit_version), -1) AS v FROM {CHANGES}").first()["v"]
    start_version = int(start) + 1
else:
    start_version = 0
print(f"reading change feed from version {start_version}")

# COMMAND ----------

# ---------- read the change feed ----------
# If the table has had no commits since the last run, Delta raises rather than
# returning empty, so treat "nothing new" as a clean no-op.
try:
    cdf = (spark.read.format("delta")
           .option("readChangeFeed", "true")
           .option("startingVersion", start_version)
           .table(ENRICHED))
except Exception as e:  # noqa: BLE001 — Delta signals "no such version" by exception
    if "versions" in str(e).lower() or "DELTA_" in str(e):
        print(f"no new commits since version {start_version - 1}; nothing to do")
        dbutils.notebook.exit("no-op")
    raise

pre = (cdf.where(F.col("_change_type") == "update_preimage")
          .select("id", "_commit_version",
                  *[F.col(c).alias(f"old_{c}") for c in TRACKED]))
post = (cdf.where(F.col("_change_type") == "update_postimage")
           .select("id", "_commit_version", "_commit_timestamp", "channel_id", "name",
                   *[F.col(c).alias(f"new_{c}") for c in TRACKED]))

# Inserts have no preimage — record them as their own operation rather than
# dropping them, so the table answers "new issues" as well as "changed issues".
ins = (cdf.where(F.col("_change_type") == "insert")
          .select("id", "_commit_version", "_commit_timestamp", "channel_id", "name",
                  *[F.col(c).alias(f"new_{c}") for c in TRACKED]))

# COMMAND ----------

# ---------- which columns actually moved ----------
paired = post.join(pre, ["id", "_commit_version"], "inner")

changed_arr = F.array_compact(F.array(*[
    F.when(~F.col(f"old_{c}").eqNullSafe(F.col(f"new_{c}")), F.lit(c))
    for c in TRACKED
]))

updates = (paired
    .withColumn("changed_cols", changed_arr)
    # A MERGE can touch a row without moving a tracked column; drop those so the
    # table means "something changed", not "something was rewritten".
    .where(F.size("changed_cols") > 0)
    .select(
        F.col("id").alias("issue_id"), "channel_id", "name",
        F.lit("update").alias("operation"),
        "changed_cols",
        F.col("old_resolution_status"), F.col("new_resolution_status"),
        F.col("_commit_timestamp").alias("changed_at"),
        "_commit_version",
    ))

inserts = (ins.select(
    F.col("id").alias("issue_id"), "channel_id", "name",
    F.lit("insert").alias("operation"),
    F.array().cast("array<string>").alias("changed_cols"),
    F.lit(None).cast("string").alias("old_resolution_status"),
    F.col("new_resolution_status"),
    F.col("_commit_timestamp").alias("changed_at"),
    "_commit_version",
))

out = updates.unionByName(inserts)
n = out.count()
print(f"{n} change rows (updates + inserts) from versions >= {start_version}")

# COMMAND ----------

# ---------- write the analytics table ----------
if n:
    (out.write.format("delta").mode("append").saveAsTable(CHANGES))
    print(f"✓ appended {n} rows to {CHANGES}")

    print("\nTop changed columns:")
    (spark.table(CHANGES)
       .select(F.explode("changed_cols").alias("col"))
       .groupBy("col").count().orderBy(F.desc("count")).show(10, False))

    print("Resolution-status transitions:")
    (spark.table(CHANGES)
       .where(F.col("operation") == "update")
       .groupBy("old_resolution_status", "new_resolution_status")
       .count().orderBy(F.desc("count")).show(10, False))
else:
    print("no tracked-column changes in this window")

# COMMAND ----------

# ---------- mirror a daily summary into Lakebase (the app reads Postgres) ----------
# The Delta table above is the analytics artifact; this small rollup is what the
# Streamlit app charts. Kept deliberately tiny — one row per day/channel/operation.
summary = (spark.table(CHANGES)
    .groupBy(F.to_date("changed_at").alias("change_date"), "channel_id", "operation")
    .agg(F.count("*").alias("change_count"),
         F.sum(F.when(F.array_contains(F.col("changed_cols"), "resolution_status"), 1)
                .otherwise(0)).alias("status_changes"))
    .orderBy("change_date"))

rows = [r.asDict() for r in summary.collect()]
print(f"{len(rows)} summary rows -> Lakebase")

if rows:
    import psycopg  # serverless has network access to Lakebase (same as notebook 02's JDBC read)

    _p = urlparse(base64.b64decode(
        dbutils.secrets.get(scope="database", key="lakebase-url")).decode())
    dsn = (f"postgresql://{_p.username}:{_p.password}@{_p.hostname}:{_p.port or 5432}"
           f"{_p.path}?sslmode=require")

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS discord.issues_changes (
              change_date    date    not null,
              channel_id     text    not null,
              operation      text    not null,
              change_count   integer not null,
              status_changes integer not null default 0,
              primary key (change_date, channel_id, operation)
            )""")
        cur.executemany("""
            INSERT INTO discord.issues_changes
              (change_date, channel_id, operation, change_count, status_changes)
            VALUES (%(change_date)s, %(channel_id)s, %(operation)s,
                    %(change_count)s, %(status_changes)s)
            ON CONFLICT (change_date, channel_id, operation) DO UPDATE SET
              change_count = excluded.change_count,
              status_changes = excluded.status_changes
        """, rows)
        conn.commit()
    print(f"✓ upserted {len(rows)} rows into discord.issues_changes")

print("CDF change analytics complete.")
