# Follow-up post — draft

> Updated after an independent fact-check pass (6 adversarial agents re-derived every number from the raw data), then again on 2026-08-10. Corrections incorporated: detrended ratios are 1.74/1.63/1.58 (stronger than first computed); the outage "regime change" is a tag-adoption signal, not a reliability cliff; the "70% unanswered this quarter" figure was a data-pipeline artefact and has been removed; Edge memory count corrected to ~30. **And the big one: "53% never get a reply" is retracted — it was 11.6%.**

## Main version

Follow-up to my Supabase community-forum analysis. After the last post I went one layer deeper — past the thread text into the replies. The story got sharper. (And then I had six independent fact-check agents re-derive every number — two claims didn't survive. Notes at the bottom.)

**Harder problems, concentrated answers.**

The demand side (from the first post): forum activity is down 18% in six months, yet Billing/Quotas, Network/DNS, and Outage/Status threads grew 58–74% adjusted for the decline. Two-thirds of the hardest threads are bugs or outages, not documentation gaps.

The supply side (new):

- **Almost every thread gets an answer — 11.6% get none, and only 2.5% last quarter.** Coverage has improved every year since 2024 as volume fell. The question is who provides it.
- **One community moderator has written 27% of all 270,020 replies** — steady every quarter for two years. The top 12 repliers hold ~41%, and **none identify as Supabase staff**. The two biggest answerers describe themselves as volunteer moderators. There is no staff floor underneath.
- **Answerability tracks how generalist the topic is.** TypeGen (27% unanswered), Self-Hosting (23%), AI/Vectors (22%), Integrations (19%) are the worst-served — the specialist corners where volunteers can't help, running 2–3× the 11.6% forum average. The incident areas are the most-answered (Billing 4%), but reply-level triage shows those answers rarely resolve anything.

Also since the last post:

- **Edge Functions deep dive:** the persisting pain is local deploy/CLI friction (~31 threads/quarter, steady) and limits you discover by crashing — worker-boot errors (~50), the 256MB memory ceiling (~30). There is no 10s limit — that's Vercel's Hobby tier. The Deno/esm.sh import pain has quietly collapsed.
- **Plan-talk is the fastest-rising vocabulary in the forum** — up ~2–2.7× adjusted: "free plan", "pro plan", "upgrade stuck". Pro-mentioning threads skew toward outages and carry noticeably more negative sentiment than free ones.
- **Honesty corner:** three claims didn't survive. A dramatic "outage regime change" chart turned out to be moderators adopting a tag, not a reliability shift. A scary "70% of threads unanswered this quarter" figure was lag in my own reply-backfill pipeline. And the headline I'd have most liked to keep — "53% of threads never get a reply" — was the same pipeline gap wearing a bigger hat: it came from my *own* reply table, which only covers 60% of the corpus, so 17,231 threads with replies I'd never fetched were counted as silence. Discord's own thread metadata puts it at 11.6%. Six adversarial fact-check agents confirmed the 53% because all six recomputed the same mislabelled column — recomputation isn't verification if nobody questions what the field means. All corrected in the report.

Full interactive report, method, the fact-check log, and the reproducible pipeline linked in comments.

## Short version (for a comment or quote-post)

Went back into the Supabase community forum data, this time the reply layer: almost everything gets answered (11.6% of 41k threads get no reply, 2.5% last quarter) — but one volunteer moderator has written 27% of all 270k answers, and none of the top 12 repliers are staff. The most-answered areas (billing, outages, network) are the ones replies can't fix — two-thirds are bugs or outages. The forum isn't a docs gap. It's incident-management load, carried by volunteers.

## Notes before posting

- `garyaustin` is named in the report — the stat is flattering (and the fact-check confirmed he is a volunteer mod, not staff), but if the post takes off, "one volunteer moderator" in the post text itself keeps the focus on the structural point.
- The fact-check log (`findings/fact-check.md`) is bundled with the report — the "honesty corner" paragraph is a credibility asset with a technical audience, keep it if you're comfortable.
- The report is a local file (`analysis/report/report.html`, self-contained with `assets/`). To link it publicly it needs hosting — easiest is the existing Vercel deployment, or I can inline the fonts into a single shareable HTML file.
