#!/usr/bin/env python3
"""
Cluster all unclustered discord.issues using local embeddings + Vectorize queries.

This is the bulk initial cluster pass. The Worker endpoint /cluster handles
incremental clustering of new issues going forward.

- Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN, VECTORIZE_INDEX_NAME from .env (script auto-loads).
- Embeds each unclustered issue locally with sentence-transformers.
- Queries Vectorize for top-K nearest, builds similarity graph, finds
  connected components.
- Writes clusters to discord.duplicate_clusters + sets
  discord.issues.duplicate_cluster_id.

Usage:
    python scripts/cluster_bulk.py
    python scripts/cluster_bulk.py --limit 5000 --threshold 0.90
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("requests not installed. pip install requests")

# Load .env if present
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ""
).rstrip("/")
if not SUPABASE_URL:
    sys.exit("SUPABASE_URL missing in env")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CF_ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
CF_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
VEC_INDEX = os.environ.get("VECTORIZE_INDEX_NAME", "discord-issues-index")

SCHEMA = "discord"
MODEL_NAME = "BAAI/bge-base-en-v1.5"
DEFAULT_THRESHOLD = 0.86
DEFAULT_TOP_K = 6


def supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept-Profile": SCHEMA,
        "Content-Type": "application/json",
    }


def fetch_unclustered_issues(limit: int | None):
    """Yield unclustered issues, oldest first."""
    headers = {**supabase_headers(), "Accept-Profile": SCHEMA}
    page_size = 1000
    offset = 0
    total = 0
    while True:
        url = (
            f"{SUPABASE_URL}/rest/v1/issues?select=id,name,channel_id,applied_tags,"
            f"first_message_content,sentiment&duplicate_cluster_id=is.null"
            f"&order=created_at&offset={offset}&limit={page_size}"
        )
        r = requests.get(url, headers=headers)
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        for row in rows:
            yield row
            total += 1
            if limit and total >= limit:
                return
        offset += page_size
        if len(rows) < page_size:
            break


def query_vectorize(vector: list[float], top_k: int) -> list[dict]:
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/vectorize/v2/indexes/{VEC_INDEX}/query"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {CF_TOKEN}", "Content-Type": "application/json"},
        json={"vector": vector, "topK": top_k, "returnMetadata": "all"},
    )
    if not r.ok:
        raise RuntimeError(f"Vectorize query {r.status_code}: {r.text[:300]}")
    return r.json().get("result", {}).get("matches", [])


def insert_cluster(name: str, description: str | None, issue_count: int) -> str:
    url = f"{SUPABASE_URL}/rest/v1/duplicate_clusters"
    r = requests.post(
        url,
        headers={**supabase_headers(), "Prefer": "return=representation"},
        json={"name": name, "description": description, "issue_count": issue_count},
    )
    r.raise_for_status()
    return r.json()[0]["id"]


def assign_issues_to_cluster(issue_ids: list[str], cluster_id: str, chunk: int = 100):
    headers = supabase_headers()
    for i in range(0, len(issue_ids), chunk):
        slice_ = issue_ids[i:i + chunk]
        ids_csv = ",".join(f'"{i_}"' for i_ in slice_)
        url = f"{SUPABASE_URL}/rest/v1/issues?id=in.({ids_csv})"
        r = requests.patch(url, headers=headers, json={"duplicate_cluster_id": cluster_id})
        r.raise_for_status()


def connected_components(edges: dict[str, list[str]]) -> list[list[str]]:
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        p = parent[x]
        if p != x:
            p = find(p)
            parent[x] = p
        return p

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, bs in edges.items():
        find(a)
        for b in bs:
            find(b)
            union(a, b)

    groups: dict[str, list[str]] = {}
    for id_ in parent:
        r = find(id_)
        groups.setdefault(r, []).append(id_)
    return [g for g in groups.values() if len(g) >= 2]


def build_text(issue: dict) -> str:
    name = issue.get("name") or ""
    body = issue.get("first_message_content") or ""
    tags = issue.get("applied_tags") or []
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            tags = []
    tags_str = " ".join(tags) if isinstance(tags, list) else ""
    parts = [name, body]
    if tags_str:
        parts.append(f"Tags: {tags_str}")
    return "\n\n".join(p for p in parts if p).strip()[:8000]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None, help="Max issues to cluster")
    p.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="Cosine threshold")
    p.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    p.add_argument("--encode-batch", type=int, default=16)
    p.add_argument("--cpu", action="store_true")
    args = p.parse_args()

    print(f"[cluster_bulk] threshold={args.threshold} top_k={args.top_k} limit={args.limit}")

    if args.cpu:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
        try:
            import torch
            torch.set_default_device("cpu")
        except ImportError:
            pass

    from sentence_transformers import SentenceTransformer
    device = "cpu" if args.cpu else (
        "mps" if __import__("torch").backends.mps.is_available()
        else "cuda" if __import__("torch").cuda.is_available()
        else "cpu"
    )
    print(f"[cluster_bulk] loading model {MODEL_NAME} on {device}")
    model = SentenceTransformer(MODEL_NAME, device=device)

    issues = list(fetch_unclustered_issues(args.limit))
    print(f"[cluster_bulk] {len(issues)} unclustered issues")

    if not issues:
        return

    texts = [build_text(i) for i in issues]
    print(f"[cluster_bulk] encoding {len(texts)} texts (batch={args.encode_batch})")
    t0 = time.time()
    vectors = model.encode(
        texts, batch_size=args.encode_batch, normalize_embeddings=True, show_progress_bar=False
    )
    print(f"[cluster_bulk] encoded in {time.time() - t0:.1f}s")

    # Build similarity graph.
    print("[cluster_bulk] querying Vectorize for nearest neighbours...")
    edges: dict[str, list[str]] = {}
    for issue, vec in zip(issues, vectors):
        try:
            matches = query_vectorize(vec.tolist(), args.top_k + 1)
        except RuntimeError as e:
            print(f"[cluster_bulk] query failed for {issue['id']}: {e}")
            continue
        neighbours = [
            m["metadata"]["issueId"]
            for m in matches
            if m.get("score", 0) >= args.threshold
            and m.get("metadata", {}).get("issueId")
            and m["metadata"]["issueId"] != issue["id"]
        ]
        if not neighbours:
            continue
        edges[issue["id"]] = neighbours
        for n in neighbours:
            edges.setdefault(n, [])
            if issue["id"] not in edges[n]:
                edges[n].append(issue["id"])

    groups = connected_components(edges)
    print(f"[cluster_bulk] {len(groups)} clusters found")

    # Persist.
    issue_by_id = {i["id"]: i for i in issues}
    written = 0
    for members in groups:
        head = members[0]
        sample = issue_by_id.get(head, {})
        name = (sample.get("name") or f"cluster-{head}")[:80]
        cluster_id = insert_cluster(name, None, len(members))
        assign_issues_to_cluster(members, cluster_id)
        written += len(members)
        print(f"[cluster_bulk] cluster {cluster_id[:8]}: {len(members)} members, head='{name[:40]}'")

    print(f"[cluster_bulk] done. {written} issues in {len(groups)} clusters")


if __name__ == "__main__":
    main()
