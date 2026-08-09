"""
agent/agent.py — the LangGraph ReAct agent, served on Databricks.

Wires the tools (agent/tools.py) + system prompt (agent/prompts.py) into a
LangGraph `create_react_agent` driven by a Databricks-hosted LLM via the
AI Gateway, then logs it to MLflow with tracing enabled and registers it for
serving as a Databricks model-serving endpoint / Databricks App backend.

This is the net-new capstone component (the Discord repo has no agent).

Run modes (from the repo root, so `agent` resolves as a package):
  • Register + serve:  `python -m agent.agent register`
      logs the agent to MLflow, registers it, prints the serving endpoint.
  • Local REPL:        `python -m agent.agent chat`
      interactive loop that prints the full ReAct trace — every tool call, its
      result, and the final answer. Accepts piped stdin for scripted demos.

NOTE: `databricks_langchain.ChatDatabricks` is the current import (the older
`langchain_databricks.ChatDatabricks` is deprecated). The MLflow genai/tracing
APIs move quickly; the structure below is the documented pattern.
"""

from __future__ import annotations
import os
import sys
import uuid

import mlflow
from databricks_langchain import ChatDatabricks
from langgraph.prebuilt import create_react_agent

from agent.tools import ALL_TOOLS
from agent.prompts import build_system_prompt

# ---------- model ----------
# Served via the AI Gateway. Every endpoint on this workspace was probed against
# the hardest demo turn (investigate → decide → two writes):
#   claude-sonnet-5 / opus-5 / gemini-3-5-flash / kimi-k3 / glm-5-2  → HTTP 403,
#     "rate limit of 0" (frontier models are disabled on this trial)
#   llama-4-maverick  → emits `add_note(...)` as message TEXT instead of calling
#     it, so the write silently never happens. Unusable for a write-tool agent.
#   gpt-oss-120b      → calls tools correctly but returns reasoning-only messages
#     that end the ReAct loop before it answers.
#   deepseek-v4-flash → completes the full chain in 9 calls, recovers from a bad
#     column name, and explains its choice.  ← default
# Override per-env with DISCORD_AGENT_MODEL.
LLM_ENDPOINT = os.environ.get("DISCORD_AGENT_MODEL", "databricks-deepseek-v4-flash-0731")

def _llm() -> ChatDatabricks:
    return ChatDatabricks(endpoint=LLM_ENDPOINT, temperature=0.2)


def build_agent():
    """Construct the ReAct agent with tools + system prompt."""
    # ponytail: `state_modifier` (not `prompt`) — langgraph==0.2.34 predates the
    # `prompt` kwarg (added in 0.2.40+/1.x). Re-evaluate if langgraph is bumped.
    return create_react_agent(
        model=_llm(),
        tools=ALL_TOOLS,
        state_modifier=build_system_prompt(),
    )


# ---------- MLflow registration + serving ----------
AGENT_NAME = "discord_triage_agent"

def register():
    """Log the agent to MLflow with tracing, register it, and (optionally) deploy."""
    mlflow.set_experiment(f"/Shared/{AGENT_NAME}")

    with mlflow.start_run(run_name=f"{AGENT_NAME}-{uuid.uuid4().hex[:6]}"):
        # Enable LangGraph auto-tracing (spans for every tool call + LLM call).
        # In current MLflow this is automatic when langchain/langgraph is importable.
        mlflow.langchain.log_model(
            lc_model=build_agent(),
            artifact_path="agent",
            registered_model_name=AGENT_NAME,
            input_example={"messages": [{"role": "user", "content": "What are the most frustrating unresolved RLS issues?"}]},
        )
        mlflow.set_tag("agent_type", "langgraph_react")
        mlflow.set_tag("domain", "discord_support_triage")
        mlflow.set_tag("tools", ",".join(t.name for t in ALL_TOOLS))

    print(f"✓ registered agent '{AGENT_NAME}'")
    print(f"  serving: databricks serving-endpoints create from model '{AGENT_NAME}'")
    print(f"  (UI: Models > {AGENT_NAME} > Serve > create real-time endpoint)")


# ---------- message rendering (shared with the Streamlit app) ----------
def text_of(msg) -> str:
    """Extract the human-readable text from a message's content.

    Reasoning-capable endpoints (gpt-oss, qwen) return `content` as a list of
    blocks — {"type": "reasoning", …} alongside {"type": "text", …} — instead of
    a plain string. Rendering that list raw dumps Python dicts into the UI, so
    keep the text blocks and drop the model's private reasoning.
    """
    content = getattr(msg, "content", msg if isinstance(msg, (str, list)) else "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") not in (None, "reasoning"):
                parts.append(block.get("text") or block.get("content") or "")
        return "\n".join(p for p in parts if p).strip()
    return str(content or "")


def tool_trace(messages: list, start: int = 0) -> list[dict]:
    """Flatten messages[start:] into {tool, args, result} records, in call order."""
    trace, pending = [], {}
    for m in messages[start:]:
        for call in getattr(m, "tool_calls", None) or []:
            rec = {"tool": call["name"], "args": call["args"], "result": None}
            pending[call.get("id")] = rec
            trace.append(rec)
        if getattr(m, "type", None) == "tool":
            rec = pending.get(getattr(m, "tool_call_id", None))
            if rec is not None:
                rec["result"] = str(getattr(m, "content", ""))
    return trace


# ---------- local REPL ----------
def _render(messages: list, start: int) -> None:
    """Print the ReAct trace for messages[start:] — tool calls, results, answer."""
    for m in messages[start:]:
        kind = getattr(m, "type", None)
        for call in getattr(m, "tool_calls", None) or []:
            args = ", ".join(f"{k}={v!r}" for k, v in call["args"].items())
            print(f"\n  ⚙ {call['name']}({args})")
        if kind == "tool":
            out = str(getattr(m, "content", ""))
            print(f"    → {out[:600]}{' …[truncated]' if len(out) > 600 else ''}")
        elif kind == "ai":
            answer = text_of(m)
            if answer:
                print(f"\nagent › {answer}\n")


def chat():
    agent = build_agent()
    config = {"configurable": {"thread_id": "repl"}}
    print(f"Discord Triage Agent (model={LLM_ENDPOINT}). Ctrl-D to exit.\n")
    history: list = []
    while True:
        try:
            user = input("you › ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nbye.")
            break
        if not user:
            continue
        if not sys.stdin.isatty():
            print(user)  # echo the prompt when piped, so transcripts read cleanly
        history.append({"role": "user", "content": user})
        seen = len(history)
        result = agent.invoke({"messages": history}, config=config)
        history = result["messages"]
        _render(history, seen)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "chat"
    if cmd == "register":
        register()
    else:
        chat()
