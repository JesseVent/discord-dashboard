#!/usr/bin/env python3
"""Edge Functions deep dive — why does this area go unanswered?

Input:  data/issues.parquet (reply metadata) + data/issues_enriched.parquet
        (keyword feature classifier — the forum's tag IDs have drifted and are
        unreliable, verified 2026-08-08 by sampling titles per tag)
Output: findings/edge-functions-deep-dive.md + per-feature no-reply table (stdout)

Three model passes over the Edge Functions feature slice (n=2,000):
  1. NMF topics over thread title + first message -> the frequent issues,
     with per-topic no-reply rate and recent share.
  2. Monroe log-odds (informative Dirichlet prior) unanswered vs answered ->
     the vocabulary of threads nobody answers.
  3. Per-topic quarterly volume -> what died in the slide and what persists.

Run:  .venv/bin/python pipeline/edge_deep_dive.py
"""
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.feature_extraction import text as sktext

BASE = Path(__file__).resolve().parent.parent
RECENT_FROM = pd.Timestamp("2025-08-08", tz="UTC")  # last 12 months of the window

STOP = list(sktext.ENGLISH_STOP_WORDS) + [
    "supabase", "https", "http", "com", "www", "ve", "don", "didn", "doesn",
    "isn", "im", "ive", "appreciated", "thanks", "thank", "hey", "hello",
]


def load_slice(feature: str) -> pd.DataFrame:
    meta = pd.read_parquet(BASE / "data" / "issues.parquet")
    enr = pd.read_parquet(BASE / "data" / "issues_enriched.parquet")[["id", "feature", "topic", "neg", "struggle"]]
    df = meta.merge(enr, on="id", how="left")
    df["text"] = (
        df["name"].fillna("") + "\n\n" + df["first_message_content"].fillna("")
    ).str.slice(0, 4000)
    # Discord's own thread message_count (excludes the opening post), NOT
    # responder_count — the latter is populated by our reply backfill, which
    # covers ~60% of the corpus, so it reads un-fetched threads as unanswered.
    df["unanswered"] = df["message_count"].fillna(0) == 0
    df["recent"] = df["created_at"] >= RECENT_FROM
    df["qtr"] = df["created_at"].dt.tz_localize(None).dt.to_period("Q").astype(str)
    return df


def nmf_topics(edge: pd.DataFrame, k: int = 10):
    vec = TfidfVectorizer(
        stop_words=STOP, ngram_range=(1, 2), min_df=5, max_df=0.6,
        sublinear_tf=True, strip_accents="unicode",
    )
    X = vec.fit_transform(edge["text"])
    model = NMF(n_components=k, init="nndsvda", random_state=42, max_iter=600)
    W = model.fit_transform(X)
    vocab = np.array(vec.get_feature_names_out())
    edge = edge.copy()
    edge["topic"] = W.argmax(axis=1)
    terms = {t: ", ".join(vocab[model.components_[t].argsort()[::-1][:8]]) for t in range(k)}
    return edge, terms


def topic_table(edge: pd.DataFrame, terms: dict) -> pd.DataFrame:
    g = edge.groupby("topic")
    tab = pd.DataFrame(
        {
            "n": g.size(),
            "pct": (100 * g.size() / len(edge)).round(1),
            "no_reply_pct": (100 * g["unanswered"].mean()).round(1),
            "recent_pct": (100 * g["recent"].mean()).round(1),
            "neg": g["neg"].mean().round(2),
            "top_terms": pd.Series(terms),
        }
    )
    return tab.sort_values("n", ascending=False)


def monroe_logodds(edge: pd.DataFrame, top_n: int = 20):
    """Log-odds with informative Dirichlet prior (Monroe et al.) — unanswered vs answered."""
    vec = CountVectorizer(stop_words=STOP, ngram_range=(1, 2), min_df=8, strip_accents="unicode")
    X = vec.fit_transform(edge["text"])
    vocab = np.array(vec.get_feature_names_out())
    un = edge["unanswered"].to_numpy()
    y_un = np.asarray(X[un].sum(axis=0)).ravel()
    y_an = np.asarray(X[~un].sum(axis=0)).ravel()
    alpha = y_un + y_an + 1.0
    n_un, n_an = y_un.sum() + alpha.sum(), y_an.sum() + alpha.sum()
    d = np.log((y_un + alpha) / (n_un - y_un - alpha)) - np.log(
        (y_an + alpha) / (n_an - y_an - alpha)
    )
    z = d / np.sqrt(1.0 / (y_un + alpha) + 1.0 / (y_an + alpha))
    order = z.argsort()[::-1]
    return (
        [(vocab[i], round(float(z[i]), 2)) for i in order[:top_n]],
        [(vocab[i], round(float(z[i]), 2)) for i in order[::-1][:top_n]],
    )


