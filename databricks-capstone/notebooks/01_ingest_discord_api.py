# Databricks notebook source
# ============================================================
# 01_ingest_discord_api.py
# Scheduled ingest from the Discord v9 REST API into Lakebase.
#
# Ports the TypeScript ingest pipeline in the Discord repo:
#   src/lib/discord-api.ts      — searchThreads, fetchPostData, fetchThreadMessagesRaw
#   src/lib/data-loader.ts      — fetchFromDiscord, fetchRepliesForIssues
#   src/lib/discord-api.ts      — computeResponseAnalytics (ported below)
#
# Discord v9 endpoints used (undocumented, user-token auth):
#   GET  /channels/:id/threads/search    — paginated forum thread search
#   POST /channels/:id/post-data         — batch first-message fetch (max 10 IDs)
#   GET  /channels/:threadId/messages    — full thread message history
#
# EGRESS NOTE: discord.com is BLOCKED from Databricks serverless compute AND
# Databricks Apps on this workspace (Enterprise-tier network policy; the bulk
# NDJSON load in notebook 00b is the primary data source). This notebook is the
# correct live-ingest integration and runs wherever egress is permitted — locally
# for a small batch, or from a scheduled Job on a non-serverless cluster with
# outbound network. Run locally to demonstrate the live API integration.
#
# RUN (from the repo root):
#   export DISCORD_AUTH_TOKEN='...'        # Discord user token
#   export DISCORD_CHANNEL_ID='1006358244786196510'
#   export LAKEBASE_DSN='postgresql://...' # (optional; else decoded from secret)
#   uv run --with 'requests' --with 'psycopg[binary]' --with databricks-sdk \
#     python databricks-capstone/notebooks/01_ingest_discord_api.py
# ============================================================

import base64
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests

# ---------- config (env vars; secrets stay out of shell history) ----------
GUILD_ID    = os.environ.get("DISCORD_GUILD_ID", "839993398554656828")
CHANNEL_ID  = os.environ.get("DISCORD_CHANNEL_ID", "")
MAX_THREADS = int(os.environ.get("DISCORD_MAX_THREADS", "200"))
REPLY_CONC  = int(os.environ.get("DISCORD_REPLY_CONCURRENCY", "6"))
AUTH_TOKEN  = os.environ.get("DISCORD_AUTH_TOKEN", "")

assert CHANNEL_ID, "Set DISCORD_CHANNEL_ID (Discord forum channel ID)."
assert AUTH_TOKEN, "Set DISCORD_AUTH_TOKEN (Discord user token)."

DISCORD_API = "https://discord.com/api/v9"

# ---------- Discord API client (port of discord-api.ts) ----------
def _headers() -> dict:
    return {"authorization": AUTH_TOKEN, "accept": "*/*", "content-type": "application/json"}

def search_threads(archived: bool, limit: int = 25, offset: int = 0) -> dict:
    """Ports searchThreads() — one page of threads/search."""
    params = {
        "archived": str(archived).lower(),
        "sort_by": "last_message_time",
        "sort_order": "desc",
        "limit": str(limit),
        "offset": str(offset),
        "tag_setting": "match_some",
    }
    r = requests.get(f"{DISCORD_API}/channels/{CHANNEL_ID}/threads/search",
                     headers=_headers(), params=params, timeout=30)
    if r.status_code == 429:
        retry = float(r.json().get("retry_after", 1.0))
        time.sleep(retry)
        return search_threads(archived, limit, offset)
    r.raise_for_status()
    return r.json()

def fetch_post_data(thread_ids: list[str]) -> dict:
    """Ports fetchPostData() — batch first-message fetch (max 10 IDs)."""
    assert len(thread_ids) <= 10, "post-data supports at most 10 IDs per call"
    r = requests.post(f"{DISCORD_API}/channels/{CHANNEL_ID}/post-data",
                      headers=_headers(), json={"thread_ids": thread_ids}, timeout=30)
    if r.status_code == 429:
        time.sleep(float(r.json().get("retry_after", 1.0)))
        return fetch_post_data(thread_ids)
    r.raise_for_status()
    return r.json()

def fetch_thread_messages(thread_id: str, limit: int = 100) -> list[dict]:
    """Ports fetchThreadMessagesRaw() — paginated, oldest-first."""
    messages: list[dict] = []
    before = None
    while len(messages) < limit:
        page_limit = min(100, limit - len(messages))
        params = {"limit": str(page_limit)}
        if before:
            params["before"] = before
        r = requests.get(f"{DISCORD_API}/channels/{thread_id}/messages",
                         headers=_headers(), params=params, timeout=30)
        if r.status_code in (403, 404):
            return []  # thread inaccessible — matches the TS behavior
        if r.status_code == 429:
            time.sleep(float(r.json().get("retry_after", 1.0)))
            continue
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        messages.extend(batch)
        before = batch[-1]["id"]
        if len(batch) < 100:
            break
    messages.reverse()  # Discord returns newest-first
    return messages

