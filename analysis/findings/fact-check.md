# Independent fact-check — 2026-08-08 (amended 2026-08-10)

Six independent agents re-derived every headline claim from the raw parquet cache and live DB, with their own code, regexes, and samples (they were instructed to distrust the pipeline). 15 CONFIRMED, 7 PARTIAL, 2 REFUTED. Corrections below are already applied to `report.html`, `findings.md`, `edge-functions-deep-dive.md`, and the carousel.

## Amendment 2026-08-10 — the 53% no-reply claim is RETRACTED

The fact-check pass confirmed "53% never answered" because all six agents re-derived it from the **same field the pipeline used**, `responder_count`. Agreement between agents reading one column is not verification of what that column means.

`responder_count` is populated by our reply backfill, which has only ever covered ~60% of the corpus. **17,231 threads (41.6%) have messages but zero fetched replies**, and the field reads 97–99% no-reply for 2022–2023 — coverage, not silence.

Discord's own `message_count` (thread metadata, excludes the opening post) is the sound basis:

| Check | Result |
|---|---|
| `message_count` = fetched reply count | **98.5%** of the 27,622 threads where both exist (r = 0.90, medians 5 and 5) |
| Threads with `message_count = 0` | **11.6%** (live DB, n = 41,697) |
| Fetched threads where every reply is the asker's own | **2.31%** |
| ⇒ no reply from anyone else | **~13.6%**, not 53.2% |
| Last full quarter (2026 Q2) | **2.5%** |

Per-feature ranking survives intact (TypeGen worst, Billing best); the levels were inflated ~4–5×. The `Q3-2026 = 70.5%` row below is also void — that artefact only existed because of the same field; on `message_count`, 2026 Q3-to-date is 2.9%.

**Lesson for the next pass:** an adversarial re-derivation must question the *definition* of a field, not just recompute it. Any claim of the form "X never happened" needs a source that records X independently of our own collection.

## What changed

| Claim | Was | Now | Verdict |
|---|---|---|---|
| Detrended trio | Billing 1.56 / Network 1.41 / Outage 1.34 | **Billing 1.74 / Network 1.63 / Outage 1.58** (spec windows, corpus 0.807); Dashboard/Access 1.15 is a fourth riser | PARTIAL — ordering exact, magnitudes were understated |
| Outage "regime change" | 5–15/mo → 74–109/mo, "not a tagging change" | Tag series step is real but the tag **didn't exist before 2024** and moderators clearly adopted it Aug 2025; keyword-classified outage volume shows **no step, only ~1.3–1.5× elevation**. The dramatic 5× chart was a tag-adoption artefact | PARTIAL — cross-check failed, reframed |
| Q3-2026 no-reply 70.5% | "answer layer thinning fast" | **Pipeline artefact.** Reply backfill lags ~30 days (100% no-reply at <7d, cliff to 22% at 30–60d). Matched-window Q2 = 21.8% vs Q3's 70.8% — coverage is actually **improving** (37.9% 2025Q3 → 23.3% 2026Q2) | REFUTED interpretation (numbers reproduce) |
| Edge memory limit | 113 threads | **~30–34 threads** defensible. Worker-boot errors (~50) are the largest bucket; literal "5407" appears 0×; CPU 30 ✓, wall-clock 13–17 ✓, "10 seconds" 2 literal mentions, 0 substantive | REFUTED count |
| Auth classifier precision | ~60% (my 25-sample) | **~80%** (60-sample); Billing ~67%, Outage ~45–50% | REFUTED — Auth is *more* precise than I said |
| Auth decline | −86% from peak | **−71%** on consistent full-quarter windows (−86% mixed the partial current quarter in) | PARTIAL |

## Confirmed as-is

- Corpus 41,392 threads / 270,020 replies / 2022-08-11 → 2026-08-08 (live DB now 270,552 — corpus still growing). **Note: `data/replies.parquet` is capped at 200,000 most-recent replies** (`load_replies LIMIT 200000`) — fine for aggregates, not the full corpus.
- Corpus ratio 0.82 (−18%).
- ~~53% never answered (22,036/41,392 = 53.24%)~~ — **retracted, see the 2026-08-10 amendment above.** The arithmetic on `responder_count` is right; the field does not mean what it was read to mean.
- Per-feature no-reply table — all 9 rates reproduce to ±0.02pt *against `responder_count`*, and the **ranking holds** on the corrected basis, but the levels are superseded (TypeGen 26.5% worst → Billing 3.9% best). Small-n caveat on TypeGen (113) and MCP (90).
- garyaustin 27.03% of all replies, single identity, steady 24–28% for 8 quarters; top-12 = 40.95%; **no bots; none of the top 12 self-identify as Supabase staff — the top two explicitly state they are volunteer mods** ("This is a user helping user forum"). New nuance: concentration is volunteer labour, not staff coverage.
- Repeat askers: 17.8% of owners (3+ threads) produce 55.7% of threads, max 110 — **only after excluding the `unknown` owner placeholder** (24% of threads have no resolved owner).
- Triage (independent re-code of 30 threads): bug+outage 57% (vs 66%), reply-resolved 17% (vs 21%), **resolved-threads-are-misconfig confirmed (4/5; 5th was national ISP blocking)**. Within sampling noise of n=96; direction solid.
- Plans: detrended free 2.66 / pro 2.07, no-reply free 34.7% / pro 34.6% / enterprise 53.8%, neg pro 0.21 > free 0.12 — all hold. Headline "1,695 threads / 4.1%" double-counts multi-plan threads: unique ≈ 1,463–1,626 (**3.5–3.9%**).
- Edge: local deploy/CLI friction persists (~31/qtr through 2026Q1) ✓; Deno/esm.sh import pain collapsed (peak ~37/qtr 2023 → ~0–8/qtr 2026) ✓ direction; unanswered=code-vocab / answered=product-vocab ✓ (chi2, 10/10 and 9/10 terms).
- Auth outcomes average (29.2% resolved, rank 5/18). Its no-reply readings are superseded by the amendment: on `message_count`, Auth sits exactly at the forum average (11.6%), with SSR/server-session 11.9% (n=1,708) and OAuth-redirect 13.7% (n=846) — the narrowed Auth claim (SSR + OAuth are the gaps, not Auth broadly) survives on the corrected basis, by a smaller margin.

## Story-level corrections

1. **"Fewer answers" is wrong, full stop.** *(Strengthened 2026-08-10.)* Message *volume* fell (23.7k → 12.1k/quarter, tracking a −19.5% drop in threads), but coverage **improved** — 17.8% no-reply at the 2024 Q2 peak to 2.5% in 2026 Q2 — and messages per thread rose 6.8 → 8.8. Demand fell faster than answerer capacity. The supply risk is **concentration** (one volunteer, 27%; no staff in top 12), not decline.
2. **The outage "regime change" is a moderation-behaviour signal, not a platform-reliability signal.** The underlying outage-classified volume is only mildly elevated since Aug 2025.
3. **The feature classifier is noisy** (precision: Auth ~80%, Billing ~67%, Outage ~45–50%). Trends survive (noise roughly stationary), absolute per-feature levels should be quoted with less precision.

Method: 6 parallel checkers, structured verdicts, journal at `workflows/wf_9be1cbb7-a67/journal.jsonl`.
