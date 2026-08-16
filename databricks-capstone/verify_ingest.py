"""
verify_ingest.py — proof-of-run harness for Req 2 (Discord v9 REST ingest).

Runs notebooks/01_ingest_discord_api.py against a SMALL bounded slice of the live
forum and captures the evidence a grader needs: stdout from the run, Lakebase row
counts before and after, and the specific rows the run touched.

    export DISCORD_AUTH_TOKEN='…'        # your Discord user token; never printed
    uv run --python 3.12 \\
      --with 'psycopg[binary]==3.2.4' --with databricks-sdk --with requests \\
      python verify_ingest.py

Bounded on purpose: DISCORD_MAX_THREADS=5 by default, so this is a handful of
API calls, not a re-scrape. The upserts are idempotent (INSERT … ON CONFLICT DO
UPDATE), so re-running changes nothing except `fetched_at`.

Secrets: the token is read from the environment and never echoed — the report
prints only whether it is set and its length. The Lakebase DSN resolves through
the same path as the notebook (LAKEBASE_DSN, else the database/lakebase-url
secret via the SDK) and is likewise never printed.

Output goes to stdout and to demo-captures/ingest_proof.txt (gitignored, and
excluded from the submission zip — the transcript gets pasted into the docs, the
harness does not ship).
"""
from __future__ import annotations

import base64
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg

HERE = Path(__file__).parent
NOTEBOOK = HERE / "notebooks" / "01_ingest_discord_api.py"
OUT = HERE / "demo-captures" / "ingest_proof.txt"

# PINNED, not inherited. Sourcing a .env to pick up DISCORD_AUTH_TOKEN also picks
# up whatever DISCORD_CHANNEL_ID that file sets — which is how a run of this
# harness once ingested 25 issues from an unrelated channel into the capstone's
# table, moving the dashboard's headline count off the documented 40,570. The
# capstone is scoped to one forum; targeting another has to be deliberate.
CAPSTONE_CHANNEL = "1006358244786196510"
CHANNEL = os.environ.get("DISCORD_VERIFY_CHANNEL_ID", CAPSTONE_CHANNEL)
MAX_THREADS = os.environ.get("DISCORD_MAX_THREADS", "5")

_lines: list[str] = []


def say(s: str = "") -> None:
    print(s, flush=True)
    _lines.append(s)


def dsn() -> str:
    d = os.environ.get("LAKEBASE_DSN")
    if d:
        return d
    from databricks.sdk import WorkspaceClient
    sec = WorkspaceClient().secrets.get_secret(scope="database", key="lakebase-url")
    return base64.b64decode(sec.value).decode()


def snapshot(cur) -> dict:
    cur.execute("select count(*) from discord.issues where channel_id = %s", (CHANNEL,))
    issues = cur.fetchone()[0]
    cur.execute("""select count(*) from discord.replies r
                   join discord.issues i on i.id = r.issue_id
                   where i.channel_id = %s""", (CHANNEL,))
    replies = cur.fetchone()[0]
    cur.execute("select max(fetched_at) from discord.issues where channel_id = %s", (CHANNEL,))
    newest = cur.fetchone()[0]
    return {"issues": issues, "replies": replies, "max_fetched_at": newest}


def main() -> int:
    token = os.environ.get("DISCORD_AUTH_TOKEN", "")
    if not token:
        print("DISCORD_AUTH_TOKEN is not set — export it first (it is never printed).",
              file=sys.stderr)
        return 2

    say("=" * 72)
    say("Req 2 proof-of-run — Discord v9 REST ingest")
    say(f"started        : {datetime.now(timezone.utc).isoformat()}")
    say(f"channel        : {CHANNEL}")
    say(f"max threads    : {MAX_THREADS}")
    say(f"auth token     : set, {len(token)} chars (value withheld)")
    say("=" * 72)

    # Wall-clock start, used to find touched rows. NOT the pre-run MAX(fetched_at):
    # on an empty slice that is NULL, and `fetched_at > NULL` is NULL for every
    # row, so the report claimed "0 rows touched" immediately after a successful
    # 25-issue ingest.
    run_start = datetime.now(timezone.utc)

    conn_str = dsn()
    with psycopg.connect(conn_str) as conn, conn.cursor() as cur:
        before = snapshot(cur)
    say("\n-- BEFORE ------------------------------------------------------------")
    for k, v in before.items():
        say(f"  {k:16} {v}")

    say("\n-- RUNNING notebooks/01_ingest_discord_api.py ------------------------")
    # Explicitly overrides whatever the ambient environment says, for the reason
    # documented at CAPSTONE_CHANNEL above.
    env = {**os.environ,
           "DISCORD_CHANNEL_ID": CHANNEL,
           "DISCORD_MAX_THREADS": MAX_THREADS}
    proc = subprocess.run([sys.executable, str(NOTEBOOK)], env=env,
                          capture_output=True, text=True)
    for line in (proc.stdout or "").splitlines():
        say(f"  {line}")
    if proc.returncode != 0:
        say("\n  !! non-zero exit: " + str(proc.returncode))
        for line in (proc.stderr or "").splitlines()[-25:]:
            say(f"  {line}")

    with psycopg.connect(conn_str) as conn, conn.cursor() as cur:
        after = snapshot(cur)

        say("\n-- AFTER -------------------------------------------------------------")
        for k, v in after.items():
            say(f"  {k:16} {v}")

        say("\n-- DELTA -------------------------------------------------------------")
        say(f"  issues  net-new : {after['issues'] - before['issues']}")
        say(f"  replies net-new : {after['replies'] - before['replies']}")

        # Rows this run actually touched — upserts refresh fetched_at, so this
        # catches updates as well as inserts (net-new counts alone would show 0
        # on a re-run of an already-ingested slice, which proves nothing).
        say("\n-- ROWS TOUCHED BY THIS RUN (fetched_at >= run start) ----------------")
        cur.execute("""select id, left(name, 46) as name, message_count,
                              resolution_status, fetched_at
                       from discord.issues
                       where channel_id = %s and fetched_at >= %s
                       order by fetched_at desc limit 15""",
                    (CHANNEL, run_start))
        rows = cur.fetchall()
        say(f"  {len(rows)} row(s)")
        for r in rows:
            say(f"    {r[0]}  {r[1]:<46}  msgs={r[2]:<4} {r[3]:<15} {r[4]}")

    say("\n" + "=" * 72)
    say(f"finished       : {datetime.now(timezone.utc).isoformat()}")

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(_lines) + "\n")
    say(f"transcript     : {OUT}")
    return 0 if proc.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
