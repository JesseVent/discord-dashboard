# -*- coding: utf-8 -*-
"""
Text-mining & classification analysis of the Supabase community Discord forum.

Goal: find *trending* issues / features that don't align with docs or cause
friction — using text-derived signals (repetition, affect, problem-type, struggle
lexicon), NOT operational metadata like response-time / resolution_status, which
measure community responsiveness rather than friction.

Open as a notebook: VS Code / Jupyter both treat the `# %%` cells as notebook cells.
Re-run anytime against fresh data — it pulls live from Supabase Postgres.

Setup (once):
    cp pipeline/.env.example .env       # then paste your pooled DB connection string
    uv pip install --python .venv/bin/python -r pipeline/requirements.txt
Run:
    .venv/bin/python pipeline/text_mining.py    # headless: writes findings/ + charts/
    # or open pipeline/text_mining.py as a notebook and step cell-by-cell
"""
# %% [markdown]
# # 0. Config & data connection
# %%
import os, re, json, sys, warnings
from pathlib import Path
import numpy as np
import pandas as pd
from dotenv import load_dotenv

warnings.filterwarnings("ignore")
# Resolve relative to this script (analysis/pipeline/), then walk up to analysis/ for outputs.
_HERE = Path(__file__).parent if "__file__" in globals() else Path.cwd()
ANALYSIS = _HERE.parent
load_dotenv(ANALYSIS / ".env")

CHARTS = ANALYSIS / "findings" / "charts"; CHARTS.mkdir(parents=True, exist_ok=True)
DATA   = ANALYSIS / "data";                DATA.mkdir(exist_ok=True)
FINDINGS = ANALYSIS / "findings"

pd.set_option("display.max_columns", 60)
pd.set_option("display.width", 160)

# %%
def load_issues():
    """Pull all issues from Supabase Postgres, or fall back to a parquet cache."""
    cache = DATA / "issues.parquet"
    url = os.environ.get("SUPABASE_DB_URL")
    # ponytail: prefer the parquet cache when it exists — avoids re-pulling 41k
    # rows on every run. Set REFRESH_DB=1 to force a fresh pull from the DB.
    if url and (not cache.exists() or os.environ.get("REFRESH_DB")):
        from sqlalchemy import create_engine, text
        engine = create_engine(url)
        sql = text("""
            SELECT id, name, created_at, archived_at, archived, locked,
                   message_count, responder_count, response_time_ms, is_answered,
                   resolution_status, applied_tags, first_message_content,
                   first_message_author_name, owner_username, duplicate_cluster_id
            FROM discord.issues
        """)
        df = pd.read_sql(sql, engine, parse_dates=["created_at", "archived_at"])
        df.to_parquet(cache, index=False)
        print(f"pulled {len(df):,} issues from DB -> cached at {cache.name}")
        return df
    if cache.exists():
        df = pd.read_parquet(cache)
        print(f"loaded {len(df):,} issues from {cache.name}")
        return df
    raise SystemExit(
        "No data: set SUPABASE_DB_URL in analysis/.env (copy from pipeline/.env.example), "
        "or place issues.parquet in analysis/data/")

issues = load_issues()
# applied_tags ships as a JSON string / list; normalise
def _tags(v):
    if v is None or (isinstance(v, float) and pd.isna(v)): return []
    if isinstance(v, list): return v
    try: return json.loads(v) if isinstance(v, str) else list(v)
    except Exception: return []
issues["tags"] = issues["applied_tags"].map(_tags)
issues["text"] = (issues["name"].fillna("") + "\n" + issues["first_message_content"].fillna("")).str.lower()
issues["words"] = issues["first_message_content"].fillna("").str.split().map(len)
issues["created"] = pd.to_datetime(issues["created_at"], utc=True)
issues = issues.sort_values("created").reset_index(drop=True)
print(issues["created"].min().date(), "->", issues["created"].max().date(),
      f"| n={len(issues):,} | median words={int(issues['words'].median())}")

