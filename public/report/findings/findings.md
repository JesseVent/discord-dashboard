# Discord forum text-mining — findings

Data: 2022-08-11 → 2026-08-08 (41,392 issues). Overall recent/prior ratio = **0.82** (corpus is shrinking), so *trending* = detrended ratio > 1 (bucking the decline).

Friction is text-derived (affect + struggle + doc-blame + how-to/confusion density + NMF-topic concentration) — not response-time / resolution_status, which measure responsiveness, not friction.

Note on **resolution**: the forum's "resolved" state is an **optional self-assessment by the asker and is not enforced** (and the dashboard's `resolution_status` is a keyword heuristic on top of that). Solved threads routinely go unmarked, so every resolution figure in these documents is a **floor**; where a rate is quoted it comes from reading the reply layer, not from the marker.

## Priority matrix (trending × friction × doc-gap)

| feature               |     n |   trend_ratio |   detrended | rising   |   friction |   docgap_proxy |   struggle_pct |   neg_pct |   bug_pct |
|:----------------------|------:|--------------:|------------:|:---------|-----------:|---------------:|---------------:|----------:|----------:|
| Auth/JWT/OAuth         |  12848 |         0.73 |       0.90 | False    |       0.76 |          42.30 |           2.90 |     29.90 |     32.30 |
| Storage                |   1875 |         0.71 |       0.88 | False    |       0.28 |          41.40 |           2.20 |     25.70 |     27.10 |
| Realtime               |   1322 |         0.65 |       0.81 | False    |       0.22 |          42.30 |           3.00 |     25.00 |     23.10 |
| Edge Functions         |   2000 |         0.44 |       0.54 | False    |       0.51 |          41.40 |           2.60 |     30.00 |     29.80 |
| Migrations/Branching   |   2257 |         0.75 |       0.93 | False    |       0.05 |          39.00 |           2.50 |     31.00 |     30.70 |
| Billing/Quotas         |   1336 |         1.40 |       1.74 | True     |      -0.01 |          32.10 |           6.30 |     18.60 |     17.10 |
| Outage/Status          |   2645 |         1.28 |       1.58 | True     |       0.26 |          20.50 |           5.90 |     46.90 |     52.60 |
| Network/DNS            |    637 |         1.32 |       1.63 | True     |       0.02 |          27.50 |           5.80 |     35.30 |     38.50 |
| Dashboard/Access       |   1051 |         0.93 |       1.15 | True     |      -0.04 |          33.30 |           5.20 |     28.70 |     25.30 |
| Other/Unmatched        |   7386 |         0.75 |       0.93 | False    |      -0.12 |          37.10 |           2.40 |     24.00 |     19.60 |
| RLS/Permissions        |   2332 |         0.58 |       0.72 | False    |      -0.03 |          35.00 |           3.00 |     31.10 |     35.80 |
| MCP                    |     90 |         0.76 |       0.94 | False    |      -0.14 |          32.20 |           2.20 |     42.20 |     41.10 |
| Database/Connectivity  |   3274 |         0.56 |       0.70 | False    |      -0.16 |          38.70 |           2.20 |     27.20 |     28.20 |
| Integrations           |    981 |         0.60 |       0.74 | False    |      -0.38 |          40.90 |           1.90 |     25.80 |     25.80 |
| CLI/Tooling            |    538 |         0.23 |       0.28 | False    |      -0.06 |          40.10 |           2.80 |     31.20 |     30.10 |
| Self-Hosting           |    451 |         0.33 |       0.41 | False    |      -0.40 |          37.90 |           1.80 |     25.50 |     22.80 |
| AI/Vectors             |    256 |         0.29 |       0.36 | False    |      -0.33 |          34.80 |           4.30 |     25.00 |     37.10 |
| TypeGen                |    113 |         0.12 |       0.15 | False    |      -0.45 |          37.20 |           1.80 |     29.20 |     31.00 |

## Rising features drill-down (top NMF topics)

