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

Run as an HTTP service (what a Databricks App would serve):
    PYTHONPATH=. uvicorn mcp_server:app --host 0.0.0.0 --port 8000
    # -> POST /mcp   (streamable HTTP transport)

Verify the wiring without a client:
    PYTHONPATH=. python mcp_server.py --selftest

Credentials: none here. `agent.tools` resolves the Lakebase DSN at import time
from LAKEBASE_DSN, else the `database/lakebase-url` secret via the Databricks
SDK — identical to the app and the agent.
"""
from __future__ import annotations
import sys

from mcp.server.mcpserver import MCPServer

from agent.tools import ALL_TOOLS

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
for _t in ALL_TOOLS:
    mcp.add_tool(_t.func, name=_t.name, description=_t.description)

# ASGI app for HTTP serving; `/mcp` is the streamable-HTTP endpoint.
app = mcp.streamable_http_app()


def _selftest() -> int:
    """Assert all six tools are published with a description and input schema."""
    import asyncio

    tools = asyncio.run(mcp.list_tools())
    names = sorted(t.name for t in tools)
    expected = sorted(t.name for t in ALL_TOOLS)
    assert names == expected, f"published {names}, expected {expected}"
    assert len(names) == 6, f"expected 6 tools, got {len(names)}"

    for t in tools:
        assert t.description, f"{t.name}: no description (docstring missing?)"
        props = (t.input_schema or {}).get("properties", {})
        # dashboard_metrics is the one nullary tool; everything else takes args.
        if t.name != "dashboard_metrics":
            assert props, f"{t.name}: empty input schema"

    writes = {"update_resolution_status", "add_note"}
    assert writes <= set(names), f"write tools missing: {writes - set(names)}"

    print(f"✓ {len(names)} tools published over MCP: {', '.join(names)}")
    print(f"✓ write tools present: {', '.join(sorted(writes))}")
    for t in sorted(tools, key=lambda x: x.name):
        args = ", ".join((t.input_schema or {}).get("properties", {}))
        print(f"    {t.name}({args})")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    mcp.run(transport="streamable-http")
