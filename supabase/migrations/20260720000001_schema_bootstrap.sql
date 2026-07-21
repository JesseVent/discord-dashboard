-- ============================================================
-- DISCORD DASHBOARD SCHEMA BOOTSTRAP
-- Creates the `discord` schema and the core tables for the dashboard.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS discord;

-- Set search path so subsequent tables/views are in discord schema unless qualified
SET search_path TO discord, public;

CREATE TABLE IF NOT EXISTS discord.duplicate_clusters (
  id text PRIMARY KEY,
  name text not null,
  description text,
  issue_count integer not null default 0,
  created_at timestamp with time zone not null default now()
);

CREATE TABLE IF NOT EXISTS discord.issues (
  id text PRIMARY KEY,
  name text not null,
  channel_id text not null,
  guild_id text,
  owner_id text not null,
  owner_username text not null,
  owner_global_name text,
  owner_avatar text,
  created_at timestamp with time zone not null,
  archived_at timestamp with time zone,
  archived boolean not null default false,
  locked boolean not null default false,
  message_count integer not null default 0,
  member_count integer not null default 0,
  total_message_sent integer not null default 0,
  applied_tags text[] not null default '{}'::text[],
  first_message_id text,
  first_message_content text not null default '',
  first_message_author_id text,
  first_message_author_name text,
  first_message_created_at timestamp with time zone,
  response_time_ms bigint,
  responder_count integer not null default 0,
  is_answered boolean not null default false,
  resolution_status text not null default 'unknown',
  sentiment text,
  sentiment_score double precision,
  sentiment_summary text,
  duplicate_cluster_id text references discord.duplicate_clusters(id) on delete set null,
  fetched_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

CREATE TABLE IF NOT EXISTS discord.replies (
  id text PRIMARY KEY,
  issue_id text not null references discord.issues(id) on delete cascade,
  author_id text not null,
  author_username text not null,
  author_global_name text,
  content text not null default '',
  timestamp timestamp with time zone not null,
  has_attachment boolean not null default false,
  attachment_count integer not null default 0,
  sentiment text,
  sentiment_score double precision,
  created_at timestamp with time zone not null default now()
);

CREATE TABLE IF NOT EXISTS discord.theme_clusters (
  id text PRIMARY KEY,
  theme text not null,
  description text not null default '',
  keywords text[] not null default '{}'::text[],
  count integer not null default 0,
  sample_issue_ids text[] not null default '{}'::text[],
  method text not null default 'llm',
  channel_id text,
  created_at timestamp with time zone not null default now()
);