| feature        |   n |   neg |   struggle |   docblame |   howto | top_terms                                                                         |
|:---------------|----:|------:|-----------:|-----------:|--------:|:----------------------------------------------------------------------------------|
| Billing/Quotas | 667 |  0.13 |       0.04 |       0.03 |    0.27 | plan, pro, free, pro plan, free plan, upgrade, limit, tier                        |
| Billing/Quotas | 220 |  0.22 |       0.11 |       0.00 |    0.24 | project, stuck, pausing, project stuck, restore, paused, dashboard, stuck pausing |
| Billing/Quotas |  97 |  0.10 |       0.24 |       0.03 |    0.19 | help, need, need help, appreciated, thanks, help appreciated, hi, ve              |
| Billing/Quotas |  59 |  0.24 |       0.07 |       0.00 |    0.24 | account, login, access, github, support, github account, log, dashboard           |
| Billing/Quotas |  32 |  0.38 |       0.03 |       0.00 |    0.25 | email, link, confirmation, magic, magic link, send, emails, signup                |
| Billing/Quotas |  29 |  0.41 |       0.07 |       0.00 |    0.21 | query, sql, editor, sql query, sql editor, select, run, run sql                   |
| Billing/Quotas |  29 |  0.45 |       0.00 |       0.07 |    0.24 | error, connection, database, connect, postgres, failed, db, pooler                |
| Billing/Quotas |  28 |  0.18 |       0.00 |       0.00 |    0.39 | table, column, tables, data, schema, columns, users table, rows                   |
| Billing/Quotas |  25 |  0.20 |       0.00 |       0.08 |    0.32 | self, hosted, self hosted, docker, hosting, self hosting, host, self host         |
| Billing/Quotas |  21 |  0.19 |       0.05 |       0.00 |    0.33 | new, create, create new, new user, new project, creating, created, creating new   |
| Billing/Quotas |  17 |  0.35 |       0.00 |       0.06 |    0.24 | api, key, api key, keys, service, rest, request, anon                             |
| Billing/Quotas |  15 |  0.47 |       0.00 |       0.13 |    0.53 | local, db, cli, migration, development, locally, migrations, remote               |
| Billing/Quotas |  14 |  0.14 |       0.07 |       0.14 |    0.36 | docs, https com, com docs, com, guides, docs guides, https, guides auth           |
| Billing/Quotas |  14 |  0.21 |       0.07 |       0.00 |    0.29 | delete, deleted, delete user, deleting, update, failed delete, delete row, remove |
| Billing/Quotas |  12 |  0.17 |       0.00 |       0.08 |    0.50 | id, null, key, uuid, select, user_id, text, foreign                               |
| Billing/Quotas |  12 |  0.42 |       0.00 |       0.00 |    0.17 | github, github com, https github, com, https, issues, discussions, com orgs       |
| Billing/Quotas |  12 |  0.50 |       0.08 |       0.00 |    0.42 | json, type, import, deno, ts, js, headers, types                                  |
| Network/DNS    |  90 |  0.62 |       0.08 |       0.00 |    0.12 | error, connection, database, connect, postgres, failed, db, pooler                |
| Network/DNS    |  72 |  0.32 |       0.17 |       0.03 |    0.11 | project, stuck, pausing, project stuck, restore, paused, dashboard, stuck pausing |
| Network/DNS    |  57 |  0.37 |       0.02 |       0.07 |    0.33 | storage, bucket, upload, file, files, image, images, buckets                      |
| Network/DNS    |  51 |  0.53 |       0.02 |       0.04 |    0.12 | json, type, import, deno, ts, js, headers, types                                  |
| Network/DNS    |  46 |  0.15 |       0.13 |       0.04 |    0.24 | plan, pro, free, pro plan, free plan, upgrade, limit, tier                        |
| Network/DNS    |  41 |  0.37 |       0.05 |       0.00 |    0.32 | edge, functions, edge function, edge functions, function, deno, deploy, webhook   |
| Network/DNS    |  35 |  0.17 |       0.14 |       0.00 |    0.20 | help, need, need help, appreciated, thanks, help appreciated, hi, ve              |
| Network/DNS    |  30 |  0.23 |       0.03 |       0.03 |    0.30 | self, hosted, self hosted, docker, hosting, self hosting, host, self host         |
| Network/DNS    |  22 |  0.41 |       0.00 |       0.09 |    0.14 | email, link, confirmation, magic, magic link, send, emails, signup                |
| Network/DNS    |  20 |  0.20 |       0.00 |       0.05 |    0.20 | new, create, create new, new user, new project, creating, created, creating new   |
| Network/DNS    |  19 |  0.32 |       0.00 |       0.11 |    0.26 | api, key, api key, keys, service, rest, request, anon                             |
| Network/DNS    |  18 |  0.22 |       0.00 |       0.11 |    0.11 | github, github com, https github, com, https, issues, discussions, com orgs       |
| Network/DNS    |  15 |  0.27 |       0.00 |       0.00 |    0.40 | query, sql, editor, sql query, sql editor, select, run, run sql                   |

