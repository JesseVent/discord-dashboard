# Databricks notebook source
# ============================================================
# 02_compute_analytics.py
# Build the analytics rollups as Delta tables in Unity Catalog (Req 1).
#
# Ports the Discord repo's Postgres *views* — these were views in Supabase but
# become materialized Delta tables here so the dashboard reads them cheaply:
#   supabase/migrations/20260720000002_dashboard_views.sql
#   supabase/migrations/20260720000003_dashboard_optimizations.sql
#     dashboard_issues_light, dashboard_daily_stats,
#     dashboard_global_metrics, top_responders_view
#
# Also recomputes response analytics for any issues that ingested replies but
# didn't get them computed at ingest time (ports discord-api.ts:computeResponseAnalytics).
#
# Reads Lakebase via Spark JDBC (reads ARE supported on serverless; the
# embedded-creds URL fails when the password contains URL-special chars, so we
# parse the DSN and pass user/password as separate options — verified working).
# Writes Delta to workspace.discord.* (writes to UC, not Lakebase — UC writes
# are fine on serverless).
#
# Run after notebook 00 (backfill). Catalog is `workspace` (the workspace
# default) — the scaffolding's `main` is a bug.
# ============================================================

from urllib.parse import urlparse

from pyspark.sql import functions as F
from pyspark.sql.window import Window

CATALOG = "workspace"
SCHEMA  = "discord"

# ---------- read Lakebase into Spark via JDBC ----------
# The `database/lakebase-url` secret holds the full plaintext Postgres DSN
# (postgresql://student:…@host:5432/databricks_postgres?sslmode=require). Inside
# a notebook dbutils.secrets.get() returns it already decoded — do NOT base64-
# decode (that's only for the SDK read path in bootcamp/day1b/lakebase.py).
# We embed no creds in the URL (the password has URL-special chars that break an
# embedded-cred URL); instead pass user/password as separate JDBC options.
_DSN = dbutils.secrets.get("database", "lakebase-url")
_P = urlparse(_DSN)
JDBC_URL = f"jdbc:postgresql://{_P.hostname}:{_P.port or 5432}/{_P.path.lstrip('/')}?sslmode=require"
LB_USER = _P.username
LB_PW = _P.password

def lakebase(table):
    return (spark.read.format("jdbc")
        .option("url", JDBC_URL)
        .option("dbtable", f"discord.{table}")
        .option("user", LB_USER)
        .option("password", LB_PW)
        .option("ssl", "true")
        .option("sslmode", "require")
        .option("driver", "org.postgresql.Driver")
        .load())

issues_df  = lakebase("issues")
replies_df = lakebase("replies")
print(f"loaded issues={issues_df.count()}, replies={replies_df.count()}")

# ---------- 1. enriched issues: recompute response analytics at scale ----------
# (Ingest notebook 01 already computes these; this recomputes from raw replies for
#  any issues loaded via the NDJSON backfill that didn't carry analytics.)
RESOLUTION_KEYWORDS = ("thank", "solved", "resolved", "fixed it", "worked", "works now", "perfect")
kw_pattern = "|".join(RESOLUTION_KEYWORDS)

# first reply per issue from a non-OP author
w = Window.partitionBy("issue_id").orderBy("timestamp")
first_other_reply = (
    replies_df
      .join(issues_df.select(F.col("id").alias("oid"), "owner_id"),
            replies_df.issue_id == F.col("oid"), "left")
      .where(F.col("author_id") != F.col("owner_id"))
      .withColumn("rn", F.row_number().over(w))
      .where("rn = 1")
      .select("issue_id",
              F.col("timestamp").alias("first_reply_ts"),
              F.col("author_id").alias("first_responder"))
)

# distinct responder count per issue (excluding OP)
responder_counts = (
    replies_df
      .join(issues_df.select(F.col("id").alias("oid"), "owner_id"),
            replies_df.issue_id == F.col("oid"), "left")
      .where(F.col("author_id") != F.col("owner_id"))
      .groupBy("issue_id")
      .agg(F.countDistinct("author_id").alias("responder_count_computed"))
)

# resolution keyword flag: does any reply mention a resolution keyword?
has_kw = (
    replies_df
      .where(F.lower("content").rlike(kw_pattern))
      .select("issue_id").distinct()
      .withColumn("likely_resolved", F.lit(True))
)