def main():
    df = load_slice("Edge Functions")
    edge = df[df.feature == "Edge Functions"]

    # per-feature no-reply table (replaces the unreliable tag-based chart)
    pf = (
        df[df.feature.notna()]
        .groupby("feature")
        .agg(n=("id", "size"), no_reply_pct=("unanswered", lambda s: 100 * s.mean()))
        .sort_values("no_reply_pct", ascending=False)
    )
    pf["no_reply_pct"] = pf["no_reply_pct"].round(1)

    edge, terms = nmf_topics(edge)
    tab = topic_table(edge, terms)
    over, under = monroe_logodds(edge)
    pv = edge.pivot_table(index="qtr", columns="topic", values="id", aggfunc="count").fillna(0)
    pv.columns = [f"#{c} {terms[c].split(',')[0]}" for c in pv.columns]

    out = []
    out.append("# Edge Functions deep dive — what goes unanswered\n")
    out.append(
        f"Slice: **{len(edge):,} threads** classified `Edge Functions` by the keyword taxonomy "
        f"(not the forum tag — tag IDs have drifted from their original labels, verified "
        f"2026-08-08 by sampling titles per tag; e.g. the tag mapped to 'Edge Functions' in "
        f"`dashboard-utils.ts` now contains generic Postgres/SQL threads).\n"
    )
    out.append(
        f"**{100 * edge['unanswered'].mean():.1f}% never got a reply.** "
        "Method: NMF (k=10) over title + first message; Monroe log-odds z-scores for "
        "unanswered-vs-answered vocabulary; quarterly per-topic volumes. "
        "Code: `pipeline/edge_deep_dive.py`.\n"
    )
    out.append(
        "> Recomputed 2026-08-10 on Discord's `message_count` (excludes the opening post). "
        "The earlier version of this file used `responder_count`, which our reply backfill "
        "only populates for ~60% of the corpus and which therefore read un-fetched threads "
        "as unanswered — it put this slice at 54.5%. Because the unanswered class is now a "
        "different (and much smaller) set of threads, the section-2 vocabulary below differs "
        "substantially from that version; the earlier \"unanswered = code vocabulary\" "
        "reading does not survive the correction.\n"
    )
    out.append("## 1. The frequent issues (NMF topics)\n")
    out.append("| topic | n | % of slice | no-reply % | recent-12mo % | neg affect |")
    out.append("|---|---:|---:|---:|---:|---:|")
    for t, r in tab.iterrows():
        out.append(f"| {r.top_terms} | {r.n} | {r.pct} | {r.no_reply_pct} | {r.recent_pct} | {r.neg} |")
    out.append("\n## 2. The vocabulary of threads nobody answers\n")
    out.append("Over-indexed in **unanswered** threads (z-score):\n")
    out.append(", ".join(f"**{t}** ({z})" for t, z in over))
    out.append("\n\nOver-indexed in **answered** threads:\n")
    out.append(", ".join(f"**{t}** ({z})" for t, z in under))
    out.append("\n\n## 3. What died and what persists (quarterly volume by topic)\n")
    out.append(pv.to_markdown())
    (BASE / "findings" / "edge-functions-deep-dive.md").write_text("\n".join(out))

    pd.set_option("display.width", 220)
    print("=== PER-FEATURE NO-REPLY (keyword taxonomy, replaces tag chart) ===")
    print(pf.to_string())
    print("\n=== EDGE FUNCTIONS TOPICS ===")
    print(tab.to_string())
    print("\nOVER-INDEXED IN UNANSWERED:", [t for t, _ in over[:15]])
    print("\nOVER-INDEXED IN ANSWERED:  ", [t for t, _ in under[:15]])
    print("\n=== QUARTERLY BY TOPIC ===")
    print(pv.to_string())


if __name__ == "__main__":
    main()
