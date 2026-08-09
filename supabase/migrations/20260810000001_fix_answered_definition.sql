-- The "answered" KPI counted issues.is_answered, which our reply backfill sets.
-- The backfill has only ever reached ~60% of the corpus, so 16,860 threads that
-- demonstrably have replies (Discord's own message_count > 0) were reported as
-- unanswered — a 53% "never answered" rate against a true ~12%.
--
-- message_count is thread metadata from Discord and excludes the opening post,
-- so message_count > 0 means somebody replied. It equals our fetched reply count
-- on 98.5% of the threads where both exist.

drop view if exists discord.dashboard_global_metrics;

create view discord.dashboard_global_metrics as
select
  channel_id,
  count(id) as total_issues,
  count(*) filter (where message_count > 0) as answered_issues,
  sum(message_count) as total_messages,
  count(*) filter (where resolution_status = 'likely-resolved') as resolved_issues,
  avg(response_time_ms) as avg_response_time_ms,
  count(distinct owner_id) as unique_users,
  count(*) filter (where archived = true) as archived_issues,
  percentile_cont(0.5) within group (order by response_time_ms::double precision)
    as median_response_time_ms,
  count(*) filter (where response_time_ms <= 3600000) as fast_response_count
from discord.issues
group by channel_id;

-- dropping the view drops its grants with it; /api/dashboard/metrics reads as
-- service_role and 500s without this.
grant select on discord.dashboard_global_metrics to service_role;

comment on view discord.dashboard_global_metrics is
  'Single-row KPI rollup. answered_issues uses Discord''s message_count, not is_answered: '
  'is_answered depends on the reply backfill and reads un-fetched threads as unanswered.';
