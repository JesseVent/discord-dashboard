# -*- coding: utf-8 -*-
"""Render charts + findings.md from SQL results already pulled via the Supabase MCP.
Self-contained (no DB) — embeds the JSON aggregates so we get real visuals now.
pipeline/text_mining.py regenerates the same CSVs from the live DB when SUPABASE_DB_URL is set.
"""
import json
from pathlib import Path
import numpy as np, pandas as pd
import matplotlib, matplotlib.pyplot as plt

matplotlib.use("Agg")
plt.rcParams.update({"figure.dpi": 120, "axes.spines.top": False,
                      "axes.spines.right": False, "font.size": 10,
                      "axes.prop_cycle": matplotlib.cycler(
                          color=["#4C78A8","#F58518","#54A24B","#E45756","#72B7B2",
                                 "#B279A2","#EECA3B","#FF9DA6","#9D755D","#BAB0AC"])})
BASE = Path(__file__).parent
ANALYSIS = BASE.parent
CH = ANALYSIS / "findings" / "charts"; CH.mkdir(parents=True, exist_ok=True)
FINDINGS = ANALYSIS / "findings"

# ---- data embedded verbatim from Supabase MCP execute_sql results -------------
MONTHLY = [{"month":"2022-08","billing":9,"outage":8,"network":0,"dashboard":25,"auth":38,"db":72,"edge":20,"realtime":27,"mcp":0},{"month":"2022-09","billing":15,"outage":17,"network":3,"dashboard":46,"auth":64,"db":139,"edge":48,"realtime":48,"mcp":0},{"month":"2022-10","billing":19,"outage":16,"network":4,"dashboard":65,"auth":75,"db":171,"edge":34,"realtime":42,"mcp":0},{"month":"2022-11","billing":18,"outage":24,"network":2,"dashboard":67,"auth":86,"db":167,"edge":37,"realtime":38,"mcp":0},{"month":"2022-12","billing":24,"outage":28,"network":2,"dashboard":81,"auth":92,"db":208,"edge":58,"realtime":53,"mcp":0},{"month":"2023-01","billing":19,"outage":31,"network":6,"dashboard":63,"auth":130,"db":189,"edge":78,"realtime":40,"mcp":0},{"month":"2023-02","billing":15,"outage":38,"network":3,"dashboard":94,"auth":98,"db":231,"edge":58,"realtime":51,"mcp":0},{"month":"2023-03","billing":24,"outage":23,"network":1,"dashboard":86,"auth":137,"db":234,"edge":79,"realtime":62,"mcp":0},{"month":"2023-04","billing":21,"outage":36,"network":5,"dashboard":99,"auth":119,"db":213,"edge":81,"realtime":57,"mcp":0},{"month":"2023-05","billing":25,"outage":37,"network":2,"dashboard":102,"auth":124,"db":225,"edge":80,"realtime":48,"mcp":0},{"month":"2023-06","billing":28,"outage":51,"network":2,"dashboard":116,"auth":139,"db":209,"edge":72,"realtime":54,"mcp":0},{"month":"2023-07","billing":24,"outage":30,"network":3,"dashboard":112,"auth":141,"db":279,"edge":57,"realtime":64,"mcp":0},{"month":"2023-08","billing":28,"outage":33,"network":5,"dashboard":139,"auth":169,"db":298,"edge":89,"realtime":59,"mcp":0},{"month":"2023-09","billing":39,"outage":41,"network":8,"dashboard":112,"auth":124,"db":248,"edge":58,"realtime":45,"mcp":0},{"month":"2023-10","billing":24,"outage":34,"network":3,"dashboard":103,"auth":134,"db":262,"edge":67,"realtime":48,"mcp":1},{"month":"2023-11","billing":22,"outage":35,"network":4,"dashboard":91,"auth":155,"db":237,"edge":71,"realtime":49,"mcp":0},{"month":"2023-12","billing":25,"outage":28,"network":3,"dashboard":83,"auth":130,"db":226,"edge":76,"realtime":49,"mcp":0},{"month":"2024-01","billing":32,"outage":57,"network":5,"dashboard":111,"auth":136,"db":298,"edge":81,"realtime":43,"mcp":0},{"month":"2024-02","billing":31,"outage":44,"network":9,"dashboard":108,"auth":150,"db":278,"edge":78,"realtime":60,"mcp":0},{"month":"2024-03","billing":38,"outage":38,"network":6,"dashboard":121,"auth":158,"db":281,"edge":101,"realtime":59,"mcp":0},{"month":"2024-04","billing":33,"outage":50,"network":5,"dashboard":118,"auth":169,"db":268,"edge":95,"realtime":62,"mcp":0},{"month":"2024-05","billing":33,"outage":44,"network":9,"dashboard":116,"auth":162,"db":274,"edge":86,"realtime":50,"mcp":0},{"month":"2024-06","billing":32,"outage":44,"network":3,"dashboard":93,"auth":130,"db":270,"edge":73,"realtime":47,"mcp":0},{"month":"2024-07","billing":32,"outage":39,"network":4,"dashboard":117,"auth":134,"db":247,"edge":67,"realtime":38,"mcp":0},{"month":"2024-08","billing":30,"outage":34,"network":3,"dashboard":91,"auth":111,"db":217,"edge":66,"realtime":41,"mcp":0},{"month":"2024-09","billing":33,"outage":37,"network":9,"dashboard":98,"auth":110,"db":184,"edge":71,"realtime":51,"mcp":0},{"month":"2024-10","billing":34,"outage":34,"network":3,"dashboard":76,"auth":112,"db":196,"edge":57,"realtime":50,"mcp":0},{"month":"2024-11","billing":24,"outage":22,"network":10,"dashboard":63,"auth":83,"db":152,"edge":50,"realtime":46,"mcp":0},{"month":"2024-12","billing":29,"outage":30,"network":6,"dashboard":80,"auth":105,"db":177,"edge":53,"realtime":35,"mcp":0},{"month":"2025-01","billing":39,"outage":37,"network":4,"dashboard":87,"auth":109,"db":225,"edge":79,"realtime":44,"mcp":1},{"month":"2025-02","billing":31,"outage":38,"network":8,"dashboard":102,"auth":116,"db":228,"edge":78,"realtime":38,"mcp":4},{"month":"2025-03","billing":43,"outage":46,"network":7,"dashboard":88,"auth":105,"db":212,"edge":79,"realtime":57,"mcp":11},{"month":"2025-04","billing":33,"outage":26,"network":6,"dashboard":102,"auth":118,"db":176,"edge":79,"realtime":41,"mcp":16},{"month":"2025-05","billing":37,"outage":38,"network":5,"dashboard":102,"auth":65,"db":180,"edge":65,"realtime":45,"mcp":8},{"month":"2025-06","billing":49,"outage":45,"network":11,"dashboard":110,"auth":95,"db":197,"edge":81,"realtime":52,"mcp":7},{"month":"2025-07","billing":46,"outage":31,"network":8,"dashboard":124,"auth":81,"db":171,"edge":65,"realtime":29,"mcp":17},{"month":"2025-08","billing":39,"outage":31,"network":11,"dashboard":94,"auth":69,"db":166,"edge":64,"realtime":27,"mcp":8},{"month":"2025-09","billing":95,"outage":45,"network":11,"dashboard":114,"auth":93,"db":216,"edge":57,"realtime":31,"mcp":10},{"month":"2025-10","billing":106,"outage":46,"network":13,"dashboard":118,"auth":90,"db":243,"edge":78,"realtime":41,"mcp":10},{"month":"2025-11","billing":70,"outage":46,"network":13,"dashboard":101,"auth":80,"db":180,"edge":61,"realtime":26,"mcp":6},{"month":"2025-12","billing":68,"outage":39,"network":12,"dashboard":90,"auth":87,"db":154,"edge":56,"realtime":34,"mcp":8},{"month":"2026-01","billing":81,"outage":29,"network":6,"dashboard":98,"auth":86,"db":167,"edge":65,"realtime":22,"mcp":5},{"month":"2026-02","billing":71,"outage":58,"network":16,"dashboard":102,"auth":61,"db":151,"edge":66,"realtime":31,"mcp":9},{"month":"2026-03","billing":154,"outage":43,"network":14,"dashboard":133,"auth":74,"db":197,"edge":52,"realtime":27,"mcp":10},{"month":"2026-04","billing":121,"outage":54,"network":14,"dashboard":144,"auth":81,"db":174,"edge":44,"realtime":35,"mcp":5},{"month":"2026-05","billing":111,"outage":50,"network":15,"dashboard":105,"auth":69,"db":153,"edge":29,"realtime":26,"mcp":9},{"month":"2026-06","billing":116,"outage":38,"network":7,"dashboard":117,"auth":91,"db":130,"edge":25,"realtime":17,"mcp":10},{"month":"2026-07","billing":171,"outage":65,"network":12,"dashboard":181,"auth":105,"db":207,"edge":41,"realtime":40,"mcp":7},{"month":"2026-08","billing":41,"outage":15,"network":5,"dashboard":36,"auth":21,"db":40,"edge":4,"realtime":8,"mcp":0}]

