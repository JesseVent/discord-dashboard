# Databricks notebook source
# ============================================================
# 04_cluster_duplicates.py
# Near-duplicate clustering for issues, via pgvector self-similarity + union-find.
#
# Ports cloudflare-cron/src/cluster.js:
#   clusterIssues(env, issues)  — per-issue top-K query → similarity graph →
#                                 connected components (union-find)
#   connectedComponents(edges)  — the union-find implementation
#   dailyClusterJob(env)        — find unclustered issues, cluster, write back
#
# Retrieval backend = pgvector (HANDOFF decision 2): pairwise cosine similarity
# over discord.issue_embeddings, computed SERVER-SIDE in one self-join query
# (using the HNSW index) rather than N client round-trips — 40k embeddings make
# a per-issue query loop impractical. Union-find is the same logic as cluster.js,
# in Python.
#
# Writes clusters back to LAKEBASE (discord.duplicate_clusters + issues.
# duplicate_cluster_id) over psycopg — NOT spark.sql("INSERT INTO discord.…"),
# which targets Unity Catalog, not Lakebase (HANDOFF scaffolding bug).
#
# Threshold 0.86 cosine — same as DEFAULT_THRESHOLD in cluster.js.
# Run after notebook 03 (embeddings). Run locally (serverless can't write to
# Lakebase via Spark JDBC; psycopg is the approved path).
#
# RUN (from the repo root):
#   export LAKEBASE_DSN='postgresql://...'   # (else decoded from secret)
#   uv run --with 'psycopg[binary]' --with databricks-sdk \
#     python databricks-capstone/notebooks/04_cluster_duplicates.py
# ============================================================

import base64
import datetime
import os
import uuid

import psycopg

THRESHOLD = 0.86   # DEFAULT_THRESHOLD from cluster.js (cosine similarity)
TOP_K     = 6      # DEFAULT_TOP_K + 1 in cluster.js

# ---------- Lakebase connection ----------
def get_dsn() -> str:
    dsn = os.environ.get("LAKEBASE_DSN")
    if dsn:
        return dsn
    from databricks.sdk import WorkspaceClient
    sec = WorkspaceClient().secrets.get_secret(scope="database", key="lakebase-url")
    return base64.b64decode(sec.value).decode("utf-8")


# ---------- union-find (port of connectedComponents in cluster.js) ----------
parent: dict[str, str] = {}

def find(x: str) -> str:
    parent.setdefault(x, x)
    if parent[x] != x:
        parent[x] = find(parent[x])
    return parent[x]

def union(a: str, b: str) -> None:
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb


def main():
    dsn = get_dsn()
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        # 1. how many issues to cluster? (ports fetchUnclusteredIssueIds)
        cur.execute("select count(*) from discord.issues where duplicate_cluster_id is null")
        n_unclustered = cur.fetchone()[0]
        print(f"{n_unclustered:,} unclustered issues")
        if n_unclustered == 0:
            print("Nothing to cluster; done.")
            return

        # 2. Build the similarity graph in ONE server-side query.
        # For each issue, find up to TOP_K nearest neighbors with cosine
        # similarity >= THRESHOLD. Done as a single self-join over embeddings
        # (the HNSW index serves the nearest-neighbor search) so it's a single
        # round-trip, not 40k. We cluster ALL embeddings (not just unclustered)
        # so duplicate detection is global; then only unclustered issues get a
        # new cluster_id assigned (clustered ones keep theirs).
        print(f"Computing similarity graph (threshold={THRESHOLD}, top_k={TOP_K})…")
        cur.execute(f"""
            with neighbors as (
                select a.issue_id as src,
                       b.issue_id as dst,
                       1 - (a.embedding <=> b.embedding) as sim
                from discord.issue_embeddings a
                join lateral (
                    select issue_id, embedding
                    from discord.issue_embeddings e2
                    where e2.issue_id <> a.issue_id
                    order by e2.embedding <=> a.embedding
                    limit {TOP_K}
                ) b on 1 - (a.embedding <=> b.embedding) >= {THRESHOLD}
            )
            select src, dst from neighbors
        """)
        edges = cur.fetchall()
        print(f"  {len(edges):,} similarity edges above threshold")

        # 3. connected components (union-find).
        for src, dst in edges:
            union(src, dst)

        groups: dict[str, list[str]] = {}
        for node in parent:
            groups.setdefault(find(node), []).append(node)
        components = [g for g in groups.values() if len(g) >= 2]
        print(f"  {len(components)} duplicate clusters from connected components")

        if not components:
            print("no clusters above threshold")
            return

        # 4. write clusters back to Lakebase — only for issues not already clustered.
        # (ports insertCluster + assignIssuesToCluster in supabase.js)
        # Names come from the first member's issue name.
        cur.execute("select id, left(name, 80) from discord.issues")
        name_by_id = {r[0]: r[1] for r in cur.fetchall()}
        existing_clusters = set()  # avoid duplicate cluster rows across runs

        now = datetime.datetime.now(datetime.timezone.utc)
        cluster_rows, assign_rows = [], []
        for members in components:
            cid = str(uuid.uuid4())
            head = members[0]
            cluster_rows.append((
                cid,
                (name_by_id.get(head) or f"cluster-{head}")[:80],
                None,                       # description
                len(members),               # issue_count
                now,
            ))
            for mid in members:
                assign_rows.append((cid, mid))

        cur.executemany("""
            insert into discord.duplicate_clusters (id, name, description, issue_count, created_at)
            values (%s, %s, %s, %s, %s)
            on conflict (id) do nothing
        """, cluster_rows)
        # Only assign issues that are currently unclustered (preserve existing clusters).
        cur.executemany("""
            update discord.issues set duplicate_cluster_id = %s
            where id = %s and duplicate_cluster_id is null
        """, assign_rows)
        conn.commit()
        print(f"✓ wrote {len(cluster_rows)} clusters, assigned up to {len(assign_rows)} issues")


if __name__ == "__main__":
    main()
