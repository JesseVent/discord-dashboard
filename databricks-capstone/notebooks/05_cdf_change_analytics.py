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

# Serverless images do not ship psycopg (notebooks 03/04 use it, but they run
# locally). The Lakebase mirror at the end of this notebook needs it. Installed
# via pip-as-a-module rather than the `%pip` magic so this file stays valid
# Python — it is linted and ast-parsed like every other notebook in this repo.
import subprocess
import sys

subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet",
                       "psycopg[binary]==3.2.4"])

# COMMAND ----------

import json
from urllib.parse import urlparse

from pyspark.sql import functions as F

# Job runs surface a notebook's exit value but not its stdout, so every fact
# worth knowing goes in here and leaves via dbutils.notebook.exit(). Debugging a
# serverless run through print() alone is guesswork.
summary: dict = {}


def done(status: str) -> None:
    summary["status"] = status
    print(json.dumps(summary, indent=2, default=str))
    dbutils.notebook.exit(json.dumps(summary, default=str))

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
# Two lower bounds have to be respected, and getting either wrong fails the run:
#
#   1. our own high-water mark — MAX(_commit_version) already in `issues_changes`,
#      so re-running is incremental. Kept in the output table itself rather than a
#      side checkpoint, so there is nothing separate to corrupt.
#   2. the version at which CDF was switched on. Delta records change data only
#      from that commit forward; asking for anything earlier raises
#      DELTA_MISSING_CHANGE_DATA rather than returning empty. On a table that
#      existed before CDF was enabled (ours did — notebook 02 ALTERs it), version 0
#      predates the feed, so a naive `startingVersion=0` always fails.
#
# Resolve both up front. Deliberately not left to a try/except around the read:
# `spark.read...table()` is lazy, so the error would surface at the first action,
# well outside any handler wrapped around the read itself.
history = spark.sql(f"DESCRIBE HISTORY {ENRICHED}")
latest_version = history.agg(F.max("version")).first()[0]

_enable_commits = (history
    .where(F.lower(F.col("operationParameters").cast("string")).contains("enablechangedatafeed"))
    .agg(F.max("version")).first()[0])
cdf_from = int(_enable_commits) if _enable_commits is not None else 0

if spark.catalog.tableExists(CHANGES):
    seen = spark.sql(f"SELECT COALESCE(MAX(_commit_version), -1) AS v FROM {CHANGES}").first()["v"]
    start_version = int(seen) + 1
else:
    start_version = 0

start_version = max(start_version, cdf_from)
summary.update(cdf_enabled_at=cdf_from, latest_version=int(latest_version),
               reading_from=start_version,
               changes_table_existed=spark.catalog.tableExists(CHANGES))
print(f"CDF enabled at v{cdf_from}; table at v{latest_version}; reading from v{start_version}")

no_new_commits = start_version > latest_version

# COMMAND ----------
# COMMAND ----------

# ---------- read the feed and build the change rows ----------
# All of this is guarded on there being new commits, but the notebook still falls
# through to the Lakebase mirror below — that is what lets a mirror that failed on
# an earlier run catch up instead of being stranded behind a "no new commits" exit.
def collect_changes():
    """Return the change rows for (start_version, latest_version], or None."""
    cdf = (spark.read.format("delta")
           .option("readChangeFeed", "true")
           .option("startingVersion", start_version)
           .option("endingVersion", int(latest_version))
           .table(ENRICHED))

    pre = (cdf.where(F.col("_change_type") == "update_preimage")
              .select("id", "_commit_version",
                      *[F.col(c).alias(f"old_{c}") for c in TRACKED]))
    post = (cdf.where(F.col("_change_type") == "update_postimage")
               .select("id", "_commit_version", "_commit_timestamp", "channel_id", "name",
                       *[F.col(c).alias(f"new_{c}") for c in TRACKED]))
    # Inserts have no preimage — recorded as their own operation rather than
    # dropped, so the table answers "new issues" as well as "changed issues".
    ins = (cdf.where(F.col("_change_type") == "insert")
              .select("id", "_commit_version", "_commit_timestamp", "channel_id", "name",
                      *[F.col(c).alias(f"new_{c}") for c in TRACKED]))

    changed_arr = F.array_compact(F.array(*[
        F.when(~F.col(f"old_{c}").eqNullSafe(F.col(f"new_{c}")), F.lit(c))
        for c in TRACKED
    ]))

    updates = (post.join(pre, ["id", "_commit_version"], "inner")
        .withColumn("changed_cols", changed_arr)
        # A MERGE can rewrite a row without moving a tracked column; drop those so
        # the table means "something changed", not "something was touched".
        .where(F.size("changed_cols") > 0)
        .select(
            F.col("id").alias("issue_id"), "channel_id", "name",
            F.lit("update").alias("operation"), "changed_cols",
            F.col("old_resolution_status"), F.col("new_resolution_status"),
            F.col("_commit_timestamp").alias("changed_at"), "_commit_version"))

    inserts = ins.select(
        F.col("id").alias("issue_id"), "channel_id", "name",
        F.lit("insert").alias("operation"),
        F.array().cast("array<string>").alias("changed_cols"),
        F.lit(None).cast("string").alias("old_resolution_status"),
        F.col("new_resolution_status"),
        F.col("_commit_timestamp").alias("changed_at"), "_commit_version")

    summary.update(raw_cdf_rows=cdf.count(),
                   updates=updates.count(), inserts=inserts.count())
    return updates.unionByName(inserts)


