# Reply-Layer Triage — Rising-Feature Trio (Billing/Quotas, Outage/Status, Network/DNS)

Synthesized from 6 parallel triage passes over **96 high-friction threads** (2 batches × 16 threads per feature), each batch ranked by `[neg, struggle, created_at]` desc within the last 12 months of forum activity and capped at 6 replies × 500 chars / thread. Methodology and batch inputs in `/tmp/build_batches.py`; raw batch reports in the 6 dispatched-agent outputs. This is the reply-layer ground-truth that the text-mining surfacing in `findings.md` predicted: **these are incident threads, not doc-gap threads** — the dominant unmet need is operational recovery, and the forum replies resolve almost none of them.

## 1. Aggregate root-cause counts (96 threads)

Counts are per-thread primary category (a handful of threads carry a compounding secondary cause; multi-cause inflation is ≤1 per batch). Rounded totals:

| Category | Count | % of 96 | Notes |
|---|---:|---:|---|
| **bug** | 37 | 39% | Stuck state transitions, post-upgrade breakage, lifecycle ops silently killing connectivity/auth. |
| **outage** | 26 | 27% | Platform-side capacity incidents, region reachability, "project down, ticket open for days." |
| **user-misconfig** | 12 | 13% | Pooler-vs-direct, ISP/VPN reachability, IPv6-only resolvers. Most of these *self-resolve*. |
| **quota/limit** | 8 | 8% | Disk full (pg_wal), DB-size/row limits, connection-pool exhaustion. Users file these as "auth outage." |
| **billing-policy** | 6 | 6% | Silent bans, no overdue-grace docs, Pro upgrade not auto-applying included compute. |
| **doc-gap** | 6 | 6% | Prisma-direct-not-pooler, Windows IPv6, self-hosted Docker migration, SMTP-unreachable naming. |
| **other/unclear** | 2 | 2% | |
| **auth** | 0 | 0% | Never primary — but a **compounding factor** in ~8 threads (key-rotation honors legacy apikey, post-rotation PostgREST schema-cache 503, restart nukes session). |

**Read:** ~66% of these threads are bug + outage — *platform reliability and recovery*, not documentation. The doc-gap bucket (6%) is real but cheap; it is not where the leverage is.

## 2. Resolution rate

| Batch | Resolved | Rate |
|---|---:|---:|
| Billing/Quotas (part 1) | ~3 / 16 | 19% |
| Billing/Quotas (part 2) | 3 / 16 | 19% |
| Outage/Status (part 1) | 2 / 16 | 12.5% |
| Outage/Status (part 2) | 5 / 16 | 31% |
| Network/DNS (part 1) | 3 / 16 | 19% |
| Network/DNS (part 2) | 4 / 16 | 25% |
| **Total** | **~20 / 96** | **~21%** |

**How "resolved" is decided here:** each thread was judged by reading its replies — *not* by the forum's own resolved marker. That marker is an **optional self-assessment by the asker and is not enforced**: most threads that were in fact solved are never marked, so any resolution rate derived from the tag (or from the dashboard's keyword `resolution_status` heuristic) is a floor, not a measurement. The ~21% below is the read-the-replies number.

Crucially, the resolved threads are **almost entirely user-misconfig that self-resolves** (switched pooler→direct, disabled VPN/ISP-block workaround, fixed local env). **Virtually no `bug` or `outage` thread is resolved by forum replies** — the only "resolution" for those is *wait days for a support agent to manually unstick the project*. That the single highest-friction trio in the forum has a ~21% reply-resolution rate, skewed entirely to the misconfig subset, is itself the headline finding: **the forum is absorbing incident-management load that the product and support process are not.**

## 3. Cross-batch dominant patterns (converged across all 6 passes)

These themes recurred independently in ≥3 of 6 batches — high confidence.

### P1 — Stuck/broken platform-side state transitions, no self-service recovery
*The single highest-leverage fix class. Surfaced in all 6 batches.*
- `PAUSING` stuck for days; `resume` spins indefinitely; restore fails with **"No backups found"** during capacity incidents (free-tier paused projects, threads 874/739/3844/1952 — the same incident wearing different faces).
- Compute **upgrade stuck** ("optimizing database" never completes); **resize takes project offline for 24h**; **read-replica stuck FAILED**; **ghost projects** (deleted but still billed/blocking name); **NXDOMAIN** on project hostname.
- **PostgREST schema-cache 503** after key rotation; **Supavisor circuit-breaker** stuck.
- Every one of these has the same resolution path: *open a support ticket and wait*. There is no `force-restart`, `cancel`, `rollback`, or `retry` exposed to the user.
- **Fix:** hard timeouts on all lifecycle ops + user-facing **force-restart / cancel / rollback**; **post-operation health verification** (PostgREST peer-auth, not just DB) with auto-rollback; surface the capacity-incident root cause instead of "No backups found."

### P2 — Support SLA gap + status-page dishonesty
*Surfaced in 4/6 batches (all Outage + 1 Billing).*
- **Pro customers production-down**, waiting **hours-to-weeks** for a first response; status page reads **"All Systems Operational"** throughout.
- An **undocumented magic-keyword filter** is the de facto escalation: users report titling tickets "UPGRADE STUCK" / "Project stuck Pausing" to *catch the support filter*. The forum is teaching users the secret words.
- **Fix:** auto-escalation + published SLA for production-down on paid plans; honest **per-region / per-project** status (not a single green banner); a real stuck-project queue so "the secret title" is unnecessary.

