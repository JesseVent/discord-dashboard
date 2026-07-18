#!/usr/bin/env python3
"""
Bulk-embed discord.issues into Cloudflare Vectorize.

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + CLOUDFLARE_ACCOUNT_ID +
CLOUDFLARE_API_TOKEN + VECTORIZE_INDEX_NAME from env (loads from .env if present).

- Pulls every issue from discord.issues (paginated, 1000/page).
- Builds embed text = name + first_message_content + "Tags: " + applied_tags.
- Embeds locally with sentence-transformers (BAAI/bge-base-en-v1.5, 768d).
- Bulk-upserts to Vectorize via REST in batches of 1000.

Usage:
    python scripts/embed_bulk.py
    python scripts/embed_bulk.py --limit 5000 --batch-size 500
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
    print("requests not installed. pip install requests", file=sys.stderr)
    sys.exit(1)

# Load .env if present (no extra deps)
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

# Allow NEXT_PUBLIC_SUPABASE_URL as a fallback (matches the Next.js convention).
SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or ""
).rstrip("/")
if not SUPABASE_URL:
    sys.exit("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) missing in env")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CF_ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
CF_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
VEC_INDEX = os.environ.get("VECTORIZE_INDEX_NAME", "discord-issues-index")

SCHEMA = "discord"
EMBED_MODEL = "BAAI/bge-base-en-v1.5"
VECTOR_DIM = 768
PAGE_SIZE = 1000
BULK_LIMIT = 1000  # Vectorize upsert batch cap

# Direct Postgres connection is intentionally avoided: db.<ref>.supabase.co
# isn't reachable from outside Supabase's network on this project, and the
# pooler (port 6543) requires a tenant identifier the user must look up.
# REST with `Accept-Profile` header works without exposing the discord schema
# in pgrest.db_schemas. If this stops working, fall back to a direct connect
# via the supabase CLI's `db-url` or a connection-pooling proxy.


def fetch_all_issues(limit: int | None):
    """Yield issues from discord.issues via REST API + Accept-Profile header.
    Avoids the need to expose the discord schema via pgrest.db_schemas."""
    offset = 0
    total = 0
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept-Profile": SCHEMA,  # tells PostgREST to look in discord schema
    }
    while True:
        url = f"{SUPABASE_URL}/rest/v1/issues?select=id,name,channel_id,applied_tags,first_message_content,sentiment&order=id&offset={offset}&limit={PAGE_SIZE}"
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
        offset += PAGE_SIZE
        if len(rows) < PAGE_SIZE:
            break


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


def upsert_to_vectorize(vectors: list[dict]) -> None:
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/vectorize/v2/indexes/{VEC_INDEX}/upsert"
    headers = {"Authorization": f"Bearer {CF_TOKEN}", "Content-Type": "application/json"}
    r = requests.post(url, headers=headers, json={"vectors": vectors})
    if not r.ok:
        raise RuntimeError(f"Vectorize upsert {r.status_code}: {r.text[:500]}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None, help="Max issues to process (default: all)")
    p.add_argument("--batch-size", type=int, default=BULK_LIMIT, help=f"Upsert batch size (default {BULK_LIMIT})")
    p.add_argument("--model", default=EMBED_MODEL, help="HuggingFace model name")
    p.add_argument("--encode-batch", type=int, default=64, help="Sentence-transformers encode batch")
    p.add_argument("--cpu", action="store_true", help="Force CPU (avoids MPS/CUDA OOM)")
    args = p.parse_args()

    print(f"[embed_bulk] model={args.model} index={VEC_INDEX} limit={args.limit}")

    if args.cpu:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
        # Force torch to use CPU even when MPS is available
        try:
            import torch
            torch.set_default_device("cpu")
        except ImportError:
            pass

    # Lazy-load heavy deps so --help is fast.
    from sentence_transformers import SentenceTransformer
    print(f"[embed_bulk] loading model {args.model}...")
    device = "cpu" if args.cpu else None
    model = SentenceTransformer(args.model, device=device)
    print(f"[embed_bulk] device={model.device}")
    if model.get_sentence_embedding_dimension() != VECTOR_DIM:
        print(f"WARNING: model dim {model.get_sentence_embedding_dimension()} != {VECTOR_DIM}", file=sys.stderr)

    buffer: list[dict] = []
    texts: list[str] = []
    meta_for_texts: list[dict] = []
    upserted = 0

    def flush():
        nonlocal buffer, upserted
        if not buffer:
            return
        upsert_to_vectorize(buffer)
        upserted += len(buffer)
        print(f"[embed_bulk] upserted {upserted} ({len(buffer)}/batch)")
        buffer = []

    t0 = time.time()
    for issue in fetch_all_issues(args.limit):
        text = build_text(issue)
        if not text:
            continue
        texts.append(text)
        meta_for_texts.append({
            "issueId": str(issue["id"]),
            "channelId": str(issue.get("channel_id") or ""),
            "sentiment": str(issue.get("sentiment") or ""),
        })
        if len(texts) >= args.batch_size:
            embeddings = model.encode(texts, batch_size=args.encode_batch, normalize_embeddings=True, show_progress_bar=False)
            for meta, vec in zip(meta_for_texts, embeddings):
                buffer.append({"id": f"issue:{meta['issueId']}", "values": vec.tolist(), "metadata": meta})
            texts.clear()
            meta_for_texts.clear()
            if len(buffer) >= args.batch_size:
                flush()

    if texts:
        embeddings = model.encode(texts, batch_size=args.encode_batch, normalize_embeddings=True, show_progress_bar=False)
        for meta, vec in zip(meta_for_texts, embeddings):
            buffer.append({"id": f"issue:{meta['issueId']}", "values": vec.tolist(), "metadata": meta})

    flush()
    elapsed = time.time() - t0
    print(f"[embed_bulk] done. {upserted} vectors in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