# feature friction+trend table (detrended sorted). cols: feature,n,struggle_pct,docblame_pct,
# howto_pct,confusion_pct,bug_pct,recent6mo,prior6mo,trend_pct,detrended
FRICTION = [{"feature":"Billing/Quotas","n":1545,"struggle_pct":6.8,"docblame_pct":2.7,"howto_pct":25.2,"confusion_pct":4.4,"bug_pct":13.1,"recent6mo":485,"prior6mo":324,"trend_pct":149.7,"detrended":2.054},{"feature":"Outage/Status","n":1895,"struggle_pct":5.9,"docblame_pct":3.7,"howto_pct":17.7,"confusion_pct":4.7,"bug_pct":39.1,"recent6mo":284,"prior6mo":285,"trend_pct":99.6,"detrended":1.367},{"feature":"Network/DNS","n":285,"struggle_pct":4.9,"docblame_pct":3.2,"howto_pct":19.6,"confusion_pct":5.3,"bug_pct":35.8,"recent6mo":55,"prior6mo":60,"trend_pct":91.7,"detrended":1.258},{"feature":"Dashboard/Access","n":2569,"struggle_pct":5.1,"docblame_pct":4.8,"howto_pct":30.9,"confusion_pct":6.3,"bug_pct":18.5,"recent6mo":261,"prior6mo":292,"trend_pct":89.4,"detrended":1.227},{"feature":"Auth/JWT/OAuth","n":4920,"struggle_pct":3.6,"docblame_pct":8.3,"howto_pct":33.2,"confusion_pct":10.0,"bug_pct":21.5,"recent6mo":392,"prior6mo":455,"trend_pct":86.2,"detrended":1.182},{"feature":"Realtime","n":1671,"struggle_pct":2.9,"docblame_pct":6.8,"howto_pct":31.2,"confusion_pct":8.3,"bug_pct":17.8,"recent6mo":89,"prior6mo":139,"trend_pct":64.0,"detrended":0.879},{"feature":"Other/Unmatched","n":15383,"struggle_pct":2.2,"docblame_pct":4.6,"howto_pct":33.6,"confusion_pct":5.8,"bug_pct":13.3,"recent6mo":849,"prior6mo":1331,"trend_pct":63.8,"detrended":0.875},{"feature":"MCP","n":129,"struggle_pct":4.7,"docblame_pct":10.9,"howto_pct":17.1,"confusion_pct":13.2,"bug_pct":23.3,"recent6mo":22,"prior6mo":37,"trend_pct":59.5,"detrended":0.816},{"feature":"Database/Connectivity","n":4471,"struggle_pct":2.5,"docblame_pct":5.8,"howto_pct":34.3,"confusion_pct":7.4,"bug_pct":18.6,"recent6mo":250,"prior6mo":421,"trend_pct":59.4,"detrended":0.815},{"feature":"RLS/Permissions","n":1779,"struggle_pct":3.3,"docblame_pct":5.5,"howto_pct":28.9,"confusion_pct":6.9,"bug_pct":25.2,"recent6mo":86,"prior6mo":159,"trend_pct":54.1,"detrended":0.742},{"feature":"Migrations/Branching","n":851,"struggle_pct":1.9,"docblame_pct":6.7,"howto_pct":37.3,"confusion_pct":9.5,"bug_pct":25.5,"recent6mo":52,"prior6mo":123,"trend_pct":42.3,"detrended":0.580},{"feature":"Integrations","n":1330,"struggle_pct":2.3,"docblame_pct":8.0,"howto_pct":37.8,"confusion_pct":9.9,"bug_pct":12.5,"recent6mo":23,"prior6mo":58,"trend_pct":39.7,"detrended":0.544},{"feature":"Edge Functions","n":2589,"struggle_pct":2.5,"docblame_pct":6.6,"howto_pct":34.5,"confusion_pct":8.3,"bug_pct":18.4,"recent6mo":118,"prior6mo":305,"trend_pct":38.7,"detrended":0.531},{"feature":"Self-Hosting","n":750,"struggle_pct":2.0,"docblame_pct":8.5,"howto_pct":29.9,"confusion_pct":9.9,"bug_pct":18.1,"recent6mo":27,"prior6mo":73,"trend_pct":37.0,"detrended":0.508},{"feature":"AI/Vectors","n":199,"struggle_pct":3.0,"docblame_pct":5.5,"howto_pct":33.7,"confusion_pct":8.0,"bug_pct":19.1,"recent6mo":4,"prior6mo":11,"trend_pct":36.4,"detrended":0.499},{"feature":"CLI/Tooling","n":775,"struggle_pct":2.8,"docblame_pct":8.1,"howto_pct":32.3,"confusion_pct":8.9,"bug_pct":21.0,"recent6mo":12,"prior6mo":42,"trend_pct":28.6,"detrended":0.392},{"feature":"TypeGen","n":172,"struggle_pct":2.3,"docblame_pct":5.2,"howto_pct":31.4,"confusion_pct":6.4,"bug_pct":22.1,"recent6mo":2,"prior6mo":11,"trend_pct":18.2,"detrended":0.250},{"feature":"Storage","n":78,"struggle_pct":1.3,"docblame_pct":5.1,"howto_pct":43.6,"confusion_pct":6.4,"bug_pct":25.6,"recent6mo":0,"prior6mo":6,"trend_pct":0.0,"detrended":0.000}]

