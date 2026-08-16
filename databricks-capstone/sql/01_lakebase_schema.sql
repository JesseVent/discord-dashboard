-- ============================================================
-- 01_lakebase_schema.sql
-- Databricks AI Capstone — Lakebase schema for the Discord solution.
--
-- Ported from the authoritative hosted Supabase backup:
--   ../../supabase/backups/hosted-discord-schema-2026-07-25/schema.sql
-- (NOT the divergent supabase/migrations/* version which used text PKs / text[]).
--
-- This is the canonical shape: uuid PKs on cluster tables, jsonb for arrays,
-- bigint response_time_ms, the set_updated_at() trigger, and FK indexes.
--
-- Lakebase is Postgres, so this DDL runs as-is. Lakebase does not use Supabase's
-- service_role / RLS model — access is governed by the Lakebase's own role/user
-- grants instead. The RLS + service_role block from the original is therefore
-- omitted; restrict access at the Lakebase role level.
--
-- New vs the original:
--   • discord.notes — the agent's writable surface (moved server-side from the
--     Discord repo's per-browser local-SQLite notes feature).
--   • analytics views become Delta tables (notebook 02), so they are NOT created here.
-- ============================================================

create schema if not exists discord;

-- ============================================================
-- discord.duplicate_clusters — LLM/Vector-detected clusters of duplicate issues
-- ============================================================
create table if not exists discord.duplicate_clusters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  issue_count integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- discord.theme_clusters — LLM-generated theme clusters (persisted so
-- re-analysis is optional)
-- ============================================================
create table if not exists discord.theme_clusters (
  id               uuid primary key default gen_random_uuid(),
  theme            text not null,
  description      text not null default '',
  keywords         jsonb not null default '[]'::jsonb,
  count            integer not null default 0,
  sample_issue_ids jsonb not null default '[]'::jsonb,
  method           text not null default 'llm', -- llm | fallback
  channel_id       text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_theme_clusters_channel_id on discord.theme_clusters (channel_id);
create index if not exists idx_theme_clusters_method    on discord.theme_clusters (method);

-- ============================================================
-- discord.issues — a Discord forum thread treated as a support issue
-- ============================================================
create table if not exists discord.issues (
  id                        text primary key, -- Discord thread ID (snowflake)
  name                      text not null,
  channel_id                text not null,
  guild_id                  text,
  owner_id                  text not null,
  owner_username            text not null,
  owner_global_name         text,
  owner_avatar              text,

  created_at                timestamptz not null,        -- thread creation time
  archived_at               timestamptz,
  archived                  boolean not null default false,
  locked                    boolean not null default false,

  message_count             integer not null default 0,
  member_count              integer not null default 0,
  total_message_sent        integer not null default 0,

  applied_tags              jsonb not null default '[]'::jsonb, -- array of tag IDs

  first_message_id          text,
  first_message_content     text not null default '',
  first_message_author_id   text,
  first_message_author_name text,
  first_message_created_at  timestamptz,

  -- Response analytics (populated when replies are fetched)
  response_time_ms          bigint,
  responder_count           integer not null default 0,
  is_answered               boolean not null default false,
  resolution_status         text not null default 'unknown', -- unanswered | in-progress | likely-resolved | unknown

  -- Sentiment (populated by LLM sentiment analysis)
  sentiment                 text, -- frustrated | neutral | positive | resolved | unknown
  sentiment_score           double precision, -- -1.0 to 1.0
  sentiment_summary         text,

  -- Duplicate detection (populated by clustering)
  duplicate_cluster_id      uuid references discord.duplicate_clusters(id),

  fetched_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_issues_channel_id            on discord.issues (channel_id);
create index if not exists idx_issues_owner_id              on discord.issues (owner_id);
create index if not exists idx_issues_created_at            on discord.issues (created_at);
create index if not exists idx_issues_resolution_status     on discord.issues (resolution_status);
create index if not exists idx_issues_sentiment            on discord.issues (sentiment);
create index if not exists idx_issues_duplicate_cluster_id on discord.issues (duplicate_cluster_id);
create index if not exists idx_issues_archived             on discord.issues (archived);
create index if not exists idx_issues_is_answered          on discord.issues (is_answered);

-- keep updated_at current on every row update (mirrors Prisma's @updatedAt)
create or replace function discord.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_issues_updated_at on discord.issues;
create trigger trg_issues_updated_at
before update on discord.issues
for each row execute function discord.set_updated_at();

-- ============================================================
-- discord.replies — a single reply message within an issue thread
-- ============================================================
create table if not exists discord.replies (
  id                 text primary key, -- Discord message ID
  issue_id           text not null references discord.issues(id) on delete cascade,

  author_id          text not null,
  author_username    text not null,
  author_global_name text,
  content            text not null default '',
  "timestamp"        timestamptz not null,
  has_attachment     boolean not null default false,
  attachment_count   integer not null default 0,

  -- Sentiment of this specific reply
  sentiment          text,
  sentiment_score    double precision,

  created_at         timestamptz not null default now()
);

create index if not exists idx_replies_issue_id  on discord.replies (issue_id);
create index if not exists idx_replies_author_id on discord.replies (author_id);
create index if not exists idx_replies_timestamp on discord.replies ("timestamp");

-- ============================================================
-- discord.notes — NEW: the agent's writable surface.
--
-- The Discord repo kept notes in per-browser local SQLite (public.notes with an
-- open RLS policy). Here notes live server-side so the agent can write them and
-- every dashboard viewer sees them. `author` is the agent or the acting user.
-- ============================================================
create table if not exists discord.notes (
  id          uuid primary key default gen_random_uuid(),
  issue_id    text not null references discord.issues(id) on delete cascade,
  author      text not null,                 -- 'agent' | user name
  content     text not null default '',
  version     bigint not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_notes_issue_id on discord.notes (issue_id);
create index if not exists idx_notes_updated  on discord.notes (updated_at);

-- ============================================================
-- Useful read-only views that stay cheap on Postgres.
-- (The heavy analytics rollups — global_metrics, daily_stats, top_responders —
--  become Delta tables built by notebook 02, NOT views here.)
-- ============================================================

-- Lightweight issue projection: drops the large first_message_content for bulk loads.
create or replace view discord.issues_light as
select
  id, name, channel_id, guild_id,
  owner_id, owner_username, owner_global_name, owner_avatar,
  created_at, archived_at, archived, locked,
  message_count, member_count, total_message_sent,
  applied_tags,
  first_message_id, first_message_author_id, first_message_author_name, first_message_created_at,
  left(first_message_content, 250) as first_message_content,
  response_time_ms, responder_count, is_answered, resolution_status,
  sentiment, sentiment_score, sentiment_summary,
  duplicate_cluster_id, fetched_at, updated_at
from discord.issues;

-- Recent notes per issue, newest first (for the dashboard's notes panel).
create or replace view discord.issue_notes_recent as
select
  n.id, n.issue_id, n.author, n.content, n.version, n.created_at, n.updated_at,
  i.name as issue_name
from discord.notes n
join discord.issues i on n.issue_id = i.id
order by n.updated_at desc;

-- ---------------------------------------------------------------------------
-- discord.issues_changes — Change Data Feed rollup.
--
-- Written by notebooks/05_cdf_change_analytics.py from the Delta CDF of
-- workspace.discord.issues_enriched. The Delta table
-- workspace.discord.issues_changes is the row-level analytics artifact; this is
-- the small daily rollup mirrored into Lakebase so the Streamlit app (which
-- reads Postgres, not Delta) can chart it without a SQL-warehouse connector.
--
-- One row per (day, channel, operation). Re-runnable: notebook 05 upserts on the
-- primary key, so recomputing a window corrects it rather than duplicating it.
-- ---------------------------------------------------------------------------
create table if not exists discord.issues_changes (
  change_date    date    not null,
  channel_id     text    not null,
  operation      text    not null,          -- 'update' | 'insert'
  change_count   integer not null,
  status_changes integer not null default 0, -- subset where resolution_status moved
  primary key (change_date, channel_id, operation)
);

create index if not exists idx_issues_changes_date on discord.issues_changes (change_date);
