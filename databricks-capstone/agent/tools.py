"""
agent/tools.py — the agent's read + write tools over Lakebase and Vector Search.

This is the net-new component of the capstone: the Discord repo had only single-shot
LLM calls (theme clustering), no tool-using agent that can both investigate and
take real actions against the data.

Every tool documents Args/Returns and returns a uniform {error, hint} on failure
rather than raising, so a failed call is an observation the ReAct loop can act on.

Six tools (4 read, 2 write):
  READ
    semantic_search        — pgvector search over issue embeddings (rag/retriever.py)
    search_issues_sql      — safe, read-only SQL against Lakebase (LIMIT + timeout)
    get_issue_detail       — one issue + its replies (chat-style)
    dashboard_metrics      — KPI rollups computed live over discord.issues
  WRITE
    update_resolution_status — re-classify an issue (unanswered|in-progress|likely-resolved|unknown)
    add_note                 — attach a triage note the dashboard renders

All data access is psycopg against Lakebase (single self-contained process; no
SQL-warehouse creds needed). Embeddings live in discord.issue_embeddings (pgvector).
"""

from __future__ import annotations
import os
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

import psycopg
from langchain_core.tools import tool

from rag.retriever import retrieve

# ---------- Lakebase connection ----------
# LAKEBASE_DSN is the full plaintext Postgres DSN
# (postgresql://student:...@host:5432/databricks_postgres?sslmode=require). When
# unset we read it from the `database/lakebase-url` secret via the SDK
# (base64-decoded — same as bootcamp/day1b/lakebase.py). This lets the agent run
# both locally (env var set) and inside Databricks Apps (SDK auth as the app SP).
def _resolve_dsn() -> str:
    dsn = os.environ.get("LAKEBASE_DSN")
    if dsn:
        return dsn
    import base64
    from databricks.sdk import WorkspaceClient
    scope = os.environ.get("LAKEBASE_SECRET_SCOPE", "database")
    key = os.environ.get("LAKEBASE_SECRET_KEY", "lakebase-url")
    sec = WorkspaceClient().secrets.get_secret(scope=scope, key=key)
    return base64.b64decode(sec.value).decode("utf-8")


LAKEBASE_DSN = _resolve_dsn()

# Per-query cap so an agent-authored SELECT can't run an unbounded scan.
SQL_ROW_LIMIT = 500
SQL_TIMEOUT_MS = 10_000  # abort any single agent query after 10s

def _conn() -> psycopg.Connection:
    return psycopg.connect(LAKEBASE_DSN)


def _rows(cur) -> list[dict]:
    """Fetch all rows as dicts with JSON-safe values.

    psycopg hands back Decimal and datetime objects, which reach the LLM as
    `Decimal('216022053')` / `datetime.datetime(2026, 7, 25, …)`. Models
    misread those reprs — coerce to plain numbers and ISO strings so a tool
    result is never ambiguous.
    """
    cols = [c.name for c in cur.description]
    out = []
    for row in cur.fetchall():
        rec = {}
        for k, v in zip(cols, row):
            if isinstance(v, Decimal):
                rec[k] = float(v)
            elif isinstance(v, (datetime, date)):
                rec[k] = v.isoformat()
            elif isinstance(v, UUID):
                rec[k] = str(v)
            else:
                rec[k] = v
        out.append(rec)
    return out


def _err(error: str, hint: str) -> dict:
    """Uniform tool error contract: {error, hint}.

    Returned (never raised) so the ReAct loop sees the failure as an observation
    and can self-correct on the next step — a raised exception gives the model
    nothing actionable. `hint` always names the concrete next action.
    """
    return {"error": error, "hint": hint}


# ============================================================
# READ TOOLS
# ============================================================

@tool
def semantic_search(query: str, top_k: int = 10) -> list[dict] | dict:
    """Find issues whose content is semantically similar to `query`.

    Use this for natural-language questions like "RLS policy not working" or
    "how do I set up OAuth" — it searches issue titles + first messages via
    pgvector embeddings (all-MiniLM-L6-v2, cosine) and returns closest matches.

    Args:
        query: Natural-language description of the topic to find.
        top_k: Maximum number of matches to return (default 10).

    Returns:
        A list of {issue_id, score, channel_id, sentiment} ordered by descending
        similarity — empty if nothing clears the similarity threshold. On failure,
        {error, hint}.
    """
    try:
        return [h.__dict__ for h in retrieve(query, top_k=top_k)]
    except Exception as exc:
        return _err(f"semantic search failed: {exc}",
                    "Retry with a shorter, more literal query, or use "
                    "search_issues_sql with an ILIKE filter instead.")