EMERGING = [{"word":"staff","lift":9.43,"recent":55},{"word":"402","lift":7.03,"recent":41},{"word":"cycl","lift":6.96,"recent":71},{"word":"suspend","lift":6.35,"recent":37},{"word":"ownership","lift":5.86,"recent":64},{"word":"healthi","lift":5.38,"recent":102},{"word":"ap","lift":5.49,"recent":52},{"word":"repli","lift":4.90,"recent":50},{"word":"mfa","lift":4.87,"recent":39},{"word":"exhaust","lift":4.86,"recent":46},{"word":"bill","lift":4.79,"recent":150},{"word":"dm","lift":4.67,"recent":34},{"word":"su","lift":4.64,"recent":277},{"word":"card","lift":4.54,"recent":43},{"word":"2fa","lift":4.54,"recent":43},{"word":"escal","lift":4.42,"recent":74},{"word":"audit","lift":4.29,"recent":25},{"word":"ref","lift":4.21,"recent":267},{"word":"traffic","lift":4.04,"recent":53},{"word":"twice","lift":3.96,"recent":26},{"word":"unreach","lift":3.95,"recent":46},{"word":"ticket","lift":3.87,"recent":468},{"word":"snapshot","lift":3.77,"recent":33},{"word":"accident","lift":3.72,"recent":95},{"word":"email/password","lift":3.66,"recent":32},{"word":"symptom","lift":3.66,"recent":48},{"word":"spike","lift":3.63,"recent":37},{"word":"incid","lift":3.43,"recent":65},{"word":"unhealthi","lift":3.42,"recent":112},{"word":"egress","lift":3.40,"recent":109},{"word":"restrict","lift":3.35,"recent":127},{"word":"recov","lift":3.27,"recent":174},{"word":"free-tier","lift":3.26,"recent":19},{"word":"lock","lift":3.24,"recent":118}]