# %% [markdown]
# # 1. Tag-ID -> label map (from src/lib/dashboard-utils.ts)
# %%
TAG_NAMES = {
    '1006941128441999421': 'Database', '1006941257274241114': 'Auth',
    '1006941275053899887': 'Edge Functions', '1006941348454207579': 'Realtime',
    '1006941367353737366': 'Storage', '1006941396873257041': 'Migrations',
    '1006941413101015110': 'Dashboard', '1050788587593023559': 'Self-Hosting',
    '1200092227200876554': 'Outage/Status', '1399429164783898665': 'Branching',
    '1399740852930089150': 'AI/Vectors',
}
exploded = issues.explode("tags")
tag_counts = (exploded["tags"].map(TAG_NAMES).fillna("(unmapped)")
              .value_counts().rename("n").reset_index())
print(tag_counts.to_string(index=False))

# %% [markdown]
# # 2. Feature classification (keyword taxonomy, priority order)
# Mirrors the validated SQL pass. First match wins (specific -> general).
# %%
FEATURE_RULES = [
    ("Outage/Status",     r"outage|\bdown\b|503|502|504|500|522|unavailable|status page|supabase down|all services"),
    ("Network/DNS",       r"dns|nxdomain|err_name_not_resolved|peering|\bregion\b|latency|timeout connecting|\bcdn\b|\bisp\b"),
    ("Auth/JWT/OAuth",    r"@supabase/ssr|supabase-ssr|\bauth\b|\bjwt\b|login|logout|\bsession\b|\btoken\b|oauth|\bmfa\b|2fa|magic link|\botp\b|verify email|gotrue"),
    ("RLS/Permissions",   r"\brls\b|row level security|\bpolicy\b|policies|permission denied|access denied|403|anon role|authenticated role"),
    ("Edge Functions",    r"edge function|edge functions|\bdeno\b|invoke|supabase functions|deploy function"),
    ("Realtime",          r"realtime|websocket|websockets|\bsubscribe\b|subscription|\bpresence\b|broadcast"),
    ("Storage",          r"\bstorage\b|\bbucket\b|\bs3\b|\bupload\b|presigned url|public url"),
    ("MCP",               r"\bmcp\b|model context protocol"),
    ("AI/Vectors",        r"vectorize|\bvectors\b|\bvector\b|embedding|embeddings|pgvector|semantic search"),
    ("Migrations/Branching", r"branching|\bbranch\b|migrations|\bmigration\b|db pull|db push|\bschema\b|\bseed\b|\breset\b"),
    ("Billing/Quotas",    r"quota|\bplan\b|billing|invoice|\bpaused\b|\bpause\b|exceeded|upgrade|downgrade|free plan|pro plan|team plan"),
    ("Dashboard/Access",  r"dashboard|cannot access|can't access|locked out|\bsuspended\b|sign in|sign up|login page|reset password"),
    ("TypeGen",           r"typegen|generated types|typescript types|supabase gen types|gen types"),
    ("Self-Hosting",      r"self-host|self hosting|selfhost|docker compose|self hosted"),
    ("CLI/Tooling",       r"supabase cli|npm run|\bbun\b|\byarn\b|\bcli\b|env var|environment variable"),
    ("Integrations",      r"next\.?js|nextjs|\bnuxt\b|\bvercel\b|\bnetlify\b|react native|\bflutter\b|\blaravel\b|\bfastapi\b|\bdjango\b|\bremix\b|\bsveltekit\b"),
    ("Database/Connectivity", r"database|postgres|pg_|pooler|connection pool|connection terminated|slow query|\bpsql\b|db connections|supavisor|\bsql\b"),
]
def classify_feature(t):
    for feat, pat in FEATURE_RULES:
        if re.search(pat, t):
            return feat
    return "Other/Unmatched"
issues["feature"] = issues["text"].map(classify_feature)
print(issues["feature"].value_counts().to_string())