@tool
def search_issues_sql(sql: str) -> list[dict] | dict:
    """Run a READ-ONLY SQL query against the Lakebase `discord` schema and return rows.

    Useful for structured filters: counts by status, top contributors, date ranges.

    Args:
        sql: A single SELECT (or WITH … SELECT) statement. Tables available:
            discord.issues, discord.replies, discord.duplicate_clusters,
            discord.theme_clusters, discord.notes, discord.issues_light (view).
            Writes are rejected, an outer LIMIT of 500 is enforced, and the
            query is aborted after 10s.

    Returns:
        A list of row dicts keyed by column name. On a rejected or failed query,
        {error, hint} — read the hint and reissue a corrected statement.
    """
    import re

    stmt = sql.strip().rstrip(";")
    low = stmt.lower()
    if not (low.startswith("select") or low.startswith("with")):
        return _err("search_issues_sql only accepts SELECT / WITH queries.",
                    "Rewrite the query to start with SELECT or WITH. To change "
                    "data, use update_resolution_status or add_note instead.")
    # Block write keywords that appear as standalone SQL tokens (word-boundary
    # match), so column names like `created_at`/`updated_at` don't trip it.
    if re.search(r"\b(insert|update|delete|drop|alter|truncate|create|grant|vacuum)\b", low):
        return _err("search_issues_sql is read-only.",
                    "Remove the write keyword. To change data, use "
                    "update_resolution_status or add_note.")
    # wrap the user's query in an outer SELECT so we can cap rows regardless of
    # whether they included their own LIMIT.
    wrapped = f"WITH q AS ({stmt}) SELECT * FROM q LIMIT {SQL_ROW_LIMIT}"
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(f"set statement_timeout = {SQL_TIMEOUT_MS}")
            cur.execute(wrapped)
            return _rows(cur)
    except psycopg.Error as exc:
        return _err(f"query failed: {str(exc).strip()}",
                    "Check the column and table names against the discord schema "
                    "listed in this tool's description, then retry.")


@tool
def get_issue_detail(issue_id: str) -> dict:
    """Fetch one issue plus its full reply thread (oldest-first).

    Use this after semantic_search or search_issues_sql to read the actual
    conversation before deciding on an action.

    Args:
        issue_id: The Discord snowflake ID of the issue, as a string.

    Returns:
        The issue row plus a `replies` list of {author_username, content,
        timestamp, …} ordered oldest-first. If no such issue exists,
        {error, hint}.
    """
    issue_id = str(issue_id)  # LLMs emit snowflake IDs as ints; coerce.
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM discord.issues WHERE id = %s", (issue_id,))
        found = _rows(cur)
        if not found:
            return _err(f"issue {issue_id} not found",
                        "Confirm the ID with semantic_search or "
                        "search_issues_sql before fetching detail.")
        issue = found[0]
        cur.execute("""
            SELECT author_username, author_global_name, content, "timestamp",
                   has_attachment, attachment_count
            FROM discord.replies
            WHERE issue_id = %s
            ORDER BY "timestamp" ASC
        """, (issue_id,))
        issue["replies"] = _rows(cur)
        return issue


@tool
def dashboard_metrics() -> dict:
    """Return the dashboard's global KPI rollups (per channel) plus daily trends.

    Use this to answer "how are we doing" questions or to ground any summary in
    real numbers. Computed live over discord.issues on Lakebase using the same
    definitions as the workspace.discord.dashboard_* Delta tables from notebook
    02, so these figures always match the dashboard.

    Args:
        None.

    Returns:
        {global_metrics: [ {channel_id, total_issues, answered_issues,
        total_messages, resolved_issues, avg_response_time_ms,
        avg_response_hours, response_rate_pct, unique_users, archived_issues}
        … one row per channel ], daily_last_30: [ {date, channel_id,
        issue_count, total_messages, answered_count} … ]}.
        Quote `avg_response_hours` and `response_rate_pct` directly — they are
        pre-converted. Do not re-derive them from the raw millisecond figure.
    """
    with _conn() as conn, conn.cursor() as cur:
        # per-channel KPI rollup (one row per channel)
        cur.execute("""
            select channel_id,
                   count(*)                                   as total_issues,
                   sum(case when is_answered then 1 else 0 end) as answered_issues,
                   sum(message_count)                         as total_messages,
                   sum(case when resolution_status='likely-resolved' then 1 else 0 end) as resolved_issues,
                   coalesce(round(avg(response_time_ms)), 0)   as avg_response_time_ms,
                   count(distinct owner_id)                    as unique_users,
                   sum(case when archived then 1 else 0 end)   as archived_issues
            from discord.issues
            group by channel_id
        """)
        global_metrics = _rows(cur)
        # Raw milliseconds invite unit errors (a 2.5-day average reads as
        # "216 seconds" if the model skims the suffix) — hand the model the
        # already-converted figure and let it quote that.
        for gm in global_metrics:
            ms = gm.get("avg_response_time_ms") or 0
            gm["avg_response_hours"] = round(ms / 3_600_000, 1)
            total, answered = gm.get("total_issues") or 0, gm.get("answered_issues") or 0
            gm["response_rate_pct"] = round(100 * answered / total, 1) if total else 0.0
        # last 30 days of issue activity by day/channel
        cur.execute("""
            select date_trunc('day', created_at) as date,
                   channel_id,
                   count(*)                       as issue_count,
                   sum(message_count)             as total_messages,
                   sum(case when is_answered then 1 else 0 end) as answered_count
            from discord.issues
            where created_at >= now() - interval '30 days'
            group by 1, 2
            order by 1 desc
        """)
        return {"global_metrics": global_metrics, "daily_last_30": _rows(cur)}