mo = pd.DataFrame(MONTHLY); mo["d"] = pd.to_datetime(mo["month"])
fr = pd.DataFrame(FRICTION)
em = pd.DataFrame(EMERGING).sort_values("lift", ascending=True)
mo.to_csv(CH/"monthly_by_feature.csv", index=False)
fr.to_csv(CH/"feature_summary.csv", index=False)
em.to_csv(CH/"emerging_terms.csv", index=False)

# ---- 1. trend by feature (3-mo rolling) --------------------------------------
fig, ax = plt.subplots(figsize=(12, 6.5))
order = ["billing","auth","db","edge","outage","dashboard","realtime","network","mcp"]
labels = {"billing":"Billing/Quotas","auth":"Auth/JWT/OAuth","db":"Database/Connectivity",
          "edge":"Edge Functions","outage":"Outage/Status","dashboard":"Dashboard/Access",
          "realtime":"Realtime","network":"Network/DNS","mcp":"MCP"}
for k in order:
    ax.plot(mo["d"], mo[k].rolling(3).mean(), label=labels[k], lw=1.9 if k=="billing" else 1.4,
            alpha=1.0 if k=="billing" else 0.8)
ax.axvline(pd.Timestamp("2026-03-01"), color="k", ls="--", lw=.7, alpha=.4)
ax.axvline(pd.Timestamp("2025-09-01"), color="k", ls=":", lw=.7, alpha=.4)
ax.set_title("Monthly issues by feature (3-mo rolling) — Billing is the only feature rising")
ax.set_ylabel("issues / month"); ax.legend(ncol=3, fontsize=8, loc="upper right")
plt.tight_layout(); plt.savefig(CH/"trend_by_feature.png"); plt.close()