# ---------- normalize + analytics (port of discord-api.ts) ----------
def normalize_issue(thread: dict, first_message: dict | None) -> dict:
    """Ports normalizeIssue()."""
    owner = (thread.get("owner") or {}).get("user") or {}
    fm = first_message or {}
    attachments = fm.get("attachments") or []
    tm = thread.get("thread_metadata") or {}
    return {
        "id": thread["id"],
        "name": thread.get("name", ""),
        "channel_id": CHANNEL_ID,
        "guild_id": thread.get("guild_id", GUILD_ID),
        "owner_id": thread.get("owner_id", ""),
        "owner_username": owner.get("username", "unknown"),
        "owner_global_name": owner.get("global_name") or owner.get("username"),
        "owner_avatar": owner.get("avatar"),
        "created_at": tm.get("create_timestamp", ""),
        "archived_at": tm.get("archive_timestamp"),
        "archived": bool(tm.get("archived", False)),
        "locked": bool(tm.get("locked", False)),
        "message_count": thread.get("message_count", 0),
        "member_count": thread.get("member_count", 0),
        "total_message_sent": thread.get("total_message_sent", 0),
        "applied_tags": thread.get("applied_tags", []),
        "first_message_id": fm.get("id"),
        "first_message_content": fm.get("content", ""),
        "first_message_author_id": (fm.get("author") or {}).get("id"),
        "first_message_author_name": (fm.get("author") or {}).get("global_name")
                                     or (fm.get("author") or {}).get("username"),
        "first_message_created_at": fm.get("timestamp"),
    }

RESOLUTION_KEYWORDS = ("thank", "solved", "resolved", "fixed it", "worked", "works now", "perfect")

def compute_response_analytics(issue: dict, replies: list[dict]) -> dict:
    """Ports computeResponseAnalytics()."""
    owner_id = issue["owner_id"]
    other_replies = [r for r in replies if (r.get("author") or {}).get("id") != owner_id]
    is_answered = len(other_replies) > 0

    response_time_ms = None
    responder_count = 0
    resolution_status = "unanswered"

    if is_answered:
        thread_time_str = issue.get("first_message_created_at") or issue.get("created_at")
        thread_time = _parse_ts(thread_time_str) if thread_time_str else None
        sorted_replies = sorted(other_replies, key=lambda r: r.get("timestamp", ""))
        if thread_time and sorted_replies:
            first_reply_time = _parse_ts(sorted_replies[0]["timestamp"])
            if first_reply_time:
                response_time_ms = max(0, int(first_reply_time - thread_time))
        responder_count = len({(r.get("author") or {}).get("id") for r in other_replies
                               if (r.get("author") or {}).get("id")})
        has_kw = any(any(k in (r.get("content") or "").lower() for k in RESOLUTION_KEYWORDS)
                     for r in replies)
        resolution_status = "likely-resolved" if has_kw else "in-progress"

    issue.update({
        "response_time_ms": response_time_ms,
        "responder_count": responder_count,
        "is_answered": is_answered,
        "resolution_status": resolution_status,
    })
    return issue

def _parse_ts(s: str) -> int | None:
    # Discord ISO timestamps → epoch ms
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None

def normalize_reply(issue_id: str, msg: dict) -> dict:
    author = msg.get("author") or {}
    attachments = msg.get("attachments") or []
    return {
        "id": msg["id"],
        "issue_id": issue_id,
        "author_id": author.get("id", ""),
        "author_username": author.get("username", ""),
        "author_global_name": author.get("global_name") or author.get("username"),
        "content": msg.get("content", ""),
        "timestamp": msg.get("timestamp"),
        "has_attachment": len(attachments) > 0,
        "attachment_count": len(attachments),
    }

# ---------- orchestrator (port of data-loader.ts fetchFromDiscord) ----------
def fetch_all_threads() -> list[dict]:
    """Paginate active then archived threads; backfill missing first_messages."""
    all_threads: list[dict] = []
    first_messages: dict[str, dict] = {}

    for archived in (False, True):
        offset = 0
        has_more = True
        while len(all_threads) < MAX_THREADS and has_more:
            page = search_threads(archived=archived, limit=25, offset=offset)
            for t in page.get("threads", []):
                all_threads.append(t)
            for fm in page.get("first_messages", []):
                if fm.get("channel_id"):
                    first_messages[fm["channel_id"]] = fm
            has_more = page.get("has_more", False)
            offset += 25
            if not page.get("threads"):
                break

    # backfill missing first_messages via post-data (10 IDs / call)
    missing = [t["id"] for t in all_threads if t["id"] not in first_messages]
    for i in range(0, len(missing), 10):
        batch = missing[i:i+10]
        data = fetch_post_data(batch)
        for tid, info in (data.get("threads") or {}).items():
            if info.get("first_message"):
                first_messages[tid] = info["first_message"]

    return [normalize_issue(t, first_messages.get(t["id"])) for t in all_threads]