if no_new_commits:
    print("no new commits since the last run; skipping the feed read")
    summary["change_rows"] = 0
else:
    out = collect_changes()
    n = out.count()
    summary["change_rows"] = n
    print(f"{n} change rows from versions [{start_version}, {latest_version}]")

    if n:
        out.write.format("delta").mode("append").saveAsTable(CHANGES)
        print(f"\u2713 appended {n} rows to {CHANGES}")

        print("\nTop changed columns:")
        (spark.table(CHANGES).select(F.explode("changed_cols").alias("col"))
           .groupBy("col").count().orderBy(F.desc("count")).show(10, False))
        print("Resolution-status transitions:")
        (spark.table(CHANGES).where(F.col("operation") == "update")
           .groupBy("old_resolution_status", "new_resolution_status")
           .count().orderBy(F.desc("count")).show(10, False))


# ---------- mirror a daily summary into Lakebase (the app reads Postgres) ----------
# The Delta table above is the analytics artifact; this rollup is what the
# Streamlit app charts (it reads Postgres, not Delta). One row per
# day/channel/operation — deliberately tiny.
#
# A function, and called on the no-op path too. The rollup is derived from the
# WHOLE changes table and upserted on its primary key, so re-running it is cheap
# and idempotent. Without that, a mirror that fails once — it did; serverless
# ships no psycopg — leaves the Delta rows permanently stranded from the app,
# because every later run short-circuits as "no new commits" before reaching it.
def mirror_to_lakebase() -> None:
    if not spark.catalog.tableExists(CHANGES):
        summary["lakebase_upsert"] = "skipped: no changes table yet"
        return

    daily = (spark.table(CHANGES)
        .groupBy(F.to_date("changed_at").alias("change_date"), "channel_id", "operation")
        .agg(F.count("*").alias("change_count"),
             F.sum(F.when(F.array_contains(F.col("changed_cols"), "resolution_status"), 1)
                    .otherwise(0)).alias("status_changes"))
        .orderBy("change_date"))

    rows = [r.asDict() for r in daily.collect()]
    summary["lakebase_rows"] = len(rows)
    if not rows:
        summary["lakebase_upsert"] = "skipped: nothing to mirror"
        return

    import psycopg  # installed by the pip cell above; not in the serverless base image

    # Inside a notebook dbutils.secrets.get() returns the DSN ALREADY decoded —
    # do NOT base64-decode it. (That is only for the SDK path, where
    # secrets.get_secret().value is base64 for transport.) Same warning as
    # notebooks/02 and /00; getting it wrong yields
    # "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xa6".
    _p = urlparse(dbutils.secrets.get("database", "lakebase-url"))

    # Discrete connection kwargs rather than re-embedding credentials in a URL:
    # the password contains URL-special characters (see notebook 02's JDBC note),
    # so round-tripping it through a DSN string is a needless way to break it.
    with psycopg.connect(host=_p.hostname, port=_p.port or 5432,
                         dbname=_p.path.lstrip("/"), user=_p.username,
                         password=_p.password, sslmode="require") as conn, conn.cursor() as cur:
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

    summary["lakebase_upsert"] = "ok"
    print(f"\u2713 upserted {len(rows)} rows into discord.issues_changes")


mirror_to_lakebase()
done("complete")