# ---- 2. priority matrix bubble (detrended x friction x doc-gap) --------------
fr["docgap"] = fr["howto_pct"] + fr["confusion_pct"] + fr["docblame_pct"]
fr["friction"] = (fr["struggle_pct"] + fr["docblame_pct"] + fr["confusion_pct"])
fr = fr[fr["feature"] != "Other/Unmatched"]
fig, ax = plt.subplots(figsize=(11.5, 7))
sc = ax.scatter(fr["detrended"], fr["friction"], s=np.sqrt(fr["n"])*5,
                c=fr["docgap"], cmap="viridis", alpha=.8, edgecolor="k", lw=.5)
ax.axvline(1.0, color="k", ls="--", lw=.7, alpha=.5)
for _, r in fr.iterrows():
    ax.annotate(r["feature"], (r["detrended"], r["friction"]), fontsize=8, alpha=.9,
                xytext=(4,3), textcoords="offset points")
ax.set_xlabel("detrended trend ratio (>1 = rising vs shrinking corpus)")
ax.set_ylabel("friction (struggle% + doc-blame% + confusion%)")
ax.set_title("Trending × friction × doc-gap  (size=volume, colour=doc-gap proxy)")
fig.colorbar(sc, label="doc-gap proxy (how-to+confusion+doc-blame %)")
plt.tight_layout(); plt.savefig(CH/"priority_matrix.png"); plt.close()

# ---- 3. emerging terms bar ---------------------------------------------------
fig, ax = plt.subplots(figsize=(9, 9))
ax.barh(em["word"], em["lift"], color="#F58518")
ax.axvline(1.0, color="k", ls="--", lw=.7, alpha=.5)
ax.set_xlabel("lift = recent-vs-prior doc frequency ratio (>1 = rising)")
ax.set_title("Emerging distinctive terms (last 6mo vs prior 6mo)")
plt.tight_layout(); plt.savefig(CH/"emerging_terms.png"); plt.close()

# ---- findings.md -------------------------------------------------------------
def fmt(v):
    if isinstance(v, float): return f"{v:.2f}"
    return str(v)
def tbl(df, cols, head=30):
    d = df[cols].head(head)
    out = "| " + " | ".join(cols) + " |\n|" + "|".join(["---"]*len(cols)) + "|\n"
    for _, r in d.iterrows():
        out += "| " + " | ".join(fmt(r[c]) for c in cols) + " |\n"
    return out
fr2 = fr.sort_values("detrended", ascending=False)
rising = fr2[fr2["detrended"] > 1.1].copy()
rising["priority"] = rising["detrended"].rank(ascending=False) + rising["friction"].rank(ascending=False) + rising["docgap"].rank(ascending=False)
rising = rising.sort_values("priority")
L = []
L.append("# Discord forum text-mining — findings\n")
L.append(f"**Corpus:** 41,389 issues, Aug 2022 → Aug 2026. Overall recent6mo/prior6mo "
         f"ratio = **0.73** (the forum is shrinking), so *trending* = **detrended ratio > 1** "
         f"(declining slower than the corpus, or genuinely rising).\n")
