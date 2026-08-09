"""
app/app.py — Streamlit Databricks App: Discord support-forum dashboard + agent chat.

Recreates the dashboard surfaces of the Discord repo's Next.js app
(src/app/page.tsx + src/components/dashboard/*) in Streamlit, and adds the
headline feature: an **agent chat panel** that can investigate issues and take
real triage actions via the tools in agent/tools.py.

Surfaces (porting the React components):
  • KPI strip                — components/dashboard/kpi-card.tsx
  • Issues over time (area)  — issues-over-time-chart.tsx
  • Response time (bar)      — response-time-chart.tsx
  • Time-of-week heatmap     — time-of-week-heatmap.tsx
  • Filter bar + issues table with detail — filter-bar.tsx, issues-table.tsx
  • Agent chat               — NEW (no equivalent in the Discord repo)

Data source: Lakebase via psycopg (`LAKEBASE_DSN` env, decoded from the
`database/lakebase-url` secret at app-startup by the Databricks Apps env
binding). The agent is embedded in-process (LangGraph ReAct agent), not a
served HTTP endpoint — keeps the app a single self-contained process.

The agent module path (agent/, rag/) is on sys.path because the app is deployed
with the whole capstone package as its source.
"""

from __future__ import annotations
import os
import sys
from pathlib import Path

# Quiet Streamlit's local-source watcher: it walks every imported module's
# __path__ on hot-reload, which makes transformers/torchvision fire noisy
# ModuleNotFoundError tracebacks during agent import. The app is deployed as a
# frozen artifact (no live edit), so file-watching is unnecessary.
os.environ.setdefault("STREAMLIT_SERVER_FILE_WATCHER_TYPE", "none")

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import psycopg
import streamlit as st

# Make the sibling agent/ and rag/ packages importable when the app runs with
# the capstone dir as its source root.
_APP_DIR = Path(__file__).resolve().parent
_PROJECT = _APP_DIR.parent
if str(_PROJECT) not in sys.path:
    sys.path.insert(0, str(_PROJECT))

# ---------- page config ----------
st.set_page_config(
    page_title="Discord Support Tracker",
    page_icon="🎧",
    layout="wide",
)

# ---------- Lakebase connection ----------
# In the Databricks Apps runtime the app runs as its own service principal and
# reads the `database/lakebase-url` secret via the SDK (base64-decoded, same as
# bootcamp/day1b/lakebase.py). For local dev, LAKEBASE_DSN can be set directly.
def _dsn() -> str:
    dsn = os.environ.get("LAKEBASE_DSN")
    if dsn:
        return dsn
    import base64
    from databricks.sdk import WorkspaceClient
    scope = os.environ.get("LAKEBASE_SECRET_SCOPE", "database")
    key = os.environ.get("LAKEBASE_SECRET_KEY", "lakebase-url")
    sec = WorkspaceClient().secrets.get_secret(scope=scope, key=key)
    return base64.b64decode(sec.value).decode("utf-8")


def _conn():
    try:
        return psycopg.connect(_dsn())
    except Exception as e:
        st.error(f"Could not connect to Lakebase: {e}")
        st.stop()