def fetch_replies(issues: list[dict]) -> list[dict]:
    """Concurrency-pool message fetch (ports fetchRepliesForIssues, default 6 workers)."""
    def work(issue):
        msgs = fetch_thread_messages(issue["id"], limit=100)
        replies = [m for m in msgs if m.get("id") != issue.get("first_message_id")]
        issue = compute_response_analytics(issue, replies)
        return issue, [normalize_reply(issue["id"], m) for m in replies]

    enriched_issues, all_replies = [], []
    # skip threads that clearly have no replies
    todo = [i for i in issues if not i.get("message_count") or i["message_count"] > 1]
    with ThreadPoolExecutor(max_workers=REPLY_CONC) as pool:
        futures = {pool.submit(work, i): i for i in todo}
        for fut in as_completed(futures):
            try:
                issue, replies = fut.result()
                enriched_issues.append(issue)
                all_replies.extend(replies)
            except Exception as e:
                print(f"[fetch_replies] failed for {futures[fut]['id']}: {e}")
    # threads we skipped get unanswered/0 defaults
    skipped = [i for i in issues if i not in todo]
    for i in skipped:
        i.update({"response_time_ms": None, "responder_count": 0,
                  "is_answered": False, "resolution_status": "unanswered"})
        enriched_issues.append(i)
    return enriched_issues, all_replies

# ---------- write to Lakebase via psycopg ----------
# Serverless BLOCKS generic Spark-JDBC writes to Lakebase (HANDOFF platform
# fact #1), so we upsert over psycopg — the same proven path as notebook 00b.
# Idempotent: INSERT ... ON CONFLICT (pk) DO UPDATE.
def get_dsn() -> str:
    dsn = os.environ.get("LAKEBASE_DSN")
    if dsn:
        return dsn
    # decode the `database/lakebase-url` secret via the SDK
    from databricks.sdk import WorkspaceClient
    sec = WorkspaceClient().secrets.get_secret(scope="database", key="lakebase-url")
    return base64.b64decode(sec.value).decode("utf-8")


def to_lakebase(rows: list[dict], table: str, pk_cols: list[str], batch: int = 1000):
    """Idempotent upsert into Lakebase via psycopg executemany + ON CONFLICT."""
    import psycopg
    from psycopg.types.json import Jsonb

    if not rows:
        print(f"no rows for discord.{table}")
        return
    # column order from the first row; all rows must share it
    cols = list(rows[0].keys())
    cols_sql = ", ".join(f'"{c}"' for c in cols)
    set_cols = ", ".join(f'"{c}"=EXCLUDED."{c}"' for c in cols if c not in pk_cols)
    conflict = ", ".join(f'"{c}"' for c in pk_cols)
    placeholders = ", ".join(["%s"] * len(cols))
    upsert = (f'INSERT INTO discord.{table} ({cols_sql}) VALUES ({placeholders}) '
              f'ON CONFLICT ({conflict}) DO UPDATE SET {set_cols}')

    # coerce jsonb fields (applied_tags) for issues
    jsonb_cols = {"applied_tags"}
    with psycopg.connect(get_dsn()) as conn, conn.cursor() as cur:
        n = 0
        buf = []
        for r in rows:
            buf.append(tuple(Jsonb(r[c]) if c in jsonb_cols else r.get(c) for c in cols))
            if len(buf) >= batch:
                cur.executemany(upsert, buf)
                n += len(buf)
                buf = []
                print(f"  {table}: {n:,} rows…", flush=True)
        if buf:
            cur.executemany(upsert, buf)
            n += len(buf)
        conn.commit()
    print(f"✓ upserted {n:,} rows into discord.{table}")


# ---------- run ----------
print(f"Fetching threads from channel {CHANNEL_ID}…")
issues = fetch_all_threads()
print(f"  {len(issues)} threads; fetching replies…")
issues, replies = fetch_replies(issues)
print(f"  {len(replies)} replies; writing to Lakebase…")
to_lakebase(issues, "issues", ["id"])
to_lakebase(replies, "replies", ["id"])
print("Ingest complete.")