issues_enriched = (
    issues_df
      .join(first_other_reply, issues_df.id == first_other_reply.issue_id, "left")
      .join(responder_counts, issues_df.id == responder_counts.issue_id, "left")
      .join(has_kw, issues_df.id == has_kw.issue_id, "left")
      .withColumn("response_time_ms_calc",
                  F.when(F.col("first_reply_ts").isNotNull() & F.col("first_message_created_at").isNotNull(),
                         F.greatest(F.lit(0),
                           F.unix_timestamp("first_reply_ts").cast("long") * 1000
                           - F.unix_timestamp("first_message_created_at").cast("long") * 1000))
                   .otherwise(F.lit(None)))
      # only overwrite analytics where they are missing/unknown
      .withColumn("response_time_ms",
                  F.when(F.col("response_time_ms").isNull(), F.col("response_time_ms_calc"))
                   .otherwise(F.col("response_time_ms")))
      .withColumn("responder_count",
                  F.when(F.col("responder_count") == 0, F.coalesce(F.col("responder_count_computed"), F.lit(0)))
                   .otherwise(F.col("responder_count")))
      .withColumn("is_answered",
                  F.when(F.col("resolution_status") == "unknown",
                         (F.col("responder_count") > 0)).otherwise(F.col("is_answered")))
      .withColumn("resolution_status",
                  F.when(F.col("resolution_status") == "unknown",
                         F.when(F.col("likely_resolved").isNotNull(), F.lit("likely-resolved"))
                          .when(F.col("responder_count") > 0, F.lit("in-progress"))
                          .otherwise(F.lit("unanswered")))
                   .otherwise(F.col("resolution_status")))
      # keep owner_id — dashboard_global_metrics needs countDistinct("owner_id")
      .drop("oid", "issue_id", "first_reply_ts", "first_responder",
            "responder_count_computed", "likely_resolved", "response_time_ms_calc")
)

# write issues_enriched to Delta
(issues_enriched.write
   .format("delta").mode("overwrite")
   .saveAsTable(f"{CATALOG}.{SCHEMA}.issues_enriched"))
print(f"✓ {CATALOG}.{SCHEMA}.issues_enriched")

# ---------- 2. dashboard_issues_light ----------
# (ports the view: truncates first_message_content to 250 chars for cheap bulk loads)
light = issues_enriched.withColumn(
    "first_message_content",
    F.substring(issues_enriched["first_message_content"], 1, 250))
(light.write.format("delta").mode("overwrite")
    .saveAsTable(f"{CATALOG}.{SCHEMA}.dashboard_issues_light"))
print(f"✓ {CATALOG}.{SCHEMA}.dashboard_issues_light")

# ---------- 3. dashboard_daily_stats ----------
# per-day/channel rollup for the "Issues Over Time" chart
daily = (issues_enriched
    .groupBy(F.date_trunc("day", "created_at").alias("date"), "channel_id")
    .agg(F.count("*").alias("issue_count"),
         F.sum("message_count").alias("total_messages"),
         F.sum(F.when(F.col("is_answered"), 1).otherwise(0)).alias("answered_count"))
    .orderBy("date"))
(daily.write.format("delta").mode("overwrite")
    .saveAsTable(f"{CATALOG}.{SCHEMA}.dashboard_daily_stats"))
print(f"✓ {CATALOG}.{SCHEMA}.dashboard_daily_stats")

# ---------- 4. dashboard_global_metrics ----------
# single-row-per-channel KPI rollup (ports the PERCENTILE_CONT view)
global_metrics = (issues_enriched.groupBy("channel_id").agg(
    F.count("*").alias("total_issues"),
    F.sum(F.when(F.col("is_answered"), 1).otherwise(0)).alias("answered_issues"),
    F.sum("message_count").alias("total_messages"),
    F.sum(F.when(F.col("resolution_status") == "likely-resolved", 1).otherwise(0)).alias("resolved_issues"),
    F.avg("response_time_ms").alias("avg_response_time_ms"),
    F.expr("percentile_approx(response_time_ms, 0.5)").alias("median_response_time_ms"),
    F.sum(F.when(F.col("response_time_ms") <= 3600000, 1).otherwise(0)).alias("fast_response_count"),
    F.countDistinct("owner_id").alias("unique_users"),
    F.sum(F.when(F.col("archived"), 1).otherwise(0)).alias("archived_issues"),
))
(global_metrics.write.format("delta").mode("overwrite")
    .saveAsTable(f"{CATALOG}.{SCHEMA}.dashboard_global_metrics"))
print(f"✓ {CATALOG}.{SCHEMA}.dashboard_global_metrics")

# ---------- 5. top_responders_view ----------
# top community responders, excluding OP (ports the view)
top_responders = (replies_df
    .join(issues_df.select(F.col("id").alias("oid"), "channel_id", "owner_id"),
          replies_df.issue_id == F.col("oid"), "left")
    .where(F.col("author_id") != F.col("owner_id"))
    .groupBy("channel_id", "author_id", "author_username", "author_global_name")
    .agg(F.count("*").alias("reply_count"),
         F.countDistinct("issue_id").alias("issues_helped"))
    .orderBy(F.desc("reply_count")))
(top_responders.write.format("delta").mode("overwrite")
    .saveAsTable(f"{CATALOG}.{SCHEMA}.top_responders"))
print(f"✓ {CATALOG}.{SCHEMA}.top_responders")

print("Analytics rollups complete.")
