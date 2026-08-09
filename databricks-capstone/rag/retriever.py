"""
rag/retriever.py — semantic issue search.

PRIMARY backend = pgvector on Lakebase (HANDOFF decision 2). Uses
`all-MiniLM-L6-v2` (384d, matching notebook 03). Cosine distance `<=>` over an
HNSW index. Verified end-to-end on 40,570 issues (mean relevant-hit scores
0.63–0.77).

BONUS backend = Mosaic AI Vector Search. Active only when
`DISCORD_RETRIEVER_BACKEND=vs` (and the VS endpoint/index env vars are set);
otherwise the pgvector path is used. Kept for Phase 7.

Ports the semantic-search logic from the Discord repo's Cloudflare Worker:
  cloudflare-cron/src/index.js handleSearch → embed query → top-K
  cloudflare-cron/src/embed.js embedQuery   → embed the query text
"""

from __future__ import annotations
import os
from dataclasses import dataclass

# Backend selection. Default pgvector; set to "vs" to use Vector Search (bonus).
BACKEND = os.environ.get("DISCORD_RETRIEVER_BACKEND", "pgvector").lower()

# pgvector model config (must match notebook 03 / sql/02_issue_embeddings.sql).
EMBED_MODEL = os.environ.get("DISCORD_EMBED_MODEL", "all-MiniLM-L6-v2")

# Vector Search config (bonus path only).
VS_ENDPOINT = os.environ.get("DISCORD_VS_ENDPOINT", "")
VS_INDEX_NAME = os.environ.get("DISCORD_VS_INDEX", "workspace.discord.discord_issues_vs")

# Lakebase DSN (plaintext postgresql://...). Read from LAKEBASE_DSN when set;
# otherwise decode the `database/lakebase-url` secret via the SDK so the
# retriever works inside Databricks Apps (SDK auth as the app SP).
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

# Cached model (loading ~0.5s; reuse across calls).
_MODEL = None


@dataclass
class RetrievalHit:
    issue_id: str
    score: float
    channel_id: str | None
    sentiment: str | None


def _embed(query: str) -> list[float]:
    global _MODEL
    if _MODEL is None:
        from sentence_transformers import SentenceTransformer
        _MODEL = SentenceTransformer(EMBED_MODEL)
    return _MODEL.encode([query]).tolist()[0]


def _retrieve_pgvector(query: str, top_k: int) -> list[RetrievalHit]:
    import psycopg

    qv = _embed(query)
    # 1-(embedding <=> q) converts cosine *distance* to similarity in [0,1].
    # Note: round(double, int) doesn't exist in PG — cast to numeric.
    sql = (
        "select issue_id, 1 - (embedding <=> %s::vector) as score, "
        "channel_id, sentiment from discord.issue_embeddings "
        "order by embedding <=> %s::vector limit %s"
    )
    with psycopg.connect(LAKEBASE_DSN) as conn, conn.cursor() as cur:
        cur.execute(sql, (qv, qv, top_k))
        rows = cur.fetchall()
    return [RetrievalHit(issue_id=r[0], score=float(r[1]),
                         channel_id=r[2], sentiment=r[3]) for r in rows]


def _retrieve_vs(query: str, top_k: int) -> list[RetrievalHit]:
    """Bonus path: Mosaic AI Vector Search. Requires VS_ENDPOINT + index."""
    from databricks.vector_search.client import VectorSearchClient

    vsc = VectorSearchClient(disable_notice=True)
    idx = vsc.get_index(endpoint_name=VS_ENDPOINT, index_name=VS_INDEX_NAME)
    try:
        res = idx.similarity_search(
            query_text=query,
            columns=["issue_id", "channel_id", "sentiment"],
            num_results=top_k,
        )
    except Exception:
        # index without an embedding source column — embed the query manually
        import mlflow.deployments
        client = mlflow.deployments.get_deploy_client("databricks")
        emb = client.predict(endpoint="bge-large-en-v1.5", inputs={"input": [query]})
        vec = emb["data"][0]["embedding"]
        res = idx.similarity_search(
            query_vector=vec,
            columns=["issue_id", "channel_id", "sentiment"],
            num_results=top_k,
        )
    hits: list[RetrievalHit] = []
    for row in res.get("result", {}).get("data", []):
        hits.append(RetrievalHit(
            issue_id=row.get("issue_id"),
            score=float(row.get("score", 0.0)),
            channel_id=row.get("channel_id"),
            sentiment=row.get("sentiment"),
        ))
    return hits


def retrieve(query: str, top_k: int = 10) -> list[RetrievalHit]:
    """Return the top-K issues most similar to `query`.

    pgvector by default; set DISCORD_RETRIEVER_BACKEND=vs (with the VS env vars)
    for the Vector Search bonus path.
    """
    if BACKEND == "vs":
        return _retrieve_vs(query, top_k)
    return _retrieve_pgvector(query, top_k)