# ============================================================
# WRITE TOOLS — these take real actions against the data
# ============================================================

@tool
def update_resolution_status(issue_id: str, status: str, reason: str = "") -> dict:
    """Re-classify an issue's resolution_status. WRITE — mutates discord.issues.

    Use only after investigating the thread with get_issue_detail — e.g. mark
    'likely-resolved' once you confirm the replies solve the problem, or
    'unanswered' if it was mis-classified.

    Args:
        issue_id: The Discord snowflake ID of the issue, as a string.
        status: One of 'unanswered' | 'in-progress' | 'likely-resolved' | 'unknown'.
        reason: Why the status changed. Recorded as a triage note on the issue.

    Returns:
        {id, resolution_status, updated_at, note_added} for the updated row.
        On an invalid status or unknown issue, {error, hint}.
    """
    allowed = {"unanswered", "in-progress", "likely-resolved", "unknown"}
    if status not in allowed:
        return _err(f"'{status}' is not a valid status.",
                    f"Use exactly one of: {', '.join(sorted(allowed))}.")
    issue_id = str(issue_id)  # LLMs emit snowflake IDs as ints; coerce.
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE discord.issues
               SET resolution_status = %s
             WHERE id = %s
            RETURNING id, resolution_status, updated_at
        """, (status, issue_id))
        updated = _rows(cur)
        if not updated:
            return _err(f"issue {issue_id} not found — nothing was updated",
                        "Confirm the ID with semantic_search or "
                        "search_issues_sql, then retry.")
        result = updated[0]
        if reason:
            cur.execute("""
                INSERT INTO discord.notes (issue_id, author, content)
                VALUES (%s, 'agent', %s)
            """, (issue_id, f"Status → {status}. {reason}"))
        conn.commit()
        result["note_added"] = bool(reason)
        return result


@tool
def add_note(issue_id: str, content: str, author: str = "agent") -> dict:
    """Attach a triage note to an issue. WRITE — inserts into discord.notes.

    Notes are visible to every dashboard viewer (server-side, unlike the original
    per-browser notes). Use this to record findings, link duplicates, or explain a
    status change.

    Args:
        issue_id: The Discord snowflake ID of the issue, as a string.
        content: The note body. Must be non-empty.
        author: Who the note is attributed to (default 'agent').

    Returns:
        The created note row {id, issue_id, author, content, created_at}.
        On empty content or an unknown issue_id, {error, hint}.
    """
    if not content.strip():
        return _err("note content cannot be empty",
                    "Pass the actual finding you want recorded as `content`.")
    issue_id = str(issue_id)  # LLMs emit snowflake IDs as ints; coerce.
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO discord.notes (issue_id, author, content)
                VALUES (%s, %s, %s)
                RETURNING id, issue_id, author, content, created_at
            """, (issue_id, author, content))
            created = _rows(cur)
            conn.commit()
            return created[0]
    except psycopg.errors.ForeignKeyViolation:
        return _err(f"issue {issue_id} does not exist — no note was written",
                    "Confirm the ID with semantic_search or "
                    "search_issues_sql, then retry.")


ALL_TOOLS = [
    semantic_search,
    search_issues_sql,
    get_issue_detail,
    dashboard_metrics,
    update_resolution_status,
    add_note,
]