### P3 — Control plane dies exactly when the project is degraded
*Surfaced in 3/6 batches (both Outage + Network/DNS part 2).*
- Restart fails, the **network-bans page won't load**, disk-modification is **rate-limited**, **"database set to 0"**, key-rotation UI **deadlocks** so the revoked secret can't be cleaned up. The dashboard becomes unusable at the moment it's needed most.
- **Fix:** control-plane operations must remain operable when the data plane is degraded — degraded-mode dashboard, never rate-limit the levers you need during an incident.

### P4 — `*.supabase.co` reachability from specific networks
*Surfaced in Network/DNS (both batches) + Outage part 2.*
- **Brazil/Claro `.co` ISP block** (≥3 threads), **Mullvad VPN** timeouts, **Vercel sin1 ENOTFOUND**, Russia reachability. Status-page misattributes these as project outages.
- **Fix:** publish a **"Can't reach \*.supabase.co" troubleshooting playbook** (ISP/VPN/region checks, custom-domain-via-Cloudflare workaround); stop attributing network-path failures to the project on the status page.

### P5 — Key-rotation security gap
*Surfaced in Network/DNS part 1.*
- Revoking the HS256 signing secret **does not invalidate the legacy `apikey` path for ~12h+**; the rotation UI deadlocks so cleanup can't complete. A revoked secret still authorizes — a security issue, not a reliability one.
- **Fix:** immediate — revoke must invalidate the legacy path synchronously; rotation must be completable without the dashboard (CLI escape hatch).

### P6 — Billing/ban lifecycle opacity
*Surfaced in Billing/Quotas (both batches).*
- **Silent bans** (no email, no reason, no self-serve card-update once banned); **no published overdue-invoice grace period**; **abuse@ has no SLA**; **Pro upgrade doesn't auto-apply the included micro compute** (two-step trap: upgrade, then manually resize); "upgrading to Pro retroactively unlocks 7 days of backups" is **undocumented**.
- **Fix:** automated ban email (reason + appeal link); published billing timelines; **auto-apply included micro compute on Pro upgrade**; document the retroactive-backup unlock.

### P7 — Resource exhaustion silently crosses limits, can't recover
*Surfaced in Billing/Quotas + Outage part 2.*
- Disk full (`pg_wal`), DB-size/row limit, connection-pool saturation. **No auto-expand, no early warning, no named alert** — users experience these as "auth outages" or "my project died."
- **Fix:** early-warning + auto-expand thresholds; a named "resource limit" alert distinct from "outage."

## 4. Prioritized fix list (by leverage × frequency)

| # | Fix | Pattern | Effort | Impact |
|---|---|---|---|---|
| 1 | Self-service **force-restart / cancel / rollback** for stuck lifecycle ops + hard timeouts + post-op health verification (PostgREST, not just DB) | P1 | M | **Huge** — directly resolves the top bucket across all 6 batches |
| 2 | **Support auto-escalation + published SLA** for prod-down paid plans; real stuck-project queue | P2 | M | Huge — kills the magic-keyword hack and the days-long wait |
| 3 | **Honest per-region/per-project status page** | P2 | S | High — stops "All Systems Operational" while DBs are dead |
| 4 | **Degraded-mode control plane** — dashboard + levers stay operable when project is sick | P3 | M | High |
| 5 | **Sync revoke of legacy `apikey` path on key rotation** + CLI-completable rotation | P5 | S | High (security) |
| 6 | **"Can't reach \*.supabase.co" playbook** + custom-domain workaround; stop network-path misattribution on status page | P4 | S | Med |
| 7 | **Billing/ban lifecycle**: ban emails + appeal, published grace period, auto-apply Pro micro compute | P6 | S–M | Med |
| 8 | **Resource exhaustion**: early-warning + auto-expand + named alerts | P7 | M | Med |
| 9 | **Doc-gap bundle** (cheap, high-frequency): Prisma-direct-vs-pooler, Windows IPv6-only resolver→session pooler, self-hosted Docker migration recovery, SMTP-unreachable named error, Storage 400 surfaces underlying Postgres error, pg_net DNS error clarity | doc-gap | S | Low–Med — the only cheap wins in this trio |

## 5. What this means for the dashboard / pipeline

- The text-mining surfacing (`findings.md` rising-feature drill-down) was **correct but mis-framed if read as doc gaps**: the trio is rising because of **incidents**, and the reply layer confirms ~66% bug+outage. Any dashboard "priority" view that lumps these with auth/how-to doc gaps will mislead.
- **Suggested dashboard signal:** expose the reply-resolution rate per feature (21% here) as a "support-burden vs self-serve" indicator. Features with high friction + low reply-resolution are incident sinks, not doc gaps. **Do not compute it from the forum's resolved marker** — that is optional and unenforced, so it measures who bothered to tick a box, not who got helped; derive it from the reply layer and label it as an estimate.
- The **`duplicate_cluster_id` Vectorize coverage (0.8%)** is too sparse to carry repetition signal — the NMF-topic concentration metric remains the right proxy (see `findings.md` Section 8).
- These 96 threads map cleanly onto **9 fix buckets** above; the highest-leverage 3 (#1 stuck-state recovery, #2 support SLA, #3 status honesty) would resolve the majority of the unresolved bug+outage threads.