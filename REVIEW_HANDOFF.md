# Review Handoff — multi-channel dashboard + channel-aware analytics

**Branch:** `backup/hosted-discord-schema` (all changes uncommitted)
**Scope:** combine two Discord forum channels into one dashboard with a Channel filter, then make per-channel analytics (themes, duplicate clusters, tags) reflect the selected channel instead of the Supabase-dominated global state.

## What changed and why

### 1. Critical: metrics route no longer crashes with >1 channel
`src/app/api/dashboard/metrics/route.ts` (+231/-?) — previously called `.single()` on `dashboard_global_metrics`, which **throws once a second channel exists** (one row per channel via `GROUP BY channel_id`). Rewritten to fetch the views as arrays and aggregate server-side into:

```
{ kpis (combined), byChannel{[id]:kpis}, dailyStats, dailyStatsByChannel,
  topResponders, topRespondersByChannel, channels:[{id,label,issueCount}] }
```

Per-channel KPIs/charts are served from the full dataset via the views; the client’s ~1000-issue load drives only the issues table (localStorage ~5MB constraint, unchanged).

**Review checkpoint:** the aggregations are plain JS reduces over view rows (views already group by channel). Verify the combined `kpis` sums correctly and `channels[]` uses `issueCount` (NOT `count` — a shape mismatch here caused a hydration throw earlier; `page.tsx` maps `issueCount→count` for the dropdown).

### 2. Multi-channel load + types
- `src/lib/discord-types.ts` — `Issue.channelId?: string`; `CHANNEL_LABELS` map + `channelLabel()` for the two known channels.
- `src/app/api/db/load/route.ts` — maps `channel_id→channelId`; when `channelId` is empty/`'all'`, skips the `.eq('channel_id',…)` filter (loads across all channels); added `channel_id` to the fallback explicit-column select.
- `src/lib/data-loader.ts` — `initSampleDataIfEmpty` now loads **all channels** (passes `''`) instead of only the configured fetch channel. Decouples *load* (all channels) from *fetch* (configured channel).
- `src/store/dashboard-store.ts` — persisted `channelFilter: 'all' | string` + `setChannelFilter` (persisted so the choice survives reloads, unlike the row filters which are local state).

**Review checkpoint:** load limit stays at ~1000 newest across both channels. Only ~56–71 DataExpert issues load client-side (Supabase’s recent slice dominates the newest 1000). KPIs/charts are correct for DataExpert (server route, full 631); only client-computed panels (themes/sentiment/duplicates) are limited to the loaded slice. This is consistent with the existing architecture — flag if you want themes over all 631 client-side (would need a higher/per-channel load).

### 3. Channel-aware themes + duplicate clusters (THIS SESSION)
`src/app/page.tsx` and `src/lib/fallback-themes.ts`.

**Problem:** `ThemesPanel` received `themes={themes}` (global store, computed once on boot over all loaded issues → Supabase-dominated). `DuplicateClusters` received global `clusters`. Filtering to DataExpert still showed Supabase themes.

**Root cause (deeper than it looked):** even after recomputing themes per channel, the fallback `RULES` were a hardcoded **Supabase** set (“Edge Functions”, “Vectors / AI”, “RLS / Permissions”). Loose keywords (`functions`, `sql`, `auth`) bucketed DataExpert data-engineering questions into Supabase-named themes — so it *looked* like “still supabase.”

**Fix:**
- `fallback-themes.ts`: `fallbackThemes(issues, channelId?)` selects a channel-specific rule set via `CHANNEL_RULES`. DataExpert id `1378263233437106207` → `DATAEXPERT_RULES` (Databricks Platform, Spark/PySpark, Delta Lake/Lakehouse, Unity Catalog, Orchestration/Airflow, dbt, Streaming/Kafka, Data Ingestion/ETL, SQL/Queries, Python/Pandas, Performance/Cost, Auth/Access, Cloud/Infra, ML, Certification/Learning). Unknown / Supabase / `all` → `SUPABASE_RULES` (renamed from the old `RULES`; `FALLBACK_THEME_RULES` re-export preserved).
- `page.tsx`: `channelThemes = channelFilter==='all' ? themes : fallbackThemes(channelIssues, channelFilter)`. `channelClusters` trims each cluster’s `issueIds` to channel members and drops empties. `effectiveFilters.themes` repointed to `channelThemes` so the theme-filter chip resolves against the same set the user picks from.

**`all` keeps store themes** (potential LLM quality, no regression). Specific channels recompute deterministically (the LLM `/api/analyze-themes` route 404s in dev, so store themes are already fallback-quality).

