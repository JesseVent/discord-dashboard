# Edge Functions deep dive — what goes unanswered

Slice: **2,000 threads** classified `Edge Functions` by the keyword taxonomy (not the forum tag — tag IDs have drifted from their original labels, verified 2026-08-08 by sampling titles per tag; e.g. the tag mapped to 'Edge Functions' in `dashboard-utils.ts` now contains generic Postgres/SQL threads).

**16.7% never got a reply.** Method: NMF (k=10) over title + first message; Monroe log-odds z-scores for unanswered-vs-answered vocabulary; quarterly per-topic volumes. Code: `pipeline/edge_deep_dive.py`.

> Recomputed 2026-08-10 on Discord's `message_count` (excludes the opening post). The earlier version of this file used `responder_count`, which our reply backfill only populates for ~60% of the corpus and which therefore read un-fetched threads as unanswered — it put this slice at 54.5%. Because the unanswered class is now a different (and much smaller) set of threads, the section-2 vocabulary below differs substantially from that version; the earlier "unanswered = code vocabulary" reading does not survive the correction.

## 1. The frequent issues (NMF topics)

| topic | n | % of slice | no-reply % | recent-12mo % | neg affect |
|---|---:|---:|---:|---:|---:|
| local, deploy, locally, cli, error, project, running, edge functions | 399 | 20.0 | 17.8 | 22.3 | 0.41 |
| edge functions, api, use, like, way, using, want, need | 356 | 17.8 | 21.3 | 13.5 | 0.09 |
| webhook, table, trigger, database, edge function, insert, id, row | 295 | 14.8 | 10.5 | 13.9 | 0.19 |
| deno, import, esm, sh, esm sh, npm, package, ts | 253 | 12.6 | 22.1 | 5.5 | 0.33 |
| limit, time, edge function, logs, cpu, edge functions, cpu time, memory | 225 | 11.2 | 12.4 | 24.4 | 0.24 |
| const, json, response, headers, return, req, await, content | 150 | 7.5 | 14.0 | 5.3 | 0.5 |
| index, file, ts, js, error, index ts, ext, async | 129 | 6.4 | 20.9 | 14.0 | 0.7 |
| cron, job, cron job, edge function, schedule, jobs, run, invoke edge | 103 | 5.2 | 10.7 | 16.5 | 0.12 |
| self, hosted, self hosted, functions self, edge functions, version, hosted version, hosting | 73 | 3.6 | 16.4 | 23.3 | 0.25 |
| eszip v0, land eszip, v0 30, eszip, v0, 30, wasm, anonymous deno | 17 | 0.8 | 5.9 | 0.0 | 0.94 |

## 2. The vocabulary of threads nobody answers

Over-indexed in **unanswered** threads (z-score):

**postgres** (4.17), **certificate** (3.97), **invalid** (3.0), **13** (2.62), **image** (2.35), **14** (2.29), **vercel edge** (2.23), **2024** (2.19), **pool** (2.12), **customer** (2.1), **000** (2.1), **drizzle** (2.1), **types** (2.06), **components** (2.04), **docker container** (1.99), **believe** (1.87), **transaction** (1.87), **build** (1.81), **serverless** (1.72), **clients** (1.7)


Over-indexed in **answered** threads:

**trigger** (-1.83), **dashboard** (-1.63), **code** (-1.45), **free** (-1.41), **cron** (-1.35), **function** (-1.34), **secret** (-1.33), **invoke edge** (-1.3), **pdf** (-1.28), **table** (-1.27), **delete** (-1.23), **object** (-1.22), **jobs** (-1.21), **self hosted** (-1.18), **world** (-1.17), **seconds** (-1.17), **key** (-1.13), **anon** (-1.11), **30** (-1.07), **update** (-1.06)


## 3. What died and what persists (quarterly volume by topic)

