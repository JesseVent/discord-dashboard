"""
mcp_server.py — the six triage tools, served over MCP (streamable HTTP).

This is a *protocol surface*, not a second implementation. Every tool exposed
here is the exact function object the in-process LangGraph agent calls
(`agent/tools.py`); this module only re-publishes them over MCP. There is no
duplicated SQL, no duplicated validation, and no second error contract — fix a
tool once in `agent/tools.py` and both surfaces change together.

Why both surfaces exist:
  • In-process (agent/agent.py -> app/app.py) is the DEFAULT for the dashboard:
    one process, one secret ACL, no extra network hop to fail. See
    docs/design-decisions.md, "why the agent runs in-process".
  • MCP is for *other* clients — Claude Desktop, an IDE, another agent runtime —
    that want the same read/write triage tools without importing this codebase.

The tool schemas MCP advertises are derived automatically from each function's
type hints and its `Args:`/`Returns:` docstring, which is why the docstrings in
agent/tools.py are written the way they are.

Run locally over stdio (what Claude Desktop / `mcp` CLI clients expect):
    PYTHONPATH=. uv run --with mcp --with 'psycopg[binary]' --with databricks-sdk \
      --with sentence-transformers python mcp_server.py

Run as an HTTP service — LOOPBACK ONLY unless you put auth in front of it:
    PYTHONPATH=. uvicorn mcp_server:app --host 127.0.0.1 --port 8000
    # -> POST /mcp   (streamable HTTP transport)

SECURITY — read before exposing this on a network.
  This server does NOT authenticate callers: it is constructed without an
  `auth_server_provider` / `token_verifier`, because the intended transports are
  stdio (a local client spawns it) and loopback HTTP. Consequences if you bind it
  to a routable interface as-is:
    • `search_issues_sql` is arbitrary read-only SQL over the whole `discord`
      schema — an unauthenticated caller can read every issue and reply.
    • the write tools mutate production rows.
    • `add_note(author=...)` is caller-supplied, so notes can be attributed to
      any name.
  Two mitigations are built in:
    1. Write tools are NOT published unless DISCORD_MCP_ALLOW_WRITES=1. The
       default surface is the four read tools.
    2. `--host 127.0.0.1` above, not 0.0.0.0.
  To expose it for real, terminate auth in front (Databricks Apps OAuth, or an
  MCP `token_verifier`) and only then set DISCORD_MCP_ALLOW_WRITES=1.

Verify the wiring without a client:
    PYTHONPATH=. python mcp_server.py --selftest

Credentials: none here. `agent.tools` resolves the Lakebase DSN at import time
from LAKEBASE_DSN, else the `database/lakebase-url` secret via the Databricks
SDK — identical to the app and the agent.
"""
from __future__ import annotations
import os
import sys

from mcp.server.mcpserver import MCPServer

from agent.tools import ALL_TOOLS

WRITE_TOOLS = {"update_resolution_status", "add_note"}

# Read-only by default. This server has no authentication (see SECURITY above),
# so publishing row-mutating tools has to be a deliberate act, not the default
# a careless `uvicorn mcp_server:app` inherits.
ALLOW_WRITES = os.environ.get("DISCORD_MCP_ALLOW_WRITES") == "1"

INSTRUCTIONS = """\
Discord support-forum triage over a Lakebase Postgres corpus of ~40.5k forum
issues and ~233k replies.

Four read tools (semantic_search, search_issues_sql, get_issue_detail,
dashboard_metrics) and two WRITE tools (update_resolution_status, add_note) that
mutate real rows. Read before you write: pull the issue and its thread with
get_issue_detail before re-classifying it, and put your justification in the
`reason`/`content` field — every write is auditable.

search_issues_sql accepts SELECT/WITH only; write keywords are rejected, results
are capped at 500 rows and any single query is aborted after 10s. Tools never
raise: on failure they return {"error": ..., "hint": ...} so you can self-correct.
"""

mcp = MCPServer(name="discord-triage", instructions=INSTRUCTIONS)

# `.func` is the undecorated callable behind LangChain's @tool StructuredTool.
# Passing it (not the StructuredTool) lets MCP derive the JSON schema from the
# real signature + docstring, exactly as the LangGraph agent does.
PUBLISHED = [t for t in ALL_TOOLS if ALLOW_WRITES or t.name not in WRITE_TOOLS]

for _t in PUBLISHED:
    mcp.add_tool(_t.func, name=_t.name, description=_t.description)

if not ALLOW_WRITES:
    print(
        f"mcp_server: {len(PUBLISHED)} read tools published; "
        f"write tools withheld ({', '.join(sorted(WRITE_TOOLS))}). "
        "Set DISCORD_MCP_ALLOW_WRITES=1 to publish them — only behind auth.",
        file=sys.stderr,
    )

# ASGI app for HTTP serving; `/mcp` is the streamable-HTTP endpoint.
app = mcp.streamable_http_app()


def _selftest() -> int:
    """Assert all six tools are published with a description and input schema."""
    import asyncio

    tools = asyncio.run(mcp.list_tools())
    names = sorted(t.name for t in tools)
    expected = sorted(t.name for t in PUBLISHED)
    assert names == expected, f"published {names}, expected {expected}"

    for t in tools:
        assert t.description, f"{t.name}: no description (docstring missing?)"
        props = (t.input_schema or {}).get("properties", {})
        # dashboard_metrics is the one nullary tool; everything else takes args.
        if t.name != "dashboard_metrics":
            assert props, f"{t.name}: empty input schema"

    # The security property that matters: writes are withheld unless opted in.
    leaked = WRITE_TOOLS & set(names)
    if ALLOW_WRITES:
        assert leaked == WRITE_TOOLS, f"write tools missing: {WRITE_TOOLS - leaked}"
        assert len(names) == 6, f"expected 6 tools, got {len(names)}"
        print(f"✓ 6 tools published (DISCORD_MCP_ALLOW_WRITES=1): {', '.join(names)}")
        print(f"✓ write tools present: {', '.join(sorted(WRITE_TOOLS))}")
    else:
        assert not leaked, f"write tools published without opt-in: {leaked}"
        assert len(names) == 4, f"expected 4 read tools, got {len(names)}"
        print(f"✓ 4 read tools published: {', '.join(names)}")
        print(f"✓ write tools correctly withheld: {', '.join(sorted(WRITE_TOOLS))}")
    for t in sorted(tools, key=lambda x: x.name):
        args = ", ".join((t.input_schema or {}).get("properties", {}))
        print(f"    {t.name}({args})")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    mcp.run(transport="streamable-http")