## Emerging distinctive terms (recent 6mo vs prior)

restricted, ticket su, 2026, locked, billing, su, support ticket, banned, project ref, healthy, cycle, resume, ref, unhealthy, ticket, pausing state, github account, 2fa, mfa, production project, restriction, billing cycle, gb, account email, 522, accidentally, business, period, ownership, force, submitted, cached egress, egress, gmail com, id su, unpause, ticket id, connection timeout, card, hi project

## NMF topics (largest)

|   topic |   size |   trend_ratio |   neg_pct |   struggle_pct |   docblame_pct | top_terms                                                                                                          |
|--------:|-------:|--------------:|----------:|---------------:|---------------:|:-------------------------------------------------------------------------------------------------------------------|
|      24 |   2449 |          0.62 |     22.10 |           1.60 |           3.50 | table, column, tables, data, schema, columns, users table, rows, foreign, add                                      |
|      29 |   2193 |          0.62 |     30.60 |           2.50 |           5.50 | email, link, confirmation, magic, magic link, send, emails, signup, otp, smtp                                      |
|      28 |   1933 |          0.99 |     12.70 |          11.00 |           5.10 | help, need, need help, appreciated, thanks, help appreciated, hi, ve, hello, advance                               |
|      14 |   1920 |          0.60 |     58.70 |           3.80 |           2.90 | error, connection, database, connect, postgres, failed, db, pooler, server, 5432                                   |
|       7 |   1908 |          0.54 |     27.10 |           1.80 |           5.00 | storage, bucket, upload, file, files, image, images, buckets, storage bucket, uploading                            |
|      22 |   1898 |          0.69 |     27.10 |           1.60 |          11.00 | auth, server, session, nextjs, client, helpers, auth helpers, js, cookies, ssr                                     |
|       3 |   1815 |          0.46 |     26.90 |           2.30 |           5.60 | edge, functions, edge function, edge functions, function, deno, deploy, webhook, logs, invoke                      |
|       4 |   1703 |          0.52 |     18.70 |           1.60 |           5.50 | user, users, auth, auth users, users table, admin, sign, user id, logged, auth user                                |
|      26 |   1628 |          0.34 |     48.50 |           2.30 |           5.20 | json, type, import, deno, ts, js, headers, types, env, response                                                    |
|      19 |   1591 |          1.73 |     16.30 |           4.80 |           2.20 | plan, pro, free, pro plan, free plan, upgrade, limit, tier, free tier, usage                                       |
|       1 |   1583 |          0.35 |     26.70 |           1.40 |           3.90 | id, null, key, uuid, select, user_id, text, foreign, foreign key, primary                                          |
|       2 |   1558 |          0.41 |     55.90 |           2.40 |           5.60 | const, data, await, error, const data, error await, console, data error, console log, log                          |
|       6 |   1470 |          0.48 |     31.70 |           1.20 |           6.10 | local, db, cli, migration, development, locally, migrations, remote, dev, local development                        |
|      23 |   1430 |          2.00 |     23.10 |           7.30 |           1.70 | account, login, access, github, support, github account, log, dashboard, email, locked                             |
|      12 |   1337 |          0.56 |     31.00 |           2.80 |           7.00 | google, oauth, url, provider, redirect, sign, login, auth, google oauth, app                                       |
|      16 |   1292 |          0.75 |     28.70 |           2.80 |           5.70 | github, github com, https github, com, https, issues, discussions, com orgs, orgs discussions, orgs                |
|      13 |   1266 |          0.39 |     25.90 |           2.40 |           7.30 | realtime, channel, payload, subscribe, event, changes, subscription, messages, postgres_changes, broadcast         |
|       9 |   1230 |          0.74 |     30.00 |           2.10 |           2.70 | query, sql, editor, sql query, sql editor, select, run, run sql, queries, failed run                               |
|      15 |   1191 |          0.53 |     25.40 |           2.90 |           7.30 | api, key, api key, keys, service, rest, request, anon, api keys, service role                                      |
|      10 |   1175 |          0.59 |     27.50 |           2.10 |           8.30 | self, hosted, self hosted, docker, hosting, self hosting, host, self host, instance, version                       |
|       8 |   1153 |          1.41 |     28.00 |           9.40 |           1.50 | project, stuck, pausing, project stuck, restore, paused, dashboard, stuck pausing, ticket, support                 |
|      11 |   1091 |          0.43 |     22.00 |           2.10 |           4.00 | rls, policy, rls policy, authenticated, uid, policies, auth uid, role, create policy, select                       |
|      20 |   1037 |          0.48 |     27.80 |           1.90 |           6.20 | token, access, jwt, refresh, access token, refresh token, tokens, session, invalid, expired                        |
|      27 |   1035 |          0.46 |     26.50 |           2.50 |           4.70 | new, create, create new, new user, new project, creating, created, creating new, failed create, create user        |
|      17 |   1029 |          0.33 |     22.80 |           1.60 |           4.30 | function, trigger, public, end, insert, begin, language, returns, plpgsql, return                                  |
|       5 |    921 |          0.27 |     29.50 |           1.50 |          27.50 | docs, https com, com docs, com, guides, docs guides, https, guides auth, guide, reference                          |
|      25 |    784 |          0.89 |     30.00 |           2.80 |           4.60 | delete, deleted, delete user, deleting, update, failed delete, delete row, remove, row, deletion                   |
|      21 |    756 |          0.88 |     28.80 |           3.00 |           6.70 | password, reset, reset password, password reset, forgot, link, email, forgot password, reset email, email password |
|      18 |    678 |          0.79 |     35.70 |           3.50 |           5.80 | row, level, level security, row level, security, new row, security policy, row violates, violates, violates row    |
|       0 |    338 |          0.71 |      8.00 |           0.90 |           2.70 | way, like, want, know, database, just, best, possible, data, app                                                   |

