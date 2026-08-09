"""
agent/mlflow_model.py — the "models-from-code" entrypoint for MLflow logging.

MLflow's langchain flavor cannot cloudpickle a LangGraph `CompiledStateGraph`
(`_save_base_lcs` rejects it: "MLflow langchain flavor only supports subclasses
of …, found CompiledStateGraph"). The supported path is models-from-code: point
`log_model(lc_model=<this file>)` at a script that builds the graph at load time
and hands it to `mlflow.models.set_model`.

This file is the model artifact. It must stay import-light — it runs inside the
serving container, where only `requirements.txt` is installed.
"""
from __future__ import annotations

import mlflow

from agent.agent import build_agent

mlflow.models.set_model(build_agent())
