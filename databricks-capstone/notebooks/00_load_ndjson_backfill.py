# Databricks notebook source
# ============================================================
# 00_load_ndjson_backfill.py
# One-time backfill: load the NDJSON dumps into Lakebase via Spark JDBC.
#
# Source dumps (already in the UC volume workspace.discord.raw):
#   issues.ndjson.gz            (40,570 rows)
#   replies.ndjson.gz           (233,147 rows)
#   duplicate_clusters.ndjson.gz(155 rows)
#   theme_clusters.ndjson.gz    (0 rows — empty payload, skipped)
#
# These are the exact normalized shape Lakebase expects (exported from the
# original hosted Postgres), so this is a straight append on PK into the tables
# created by sql/01_lakebase_schema.sql (run once in Phase 0).
#
# Design notes (see README.md "Setup — build order", step 2):
#   • Load order = FK order: duplicate_clusters → issues → replies. 342 of
#     40,570 issues carry a non-null duplicate_cluster_id in the dump, so the
#     parent clusters MUST exist first; replies FK onto issues likewise.
#     (Notebook 04 re-clusters over pgvector afterwards, taking this to 1,978
#     issues across 701 clusters — the figure quoted in README/DEMO.)
#   • Plain mode("append"). Tables are empty after the fresh DDL, so this is
#     a one-time insert — to re-run, truncate the tables first via
#       databricks psql bootcamp-lakebase -- \
#         -c "truncate discord.replies, discord.issues, discord.duplicate_clusters cascade"
#     The previous MERGE plumbing (df.limit(0).write.option("query", …)) never
#     executes DML and has been removed.
#   • Connection: the `database/lakebase-url` secret holds the full plaintext
#     Postgres DSN (postgresql://student:…@host:5432/databricks_postgres?sslmode=require).
#     Inside a notebook dbutils.secrets.get() returns it already decoded — do
#     NOT base64-decode (that's only for the SDK read path in
#     bootcamp/day1b/lakebase.py). The JDBC URL is simply "jdbc:" + dsn.
#   • stringtype=unspecified lets Postgres infer uuid/jsonb/timestamptz types
#     from the column instead of binding everything as a SQL VARCHAR.
# ============================================================

# ---------- widgets (override via the job/UI as needed) ----------
dbutils.widgets.text(
    "ndjson_volume",
    "/Volumes/workspace/discord/raw",
    "UC volume holding the .ndjson.gz files",
)

NDJSON_VOLUME = dbutils.widgets.get("ndjson_volume")

# ---------- Lakebase connection (DSN from the secret, no widgets) ----------
LAKEBASE_DSN = dbutils.secrets.get("database", "lakebase-url")
JDBC_URL = "jdbc:" + LAKEBASE_DSN  # jdbc:postgresql://student:…@host:5432/databricks_postgres?sslmode=require

# ---------- Lakebase JDBC writer ----------
def write_to_lakebase(df, table: str):
    """Append `df` into discord.{table} over JDBC.

    Plain append is sufficient for a one-time backfill into the empty tables
    from sql/01_lakebase_schema.sql. Re-runs require truncating first (see the
    header note). stringtype=unspecified defers uuid/jsonb/timestamptz typing
    to the column so Spark's default String binding doesn't fight the schema.
    """
    (df.write.format("jdbc")
        .option("url", JDBC_URL)
        .option("dbtable", f"discord.{table}")
        .option("stringtype", "unspecified")
        .mode("append").save())

def load_ndjson(file_name: str):
    """Read one NDJSON.gz file from the UC volume (one JSON object per line)."""
    return (spark.read
              .option("wholetext", "false")
              .json(f"{NDJSON_VOLUME}/{file_name}"))

# ---------- 1. duplicate_clusters (155 rows; parents first) ----------
dupes = load_ndjson("duplicate_clusters.ndjson.gz")
dupe_count = dupes.count()
print(f"duplicate_clusters rows: {dupe_count}")
if dupe_count > 0:
    write_to_lakebase(dupes, "duplicate_clusters")
    print(f"✓ appended {dupe_count} rows into discord.duplicate_clusters")

# ---------- 2. issues (40,570 rows) ----------
# applied_tags arrives as a JSON array (sometimes stringified, sometimes a real
# array) — normalize to a jsonb-friendly string. Other columns map 1:1 to the
# schema.
from pyspark.sql.functions import col, to_json, lit, when

issues_raw = load_ndjson("issues.ndjson.gz")
issue_count = issues_raw.count()
print(f"issues rows: {issue_count}")

if "applied_tags" in issues_raw.columns:
    issues = issues_raw.withColumn(
        "applied_tags",
        when(col("applied_tags").isNull(), lit("[]"))
        .otherwise(to_json(col("applied_tags"))),
    )
else:
    issues = issues_raw.withColumn("applied_tags", lit("[]"))

write_to_lakebase(issues, "issues")
print(f"✓ appended {issue_count} rows into discord.issues")

# ---------- 3. replies (233,147 rows; children last) ----------
replies = load_ndjson("replies.ndjson.gz")
reply_count = replies.count()
print(f"replies rows: {reply_count}")
write_to_lakebase(replies, "replies")
print(f"✓ appended {reply_count} rows into discord.replies")

# ---------- theme_clusters ----------
# The dump is an empty payload (0 rows); load only if the file has data.
themes = load_ndjson("theme_clusters.ndjson.gz")
theme_count = themes.count()
if theme_count > 0:
    write_to_lakebase(themes, "theme_clusters")
    print(f"✓ appended {theme_count} rows into discord.theme_clusters")
else:
    print(f"theme_clusters: {theme_count} rows in the dump — skipped")

print(f"\nBackfill complete. Verify: duplicate_clusters={dupe_count}, "
      f"issues={issue_count}, replies={reply_count}.")