def _q(sql: str, params: tuple = ()) -> pd.DataFrame:
    """Run a parameterized query on Lakebase; return a DataFrame."""
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [c.name for c in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


@st.cache_data(ttl=600, show_spinner="Loading dashboard data…")
def load_data():
    # Global KPI rollup over discord.issues (matches notebook 02's Delta rollup
    # so the dashboard and the agent's dashboard_metrics tool agree).
    metrics = _q("""
        select count(*)                                   as total_issues,
               sum(case when is_answered then 1 else 0 end) as answered_issues,
               sum(message_count)                         as total_messages,
               sum(case when resolution_status='likely-resolved' then 1 else 0 end) as resolved_issues,
               avg(response_time_ms)                      as avg_response_time_ms,
               percentile_cont(0.5) within group (order by response_time_ms) as median_response_time_ms,
               sum(case when response_time_ms <= 3600000 then 1 else 0 end) as fast_response_count,
               count(distinct owner_id)                   as unique_users,
               sum(case when archived then 1 else 0 end)  as archived_issues
        from discord.issues
    """)
    daily = _q("""
        select date_trunc('day', created_at) as date, channel_id,
               count(*)                       as issue_count,
               sum(message_count)             as total_messages,
               sum(case when is_answered then 1 else 0 end) as answered_count
        from discord.issues
        group by 1, 2
        order by 1
    """)
    responders = _q("""
        select r.author_username, r.author_global_name,
               count(*)                  as reply_count,
               count(distinct r.issue_id) as issues_helped
        from discord.replies r
        join discord.issues i on i.id = r.issue_id
        where r.author_id <> i.owner_id
        group by 1, 2
        order by reply_count desc
        limit 20
    """)
    issues = _q("""
        select id, name, owner_username, created_at, message_count,
               resolution_status, sentiment, is_answered,
               response_time_ms, duplicate_cluster_id
        from discord.issues
    """)
    return metrics, daily, responders, issues


metrics_df, daily_df, responders_df, issues_df = load_data()

# ============================================================
# Header
# ============================================================
st.title("🎧 Discord Support Tracker")
st.caption("Databricks AI Capstone — ported from the Discord dashboard solution.")

# ============================================================
# KPI strip (ports the KPI strips in page.tsx)
# ============================================================
if not metrics_df.empty:
    m = metrics_df.iloc[0]
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("Total Issues", int(m["total_issues"]))
    c2.metric("Unique Users", int(m["unique_users"]))
    c3.metric("Total Messages", int(m["total_messages"]))
    c4.metric("Answered", int(m["answered_issues"]))
    c5.metric("Likely Resolved", int(m["resolved_issues"]))
    c6.metric("Fast (<1h)", int(m["fast_response_count"]))

    avg_ms = float(m["avg_response_time_ms"] or 0)
    med_ms = float(m["median_response_time_ms"] or 0)
    c1, c2, c3 = st.columns(3)
    c1.metric("Avg Response", f"{avg_ms/1000/60:.0f} min")
    c2.metric("Median Response", f"{med_ms/1000/60:.0f} min")
    c3.metric("Response Rate",
              f"{(m['answered_issues']/m['total_issues']*100):.0f} %" if m["total_issues"] else "—")

st.divider()

# ============================================================
# Charts (port the chart components)
# ============================================================
col1, col2 = st.columns(2)

with col1:
    st.subheader("Issues Over Time")
    if not daily_df.empty:
        d = daily_df.copy()
        d["date"] = pd.to_datetime(d["date"])
        fig = px.area(d, x="date", y="issue_count", title="Daily issues")
        fig.update_layout(height=320, margin=dict(l=0, r=0, t=30, b=0))
        st.plotly_chart(fig, use_container_width=True)

with col2:
    st.subheader("Response Time Distribution")
    if not issues_df.empty and issues_df["response_time_ms"].notna().any():
        bins = [0, 3_600_000, 21_600_000, 86_400_000, float("inf")]
        labels = ["<1h", "1–6h", "6–24h", ">24h"]
        counts = pd.cut(issues_df["response_time_ms"].dropna(),
                        bins=bins, labels=labels, right=False).value_counts().reindex(labels, fill_value=0)
        fig = px.bar(x=counts.index, y=counts.values,
                     labels={"x": "time to first reply", "y": "issues"},
                     color=counts.index,
                     color_discrete_sequence=["#10b981", "#3b82f6", "#f59e0b", "#ef4444"])
        fig.update_layout(showlegend=False, height=320, margin=dict(l=0, r=0, t=30, b=0))
        st.plotly_chart(fig, use_container_width=True)

st.subheader("Issues by Hour & Day of Week")
if not issues_df.empty:
    ic = issues_df.copy()
    ic["created_at"] = pd.to_datetime(ic["created_at"])
    ic["dow"] = ic["created_at"].dt.dayofweek
    ic["hour"] = ic["created_at"].dt.hour
    heat = (ic.groupby(["dow", "hour"]).size().unstack(fill_value=0)
              .reindex(index=range(7), columns=range(24), fill_value=0))
    fig = go.Figure(data=go.Heatmap(
        z=heat.values,
        x=[f"{h:02d}" for h in range(24)],
        y=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        colorscale="Viridis"))
    fig.update_layout(height=260, margin=dict(l=0, r=0, t=10, b=0),
                      yaxis=dict(autorange="reversed"))
    st.plotly_chart(fig, use_container_width=True)

st.divider()

# ============================================================
# Issues table with detail (ports issues-table.tsx + IssueDetailDialog)
# ============================================================
st.subheader("Issues")
status_filter = st.multiselect("Resolution status",
    options=sorted(issues_df["resolution_status"].dropna().unique()) if not issues_df.empty else [],
    default=[])
view = issues_df[~issues_df["resolution_status"].isin(status_filter)] if status_filter else issues_df
st.dataframe(view[["name", "owner_username", "created_at", "message_count",
                   "resolution_status", "sentiment", "response_time_ms"]].head(200),
             use_container_width=True, hide_index=True)

with st.expander("🔎 Inspect an issue by ID"):
    iid = st.text_input("Issue ID")
    if iid:
        # PARAMETERIZED — the old version string-interpolated iid into SQL.
        detail = _q("""
            select r.author_username, r.author_global_name, r.content,
                   r."timestamp", r.has_attachment
            from discord.replies r
            where r.issue_id = %s
            order by r."timestamp" asc
        """, (iid.strip(),))
        if detail.empty:
            st.info("No replies found for that issue (or it has none).")
        else:
            for _, r in detail.iterrows():
                with st.chat_message("user", avatar="🧑" if r["author_username"] else "🤖"):
                    st.caption(f"{r['author_global_name'] or r['author_username']} · {r['timestamp']}")
                    st.write(r["content"])

st.divider()

# ============================================================
# Agent chat — the headline net-new feature
# Embedded in-process (LangGraph ReAct agent), not a served HTTP endpoint.
# ============================================================
st.subheader("🤖 Triage Agent")
st.caption("Investigates issues (semantic + SQL search) and can re-classify or annotate them.")


@st.cache_resource(show_spinner="Booting agent…")
def _agent():
    """Build the agent once per app process. Imports are lazy so the dashboard
    still renders if the heavy agent stack fails to import."""
    from agent.agent import build_agent
    return build_agent()


if "agent_history" not in st.session_state:
    st.session_state.agent_history = []

WRITE_TOOLS = {"update_resolution_status", "add_note"}


def _show_trace(trace: list[dict]) -> None:
    """Render the agent's tool calls so its work is auditable, not just its answer."""
    if not trace:
        return
    labels = ", ".join(t["tool"] for t in trace)
    wrote = any(t["tool"] in WRITE_TOOLS for t in trace)
    with st.expander(f"🔧 {len(trace)} tool call(s): {labels}"
                     + ("  ·  ✍️ wrote to the database" if wrote else ""),
                     expanded=True):
        for t in trace:
            icon = "✍️" if t["tool"] in WRITE_TOOLS else "🔍"
            args = ", ".join(f"{k}={v!r}" for k, v in t["args"].items())
            st.markdown(f"{icon} **`{t['tool']}`**(`{args}`)")
            st.code((t["result"] or "")[:1500], language="json")


# render history
for msg in st.session_state.agent_history:
    with st.chat_message(msg["role"]):
        _show_trace(msg.get("trace") or [])
        st.markdown(msg["content"])

if prompt := st.chat_input("Ask the agent…"):
    st.session_state.agent_history.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    trace = []
    try:
        from agent.agent import text_of, tool_trace
        agent = _agent()
        # Only the role/content keys are valid agent input — strip our own `trace`.
        history = [{"role": m["role"], "content": m["content"]}
                   for m in st.session_state.agent_history]
        seen = len(history)
        result = agent.invoke({"messages": history},
                              config={"configurable": {"thread_id": "streamlit"}})
        messages = result["messages"]
        trace = tool_trace(messages, seen)
        # last AI message carrying actual prose (skip tool-call-only messages)
        answer = next((t for t in (text_of(m) for m in reversed(messages)
                                   if getattr(m, "type", None) == "ai") if t), "(no answer)")
    except Exception as e:
        answer = f"⚠️ agent error: {e}"

    st.session_state.agent_history.append(
        {"role": "assistant", "content": answer, "trace": trace})
    with st.chat_message("assistant"):
        _show_trace(trace)
        st.markdown(answer)