# %% [markdown]
# # 3. Problem-type classification (text-derived, not metadata)
# how-to + confusion = doc friction; bug = product friction.
# %%
TYPE_LEXICONS = {
    "how-to":            [r"how do i", r"how to", r"how can i", r"how should i",
                          r"what's the best way", r"is there a way", r"can i ",
                          r"is it possible", r"best practice", r"recommended way",
                          r"should i ", r"how would i"],
    "bug":               [r"\bbug\b", r"\bbroken\b", r"not working", r"doesn't work",
                          r"does not work", r"\bcrash", r"throws?", r"exception",
                          r"traceback", r"unexpected", r"\berror\b", r"fails?", r"failed to"],
    "confusion/doc-gap": [r"docs say", r"documentation", r"undocumented", r"not documented",
                          r"can't find in docs", r"the docs", r"missing from docs",
                          r"outdated docs", r"docs are wrong", r"no docs",
                          r"confused", r"expected .* but", r"why does", r"inconsisten",
                          r"unclear", r"shouldn't it"],
    "feature-request":   [r"feature request", r"would be great", r"wish supabase",
                          r"please add", r"it would be nice", r"request:", r"feature:"],
    "setup":             [r"setup", r"install", r"getting started", r"configure",
                          r"\binit\b", r"can't connect", r"how to set up", r"set up"],
}
def classify_type(t):
    scores = {k: sum(1 for p in pats if re.search(p, t)) for k, pats in TYPE_LEXICONS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "other"
issues["ptype"] = issues["text"].map(classify_type)
print(issues["ptype"].value_counts(normalize=True).round(3).to_string())

# %% [markdown]
# # 4. Affect (VADER) + struggle/doc-blame lexicons
# Stored sentiment is ~empty, so we compute it from the text.
# %%
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
_an = SentimentIntensityAnalyzer()
def vader(t):
    return _an.polarity_scores(t or "")["compound"]
if "compound" not in issues.columns:
    issues["compound"] = issues["text"].map(vader)
issues["neg"] = issues["compound"] < -0.25        # frustrated-ish
issues["pos"] = issues["compound"] >  0.35

STRUGGLE = re.compile(r"gave up|giving up|about to switch|switching to|wasted|wasting time|"
                       r"so frustrated|hours trying|days trying|still stuck|still not working|"
                       r"no response|is anyone|last resort|ready to give up|anyone\?|please help")
DOCBLAME = re.compile(r"docs say|documentation|not documented|undocumented|can't find in docs|"
                      r"the docs|missing from docs|outdated docs|docs are wrong|no docs|unclear docs|"
                      r"where in the docs")
issues["struggle"] = issues["text"].map(lambda t: bool(STRUGGLE.search(t)))
issues["docblame"] = issues["text"].map(lambda t: bool(DOCBLAME.search(t)))
print("neg rate:", round(issues["neg"].mean(), 3),
      "| struggle rate:", round(issues["struggle"].mean(), 3),
      "| doc-blame rate:", round(issues["docblame"].mean(), 3))

# %% [markdown]
# # 5. Temporal trends — de-trended recent-vs-prior per feature
# Overall volume is declining, so a feature "trending" = declining slower than
# the corpus (detrended ratio > 1). The only truly *rising* feature bucked the decline.
# %%
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams.update({"figure.dpi": 110, "axes.spines.top": False,
                      "axes.spines.right": False, "font.size": 10})

RECENT_END = issues["created"].max()
recent0 = RECENT_END - pd.Timedelta(weeks=26)
prior0 = recent0 - pd.Timedelta(weeks=26)

monthly = (issues.set_index("created")
           .groupby([pd.Grouper(freq="MS"), "feature"]).size()
           .unstack("feature").fillna(0))
overall_recent = issues["created"].ge(recent0).sum()
overall_prior  = issues["created"].between(prior0, recent0, inclusive="left").sum()
overall_ratio = overall_recent / overall_prior
print(f"overall recent/prior ratio = {overall_ratio:.3f}  (baseline; <1 means corpus shrinking)")

feat_summary = []
for f in monthly.columns:
    rec = monthly[f].loc[recent0:].mean()
    pri = monthly[f].loc[prior0:recent0].mean()
    ratio = rec / pri if pri else np.nan
    sub = issues[issues["feature"] == f]
    feat_summary.append({
        "feature": f, "n": len(sub),
        "recent6mo": int(monthly[f].loc[recent0:].sum()),
        "prior6mo":  int(monthly[f].loc[prior0:recent0].sum()),
        "trend_ratio": round(ratio, 3),
        "detrended":  round(ratio / overall_ratio, 3) if ratio else np.nan,
        "neg_pct":    round(100 * sub["neg"].mean(), 1),
        "struggle_pct": round(100 * sub["struggle"].mean(), 1),
        "docblame_pct": round(100 * sub["docblame"].mean(), 1),
        "howto_pct":  round(100 * (sub["ptype"] == "how-to").mean(), 1),
        "confusion_pct": round(100 * (sub["ptype"] == "confusion/doc-gap").mean(), 1),
        "bug_pct":    round(100 * (sub["ptype"] == "bug").mean(), 1),
    })
fs = pd.DataFrame(feat_summary).sort_values("n", ascending=False)
print(fs.to_string(index=False))
fs.to_csv(CHARTS / "feature_summary.csv", index=False)

# %%
top_feats = monthly.sum().sort_values(ascending=False).head(12).index
fig, ax = plt.subplots(figsize=(11, 6))
for f in top_feats:
    ax.plot(monthly.index, monthly[f].rolling(3).mean(), label=f, lw=1.6)
ax.axvline(recent0, color="k", ls="--", lw=.8, alpha=.5)
ax.axvline(prior0, color="k", ls=":", lw=.8, alpha=.5)
ax.set_title("Monthly issue volume by feature (3-mo rolling)")
ax.set_ylabel("issues / month"); ax.legend(ncol=3, fontsize=8, loc="upper right")
plt.tight_layout(); plt.savefig(CHARTS / "trend_by_feature.png"); plt.close()

# %% [markdown]
# # 6. TF-IDF emerging terms — recent window vs baseline corpus
# Surfaces rising jargon / error strings that the keyword taxonomy misses.
# %%
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
STOP = list(ENGLISH_STOP_WORDS) + ["supabase", "im", "ive", "cant", "doesnt",
       "trying", "try", "work", "working", "use", "using", "issue", "get", "getting"]
vec = TfidfVectorizer(ngram_range=(1, 2), min_df=20, max_df=0.4,
                      stop_words=STOP, max_features=40000, sublinear_tf=True)
X = vec.fit_transform(issues["text"])
feat_names = np.array(vec.get_feature_names_out())

recent_mask = issues["created"].ge(recent0).values
prior_mask  = issues["created"].between(prior0, recent0, inclusive="left").values
def top_terms(mask, k=25):
    sums = X[mask].sum(axis=0).A1
    s = pd.Series(sums, index=feat_names)
    # distinctiveness = recent mean tfidf / prior mean tfidf (avoid pure-volume terms)
    return s
recent_scores = pd.Series(X[recent_mask].mean(axis=0).A1, index=feat_names)
prior_scores  = pd.Series(X[prior_mask].mean(axis=0).A1, index=feat_names)
emerging = ((recent_scores / prior_scores.clip(lower=1e-3))
            .where(recent_scores > 1e-4)
            .dropna().sort_values(ascending=False))
print("=== Emerging distinctive terms (recent vs prior 6mo) ===")
print(emerging.head(30).round(2).to_string())
emerging.head(50).to_csv(CHARTS / "emerging_terms.csv")
# Render the chart from the fresh series (replaces the stale make_charts.py PNG
# that was hardcoded from last session's MCP pull).
em_top = emerging.head(25).iloc[::-1]  # reverse so largest is on top
fig, ax = plt.subplots(figsize=(9, 8))
ax.barh(em_top.index, em_top.values, color="#F58518")
ax.axvline(1.0, color="k", ls="--", lw=.7, alpha=.5)
ax.set_xlabel("lift = recent-vs-prior TF-IDF ratio (>1 = rising)")
ax.set_title("Emerging distinctive terms (last 6mo vs prior 6mo)")
plt.tight_layout(); plt.savefig(CHARTS / "emerging_terms.png"); plt.close()

# %% [markdown]
# # 7. NMF topic model — mine the unmatched mass + latent themes
# %%
from sklearn.decomposition import NMF
N_TOPICS = 30
nmf_vec = TfidfVectorizer(ngram_range=(1, 2), min_df=10, max_df=0.35,
                          stop_words=STOP, max_features=30000, sublinear_tf=True)
Xn = nmf_vec.fit_transform(issues["text"])
nmf_terms = np.array(nmf_vec.get_feature_names_out())
nmf = NMF(n_components=N_TOPICS, random_state=0, max_iter=400)
W = nmf.fit_transform(Xn)
H = nmf.components_
dominant = W.argmax(axis=1)
issues["topic"] = dominant
# Persist the enriched frame (feature + topic + affect) for downstream triage
# scripts, so they don't have to re-run the keyword taxonomy / NMF.
issues[["id", "name", "created_at", "feature", "topic", "neg", "struggle",
        "first_message_content"]].to_parquet(DATA / "issues_enriched.parquet", index=False)
print("=== NMF topics (top terms) ===")
topic_rows = []
for t in range(N_TOPICS):
    top = nmf_terms[H[t].argsort()[-10:][::-1]]
    members = issues[issues["topic"] == t]
    recent = members["created"].ge(recent0).mean()
    ratio = (members["created"].ge(recent0).sum() /
             max(1, members["created"].between(prior0, recent0, inclusive="left").sum()))
    topic_rows.append({"topic": t, "size": len(members), "recent_share": round(recent, 3),
                       "trend_ratio": round(ratio, 2),
                       "neg_pct": round(100*members["neg"].mean(),1),
                       "struggle_pct": round(100*members["struggle"].mean(),1),
                       "docblame_pct": round(100*members["docblame"].mean(),1),
                       "top_terms": ", ".join(top)})
topics = pd.DataFrame(topic_rows).sort_values("size", ascending=False)
print(topics[["topic","size","trend_ratio","neg_pct","struggle_pct","docblame_pct","top_terms"]].to_string(index=False))
topics.to_csv(CHARTS / "nmf_topics.csv", index=False)

# %% [markdown]
# # 8. Repetition density — concentration of issues in NMF topics
# ponytail: replaced spherical k-means here. MiniBatchKMeans on L2-normalised
# issue TF-IDF collapsed ~99.6% of issues into one catch-all cluster (max
# cluster ~41k regardless of max_df) — the corpus is too lexically homogeneous
# for broad thematic k-means to separate. NMF topics (sec 7) are already
# well-separated, so per-feature topic concentration is a real "same pain,
# repeated N times" signal without a second clustering pass.
# %%
rep = (issues.groupby(["feature", "topic"])
       .agg(n=("id", "size"),
            neg_pct=("neg", lambda s: round(100*s.mean(), 1)),
            struggle_pct=("struggle", lambda s: round(100*s.mean(), 1)))
       .reset_index())
rep["top_terms"] = rep["topic"].map(
    lambda t: ", ".join(nmf_terms[H[t].argsort()[-8:][::-1]]))
rep = rep.sort_values("n", ascending=False)
print("=== Largest feature x topic concentrations (repeated pain) ===")
print(rep.head(25).to_string(index=False))
rep.to_csv(CHARTS / "repetition_clusters.csv", index=False)

# %% [markdown]
# # 9. Friction score per feature (text-derived composite)
# Components: negative-affect rate, struggle rate, doc-blame rate,
# how-to+confusion density, and max repetition cluster within the feature.
# %%
def z(s):
    return (s - s.mean()) / s.std() if s.std() > 0 else s * 0

g = fs.set_index("feature")
g["docgap_proxy"] = g["howto_pct"] + g["confusion_pct"] + g["docblame_pct"]
# maxrepeat = size of each feature's largest NMF topic (how concentrated its
# pain is into one repeated topic). Replaces degenerate k-means cluster size.
maxrep = (issues.groupby("feature")["topic"]
          .apply(lambda s: pd.Series(s).value_counts().max() if len(s) else 0))
g["maxrepeat"] = maxrep.reindex(g.index).fillna(0)
components = ["neg_pct", "struggle_pct", "docgap_proxy", "maxrepeat"]
for c in components:
    g[c + "_z"] = z(g[c])
g["friction"] = g[[c + "_z" for c in components]].mean(axis=1)
g["rising"] = g["detrended"] > 1.1
result = g[["n", "trend_ratio", "detrended", "rising", "neg_pct", "struggle_pct",
            "docblame_pct", "howto_pct", "confusion_pct", "bug_pct",
            "docgap_proxy", "maxrepeat", "friction"]].sort_values("friction", ascending=False)
print("=== Friction score per feature (higher = more text-evidenced friction) ===")
print(result.round(2).to_string())
result.round(2).to_csv(CHARTS / "friction_by_feature.csv")

# %% [markdown]
# # 10. Priority matrix — rising x friction x doc-gap
# The actual deliverable: trending features that don't align with docs or cause friction.
# %%
m = g.copy()
m["trend_rank"]   = m["detrended"].rank(ascending=False)
m["friction_rank"] = m["friction"].rank(ascending=False)
m["docgap_rank"]   = m["docgap_proxy"].rank(ascending=False)
m["priority"] = m["trend_rank"] + m["friction_rank"] + m["docgap_rank"]
priority = m.sort_values("priority")[["n", "trend_ratio", "detrended", "rising",
       "friction", "docgap_proxy", "struggle_pct", "neg_pct", "bug_pct", "priority"]]
print("=== PRIORITY: trending x friction x doc-gap (lower priority score = act first) ===")
print(priority.round(2).to_string())
priority.round(2).to_csv(CHARTS / "priority_matrix.csv")

# bubble plot
fig, ax = plt.subplots(figsize=(11, 7))
sc = ax.scatter(m["detrended"], m["friction"],
                s=np.sqrt(m["n"])*4, c=m["docgap_proxy"],
                cmap="viridis", alpha=.75, edgecolor="k", lw=.4)
ax.axvline(1.0, color="k", ls="--", lw=.7, alpha=.5)
ax.axhline(0, color="k", ls="--", lw=.7, alpha=.5)
for f, row in m.iterrows():
    ax.annotate(f, (row["detrended"], row["friction"]), fontsize=7.5, alpha=.85)
ax.set_xlabel("detrended trend ratio (>1 = rising vs corpus)")
ax.set_ylabel("friction composite (z-score)")
ax.set_title("Trending x Friction x Doc-gap  (size=volume, colour=doc-gap proxy)")
fig.colorbar(sc, label="doc-gap proxy")
plt.tight_layout(); plt.savefig(CHARTS / "priority_matrix.png"); plt.close()

# %% [markdown]
# # 11. Drill: top friction clusters within the rising features (the "where it's coming from")
# %%
rising_feats = m[m["rising"]].index.tolist()
print("rising features:", rising_feats)
# Drill by NMF topic (well-separated) — surfaces the specific sub-pain driving
# each rising feature. Replaces the degenerate k-means repcluster drill-down.
drill = (issues[issues["feature"].isin(rising_feats)]
         .groupby(["feature", "topic"])
         .agg(n=("id", "size"), neg=("neg", "mean"), struggle=("struggle", "mean"),
              docblame=("docblame", "mean"), howto=("ptype", lambda s: (s=="how-to").mean()))
         .reset_index())
drill["top_terms"] = drill["topic"].map(
    lambda t: ", ".join(nmf_terms[H[t].argsort()[-8:][::-1]]))
drill = drill[drill["n"] >= 8].sort_values(["feature", "n"], ascending=[True, False])
print(drill.head(40).to_string(index=False))
drill.to_csv(CHARTS / "rising_drilldown.csv", index=False)

# %% [markdown]
# # 12. (Optional) reply-layer affect for the high-friction subset
# Pulls replies only for issues in rising+friction topics — keeps the 270k-reply
# table from dominating. Reply text is used for *affect/escalation*, not the old
# "doc-resolved" keyword heuristic (which was noise).
# %%
def load_replies(issue_ids=None, limit=200000):
    url = os.environ.get("SUPABASE_DB_URL")
    cache = DATA / "replies.parquet"
    if url and (not cache.exists() or os.environ.get("REFRESH_DB")):
        from sqlalchemy import create_engine, text
        engine = create_engine(url)
        q = "SELECT issue_id, author_username, content, timestamp FROM discord.replies " \
            "WHERE content ~ '\\S' ORDER BY timestamp DESC LIMIT :lim"
        params = {"lim": limit}
        df = pd.read_sql(text(q), engine, params=params, parse_dates=["timestamp"])
        df.to_parquet(cache, index=False)
        return df
    if cache.exists():
        return pd.read_parquet(cache)
    return pd.DataFrame()

if os.environ.get("SUPABASE_DB_URL"):
    reps = load_replies()
    if len(reps):
        reps["compound"] = reps["content"].fillna("").map(vader)
        reps["struggle"] = reps["content"].fillna("").str.lower().map(lambda t: bool(STRUGGLE.search(t)))
        reps["escalation"] = reps["content"].fillna("").str.lower().map(
            lambda t: bool(re.search(r"still not working|any update|bump|anyone\?|still stuck|has this been", t)))
        rep_agg = reps.groupby("issue_id").agg(
            reply_neg=("compound", "min"), reply_struggle=("struggle", "any"),
            reply_escalation=("escalation", "any")).reset_index()
        issues = issues.merge(rep_agg, left_on="id", right_on="issue_id", how="left")
        print("reply-layer affect joined. escalation rate:",
              round(float(issues["reply_escalation"].fillna(False).mean()), 4))

# %% [markdown]
# # 13. Findings report -> findings/findings.md
# %%
def md_table(df, cols=None, head=40):
    d = df[cols] if cols else df
    return d.head(head).to_markdown(index=False, floatfmt=".2f")

rising = priority[priority["rising"]].copy()
lines = []
lines.append("# Discord forum text-mining — findings\n")
lines.append(f"Data: {issues['created'].min().date()} → {issues['created'].max().date()} "
             f"({len(issues):,} issues). Overall recent/prior ratio = **{overall_ratio:.2f}** "
             f"(corpus is shrinking), so *trending* = detrended ratio > 1 (bucking the decline).\n")
lines.append("Friction is text-derived (affect + struggle + doc-blame + how-to/confusion density "
             "+ NMF-topic concentration) — not response-time / resolution_status, which measure "
             "responsiveness, not friction.\n")
lines.append("## Priority matrix (trending × friction × doc-gap)\n")
lines.append(md_table(priority.reset_index().rename(columns={"index": "feature"}),
                      cols=["feature","n","trend_ratio","detrended","rising",
                            "friction","docgap_proxy","struggle_pct","neg_pct","bug_pct"]))
lines.append("\n## Rising features drill-down (top NMF topics)\n")
lines.append(md_table(drill, cols=["feature","n","neg","struggle","docblame","howto","top_terms"], head=30))
lines.append("\n## Emerging distinctive terms (recent 6mo vs prior)\n")
lines.append(", ".join(emerging.head(40).round(1).index.tolist()))
lines.append("\n## NMF topics (largest)\n")
lines.append(md_table(topics, cols=["topic","size","trend_ratio","neg_pct",
                                    "struggle_pct","docblame_pct","top_terms"], head=30))
Path(FINDINGS / "findings.md").write_text("\n".join(lines))
print("wrote", FINDINGS / "findings.md")
print("\ncharts ->", CHARTS)
print("done.")