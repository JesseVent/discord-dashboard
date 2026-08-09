# Discord Forum Friction Audit — Analysis

4-year friction audit of the Supabase Community Discord (`discord.issues` + `discord.replies`).
Pipeline, ML layer, and written findings, organized by reader.

```
analysis/
├── report/      ← the deliverable: open this
│   ├── report.html      ops-war-room dashboard, dark-first, self-contained
│   └── companion.md     role-fit one-pager
│
├── findings/    ← the written analysis
│   ├── findings.md      text-mining synthesis (NMF, VADER, friction signals)
│   ├── triage.md        reply-layer triage across 96 high-friction threads
│   └── charts/          PNG + CSV rendered from the data
│
├── pipeline/    ← the code that produced everything
│   ├── text_mining.py   end-to-end notebook: pull → parquet → NMF/VADER/repetition → friction table
│   ├── make_charts.py   renders charts/ from the parquet cache (no DB needed)
│   ├── requirements.txt
│   └── .env.example
│
├── data/        ← parquet cache (gitignored)
│   ├── issues.parquet
│   ├── issues_enriched.parquet
│   └── replies.parquet
│
├── .venv/       ← Python venv (gitignored)
└── .env         ← real creds (gitignored) — copy from pipeline/.env.example
```

## How to read

**Start at `report/report.html`.** It is self-contained — open in any browser, no server needed,
works in light or dark mode. The dashboard is the entry point.

**Go deeper with `findings/findings.md`** for the NMF topic decomposition, friction signals, and
drill-down methodology, and **`findings/triage.md`** for the by-hand coding of 96 threads into
root-cause / resolution / fix categories.

**Re-run the analysis** by following `pipeline/text_mining.py` (top-to-bottom) after populating
`.env` from `pipeline/.env.example`. The parquet cache in `data/` skips the DB pull on re-runs.

## Method summary

Detrended ratio (recent ÷ prior, normalized to corpus baseline) to separate real movement from a
shrinking corpus. NMF topic modeling for unsupervised topic discovery over TF-IDF; VADER for
affect. Regex-based doc-blame and struggle lexicons. Hand-coded triage layer over a stratified
sample of 96 high-friction reply threads.

Source data: `discord.issues` (41,392) + `discord.replies` (270,020) over 2022-08-11 → 2026-08-08.