**Review checkpoint:** DataExpert theme names are keyword-derived and rule-ordered (specific-before-general — e.g. Databricks/Spark/dbt win over the generic `SQL / Queries` catch-all). Keyword lists are deliberately inclusive; expect some mis-bucketing on ambiguous posts. `channelThemes` recomputes on every `channelIssues` change via `useMemo` — O(issues × rules), trivial for ~1000 issues.

### 4. DataExpert forum tag names (THIS SESSION)
`src/lib/dashboard-utils.ts` (+22).

**Problem:** tag chips showed raw IDs (“Tag 8536”) because `KNOWN_TAG_NAMES` only mapped the Supabase forum’s tag IDs. `tagName()` fell back to `Tag ${id.slice(-4)}`.

**Fix:** fetched the DataExpert forum’s `available_tags` via `GET /channels/:id` (one-shot `/tmp/fetch_tags.mjs`; token stayed in env, never printed) and added all 20 DataExpert tag IDs → display names (Bootcamp, Project Help, Error Debugging, Python, SQL, Tools Help, Assignments, Bugs, Suggestion, Career Advice, Data Modeling, Machine Learning, Spark Fundamentals, Beginners / Upskilling, Data Quality / Airflow, Kafka / Flink Fundamentals, Analytical Patterns, KPIs & Experiments, Interview Prep, Misc). All tag renderers route through the single `tagName()`, so filter chips, tag-distribution chart, issues table, sentiment/duplicate/escalation panels, and CSV export all resolve centrally. Colors stay on the deterministic hash fallback (20 distinct colors > forcing 20 tags into 6 palette categories).

**Review checkpoint:** the Supabase tag entries are unchanged (only added DataExpert entries). `TAG_CATEGORY_MAP` intentionally has no DataExpert entries — verify the hash-fallback colors are acceptable, or assign categories if you want the curated palette.

## Verification performed
- `bun run lint` — only pre-existing errors in `src/lib/use-chart-tick-color.ts` (untouched `react-hooks/set-state-in-effect`); all changed files clean.
- Browser (Chrome DevTools MCP, real Chrome):
  - `/api/dashboard/metrics` returns both channels (Supabase 40,748; DataExpert 631) and no longer throws.
  - DataExpert selected → KPIs 631/434 users/4,825 msgs; themes = Databricks Platform 22%, SQL/Queries, Certification/Learning, Delta Lake/Lakehouse, dbt/Modeling, Orchestration, Data Ingestion, Auth. Tag row = “Bootcamp 27, Project Help 9, Error Debugging 9, Python 8, …” with zero residual “Tag XXXX”.
  - All channels → unchanged Supabase store themes (Auth/JWT 225, Outage 154, Database 136); KPIs combined.
- DataExpert ingestion: 631 issues persisted to `discord.issues` with `channel_id=1378263233437106207` (one-shot script mirroring `fetchFromDiscord`+`persistToDb`, env-token fallback, token never read).

## Intentionally skipped (add when needed)
- **LLM-per-channel theme route.** Deterministic fallback matches current dev quality (LLM route 404s in dev). Add if richer/prose theme names are wanted in prod.
- **Dynamic `available_tags` fetch at ingest.** Two channels are hardcoded by the same pattern as the existing Supabase tag map. Switch to a fetch-and-store flow when a third channel is added.
- **Loading all 631 DataExpert issues client-side.** The 1000-issue newest-across-both-channels cap leaves ~56–71 DataExpert issues in memory. Themes/sentiment/duplicates are computed over that slice (KPIs/charts use the full server dataset). Raise/per-channel the client load if themes-over-all-631 is required.
- Generic channel-name fetch endpoint (hardcoded 2-channel label map suffices for the capstone).

## Files touched (review order)
1. `src/app/api/dashboard/metrics/route.ts` — critical multi-channel aggregation
2. `src/lib/fallback-themes.ts` — channel-specific theme rule sets
3. `src/app/page.tsx` — channel-aware themes/clusters memos, theme-filter resolver, header dropdown
4. `src/lib/dashboard-utils.ts` — DataExpert tag names
5. `src/app/api/db/load/route.ts` — multi-channel load
6. `src/lib/data-loader.ts` — load all channels on boot
7. `src/lib/discord-types.ts` — `channelId`, `CHANNEL_LABELS`
8. `src/store/dashboard-store.ts` — persisted `channelFilter`

## Notes
- `next-auth` is a dependency but still not wired up anywhere in `src/`.
- `.gitignore`, `databricks-capstone/`, screenshot PNGs, and tooling dirs (`.playwright-mcp/`, `.vscode/`, `.zcode/`) are untracked and out of scope for this review.
- No DB migrations, no new dependencies, no new files under `src/`.