| qtr    |   #0 edge functions |   #1 deno |   #2 const |   #3 self |   #4 webhook |   #5 eszip v0 |   #6 limit |   #7 index |   #8 cron |   #9 local |
|:-------|--------------------:|----------:|-----------:|----------:|-------------:|--------------:|-----------:|-----------:|----------:|-----------:|
| 2022Q3 |                   9 |        11 |          6 |         2 |            6 |             0 |          7 |          2 |         4 |          8 |
| 2022Q4 |                  18 |        18 |         16 |         3 |           12 |             3 |          6 |          3 |         7 |         16 |
| 2023Q1 |                  34 |        32 |         14 |         3 |           19 |             7 |         12 |          6 |         5 |         22 |
| 2023Q2 |                  17 |        26 |         23 |         7 |           24 |             4 |         11 |         13 |         5 |         29 |
| 2023Q3 |                  33 |        16 |         19 |         5 |            8 |             0 |         20 |          8 |        12 |         19 |
| 2023Q4 |                  26 |        21 |         14 |         3 |           26 |             2 |         14 |          9 |         5 |         31 |
| 2024Q1 |                  36 |        28 |         13 |        11 |           24 |             1 |         15 |         15 |        10 |         36 |
| 2024Q2 |                  22 |        18 |         10 |         8 |           38 |             0 |         10 |         14 |         6 |         28 |
| 2024Q3 |                  31 |        14 |         10 |         3 |           30 |             0 |         13 |         15 |         5 |         28 |
| 2024Q4 |                  28 |        12 |          6 |         1 |           15 |             0 |         10 |          7 |         7 |         19 |
| 2025Q1 |                  18 |        18 |          4 |         2 |           19 |             0 |         23 |          7 |         9 |         29 |
| 2025Q2 |                  26 |        18 |          3 |         8 |           26 |             0 |         24 |          9 |         8 |         31 |
| 2025Q3 |                  21 |        10 |          5 |         2 |           14 |             0 |         15 |          7 |        10 |         31 |
| 2025Q4 |                  20 |         6 |          6 |         5 |           18 |             0 |         17 |          3 |         6 |         30 |
| 2026Q1 |                   9 |         2 |          1 |         9 |            9 |             0 |         13 |          9 |         4 |         32 |
| 2026Q2 |                   7 |         3 |          0 |         1 |            6 |             0 |         10 |          2 |         0 |          7 |
| 2026Q3 |                   1 |         0 |          0 |         0 |            1 |             0 |          5 |          0 |         0 |          3 |
## 4. The binding constraint is memory, not duration (verified 2026-08-08; counts corrected after fact-check)

No "10 second" execution limit exists on Supabase Edge Functions (that's Vercel's Hobby serverless limit) — **zero threads** report hitting a Supabase 10s wall (2 literal "10s" mentions: one asking whether Supabase shares *Vercel's* limit, one about scheduling). What threads actually hit, per current docs vs corpus (counts independently re-derived; an earlier version of this table overstated memory 3×):

| Limit | Value (docs) | Threads citing it |
|---|---|---|
| **Worker-boot errors** ("InvalidWorkerResponse" etc.) | — | **~50** (the cited "5407" code appears 0×) |
| **Memory** | 256MB | **~30–34** — image processing, unzip, PDF, AI calls |
| CPU time | 2s per request | 30 |
| Wall clock | 150s free / 400s paid | 13–17 |

Threads citing "150MB" against the docs' current 256MB show the limit was raised mid-corpus — old threads still rank in search and mislead. The persisting Edge Functions pain is **invisible limits discovered by crashing**: no self-serve memory knob, no per-invocation memory in logs, and worker-boot failures with no actionable error. The community answer is "restructure or move the work off Edge Functions."

**Fix:** publish the limits playbook (memory streaming patterns, which workloads don't fit Edge Functions and where to move them), surface per-invocation memory usage in function logs, and give worker-boot failures a named, actionable error.