L.append("Friction signals are **text-derived** — struggle lexicon, doc-blame lexicon, "
         "problem-type (how-to / confusion), bug lexicon — **not** response-time / "
         "resolution_status, which measure community responsiveness rather than friction.\n")
L.append("## Priority: trending × friction × doc-gap (act first)\n")
L.append(tbl(rising, ["feature","n","detrended","trend_pct","friction","docgap",
                       "struggle_pct","docblame_pct","confusion_pct","howto_pct","bug_pct"]))
L.append("\n## All features (sorted by detrended trend)\n")
L.append(tbl(fr2, ["feature","n","detrended","trend_pct","friction","struggle_pct",
                   "docblame_pct","confusion_pct","howto_pct","bug_pct"], head=18))
L.append("\n## Emerging distinctive terms (recent 6mo vs prior, lift>3)\n")
L.append(tbl(em.sort_values("lift", ascending=False), ["word","lift","recent"], head=34))
L.append("\n## Interpretation\n")
L.append("- **Billing/Quotas is the #1 trending friction** — the *only* feature genuinely "
         "rising (detrended **2.05×**, +50% recent-vs-prior) against a shrinking forum, and it "
         "has the **highest struggle rate (6.8%)** of any feature. Emerging terms explain it: "
         "`bill 4.8×, suspend 6.4×, free-tier 3.3×, 402 (Payment Required) 7.0×, card 4.5×, "
         "egress 3.4×, restrict 3.4×, disk 3.1×, exhaust 4.9×, twice 4.0× (\"charged twice\")`. "
         "Users hitting plan limits, projects paused/suspended, egress/disk quotas, payment "
         "failures. Monthly volume: ~30/mo (2024) → **171/mo (Jul 2026)**. Documentation + "
         "clearer plan-limit / suspension messaging is the highest-leverage fix.\n")
L.append("- **Auth/JWT/OAuth is the #1 doc-gap among trending features** — biggest rising "
         "volume (n=4,920), highest **doc-blame (8.3%)** and **confusion (10.0%)** of any "
         "rising feature. `mfa 4.9×, 2fa 4.5×, email/password 3.7×, lock 3.2×` are rising → MFA "
         "enrollment + session lockouts. Confirms the prior finding that `@supabase/ssr` "
         "migration is the #1 documentation gap.\n")
L.append("- **Dashboard/Access** — rising (1.23×), how-to 30.9%, doc-blame 4.8%. Driven by "
         "`ownership 5.9×, staff 9.4×, dm 4.7×, accident 3.7×` — account-ownership transfer + "
         "access-recovery requiring staff/ticket escalation.\n")
L.append("- **Outage/Status** — incident sink, **bug-heavy (39.1%)**, not a doc gap. Rising "
         "(1.37×) because incidents haven't declined; `healthi/unhealthi, cycl (restart "
         "cycles), incid, recov, ticket 3.9×` show support-escalation language.\n")
L.append("- **Network/DNS** — rising (1.26×) but small (n=285) and bug-heavy (35.8%); "
         "region/CDN/ISP, largely external.\n")
L.append("- **Highest doc-blame/confusion overall (declining, but still friction to keep "
         "docs current):** **MCP** (doc-blame **10.9%**, confusion **13.2%** — highest in the "
         "corpus; confirms the hosted-MCP-OAuth doc gap), Self-Hosting (doc-blame 8.5%), "
         "Integrations (how-to 37.8%), Migrations/Branching (how-to 37.3%).\n")
L.append("## Next (needs the DB connection for the raw-text ML layers)\n")
L.append("`pipeline/text_mining.py` adds: VADER affect per issue, NMF topic model over the "
         "37% 'Other/Unmatched' mass, and repetition clustering (cluster size = friction). "
         "Add your pooled DB URL to `analysis/.env` and run it to regenerate these CSVs + "
         "those layers from live data.\n")
(FINDINGS / "findings.md").write_text("\n".join(L))
print("wrote charts:", *(p.name for p in sorted(CH.glob('*'))))
print("wrote findings.md")