## Reply-layer triage — rising-feature trio (Billing/Quotas, Outage/Status, Network/DNS)

The drill-down above is text-derived surfacing. A reply-layer triage of **96 high-friction threads** across the three rising features confirms the trio is rising because of **incidents, not doc gaps**: ~66% of threads are `bug`+`outage`, only ~6% are pure doc-gap, and the reply-resolution rate is **~21%** — with virtually all resolved threads being user-misconfig that self-resolves, and **no bug/outage thread resolved by replies** (recovery = wait days for a support agent).

The single highest-leverage fix class — converged across all 6 triage batches — is **self-service recovery for stuck platform-side state transitions** (PAUSING/upgrade/resize/restore-stuck, ghost-projects, NXDOMAIN), followed by **support SLA + auto-escalation for prod-down paid plans** and **honest per-region/per-project status** (no more "All Systems Operational" while paying customers' DBs are dead). A security gap — revoking the HS256 signing secret still honors the legacy `apikey` path for ~12h+ — also surfaced.

Full synthesis (aggregate root-cause counts, per-batch resolution rates, 7 cross-batch dominant patterns, prioritized fix list, dashboard implications): **[`triage.md`](./triage.md)**.

## Response-layer findings (reply metadata, verified 2026-08-08)

The thread-text analysis above never used the reply/coverage metadata (`responder_count`, `response_time_ms`, reply authors). These change the framing from "what's rising" to "who answers":

- **~14% of threads never receive a reply from anyone else — not 53%.** *(Corrected 2026-08-10; supersedes the `responder_count`-based figure published earlier, see the retraction below.)* Discord's own `message_count` (thread metadata, excludes the opening post) is zero on **11.6%** of threads; among threads whose replies were fetched, a further **2.31%** have replies only from the asker, giving ~13.6% with no external answer. By product area (keyword taxonomy — forum tag IDs have drifted from their original labels, verified 2026-08-08 by sampling titles per tag, so tag-sliced stats are unreliable): **TypeGen 26.5%, Self-Hosting 23.3%, AI/Vectors 21.9%, Integrations 18.6%, CLI/Tooling 17.5%** are worst — the specialist areas where volunteer generalists can't help. The rising trio is the *best*-served (Billing/Quotas 3.9%, Outage/Status 7.7%, Network/DNS 11.3%) — they get acknowledged, but triage shows acknowledgment ≠ resolution. **The ranking is unchanged from the retracted version; only the levels were wrong.** Answerability still tracks how generalist the area is, not volume. Edge Functions slice deep dive: [`edge-functions-deep-dive.md`](./edge-functions-deep-dive.md).

  **Retraction — the 53% figure.** It came from `responder_count`, a column our own reply backfill populates. The backfill has only ever reached ~60% of the corpus, so **17,231 threads (41.6%) have messages but no fetched replies** and were counted as unanswered; for 2022–2023 the field reads 97–99% no-reply, which is plainly coverage, not silence. On the 27,622 threads where both exist, `message_count` equals the fetched reply count on **98.5%** (r = 0.90, identical medians of 5), so it is the sound basis. Use `message_count`, never `responder_count`, for coverage questions.
- **Coverage is improving, and the improvement is real:** quarterly no-reply fell from a 17.8% peak (2024 Q2) to **4.5% / 4.0% / 2.5%** in 2025 Q4 → 2026 Q2. Because this is thread metadata rather than backfilled replies, there is no ~30-day pipeline lag to correct for, and the earlier "Q3-2026 at 70.5%" artefact disappears entirely (2026 Q3-to-date reads 2.9%).
- **Volume, though, is falling:** total messages per quarter peaked at 23,723 (2023 Q3) and is down to 12,053 (2026 Q2) — but messages *per thread* rose from ~6.8 (2022–2024) to 8.5–9.4 (2025–2026). Last four quarters vs the four before: threads −19.5%, messages −13.3%, messages per thread **+7.8%**. Fewer questions, deeper conversations on each.
- **Answer concentration is one volunteer deep:** `garyaustin` authored **27.0% of all 270,020 replies** (73,069), steady at 24–28% every quarter for two years; the top 12 repliers hold ≈41%. **None of the top 12 identify as Supabase staff** — the top two explicitly describe themselves as volunteer moderators ("this is a user helping user forum"). No bots in the top 20. The corpus decline is therefore not a responder exodus — response capacity was never diversified in the first place.
- **Repeat askers:** 17.4% of thread owners (3+ threads) produce 54.1% of all threads (max 110 by one user). Repeat concentration is highest in Edge Functions (65.2%) and Auth (61.7%) — chronic config pain, not lifecycle ops.
- **Outage/Status tag usage regime-changed in Aug 2025** (5–25/mo → 58–109/mo), but the tag only existed from 2024 and the keyword-classified outage volume rose only ~1.3–1.5× over the same window — the step is a **moderation-behaviour signal**, not a reliability one. (An earlier version of this section claimed a real 7–10× regime change; corrected after independent fact-check — see [`fact-check.md`](./fact-check.md).)

**All headline claims in this file were independently re-derived by 6 adversarial fact-check agents on 2026-08-08.** Verdicts, corrected magnitudes (detrended trio = 1.74/1.63/1.58 with Dashboard/Access 1.15 a fourth riser; Auth peak decline −71% not −86%; Edge memory threads ~30 not 113; plan-mention unique threads 3.5–3.9% not 4.1%), and surviving caveats: **[`fact-check.md`](./fact-check.md)**.
- **Why the fallers fell:** no cliff. Forum volume peaked Q3 2023 (3,544/qtr); the recent −18% is the tail of a 3-year decline. Edge Functions fell −81% and Auth-tagged −86% from peak vs forum −55% — a gradual multi-year slide consistent with compounding doc/SDK fixes (e.g. `@supabase/ssr` migration landing), not one big fix. Causal attribution not possible from this data.
