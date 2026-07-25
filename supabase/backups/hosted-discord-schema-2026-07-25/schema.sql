-- ─── create_discord_schema ───
create schema if not exists discord;

-- ============================================================
-- discord.duplicate_clusters — LLM-detected clusters of duplicate issues
-- ============================================================
create table discord.duplicate_clusters (
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
create table discord.theme_clusters (
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

create index idx_theme_clusters_channel_id on discord.theme_clusters (channel_id);
create index idx_theme_clusters_method on discord.theme_clusters (method);

-- ============================================================
-- discord.issues — a Discord forum thread treated as a support issue
-- ============================================================
create table discord.issues (
  id                        text primary key, -- Discord thread ID (snowflake)
  name                      text not null,
  channel_id                text not null,
  guild_id                  text,
  owner_id                  text not null,
  owner_username            text not null,
  owner_global_name         text,
  owner_avatar              text,

  created_at                timestamptz not null, -- thread creation time
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

  -- Duplicate detection (populated by LLM duplicate clustering)
  duplicate_cluster_id      uuid references discord.duplicate_clusters(id),

  fetched_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_issues_channel_id on discord.issues (channel_id);
create index idx_issues_owner_id on discord.issues (owner_id);
create index idx_issues_created_at on discord.issues (created_at);
create index idx_issues_resolution_status on discord.issues (resolution_status);
create index idx_issues_sentiment on discord.issues (sentiment);
create index idx_issues_duplicate_cluster_id on discord.issues (duplicate_cluster_id);

-- keep updated_at current on every row update (mirrors Prisma's @updatedAt)
create or replace function discord.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_issues_updated_at
before update on discord.issues
for each row execute function discord.set_updated_at();

-- ============================================================
-- discord.replies — a single reply message within an issue thread
-- ============================================================
create table discord.replies (
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

create index idx_replies_issue_id on discord.replies (issue_id);
create index idx_replies_author_id on discord.replies (author_id);
create index idx_replies_timestamp on discord.replies ("timestamp");

-- ============================================================
-- Lock down to service_role only. The app talks to Supabase server-side
-- with the service role key (bypasses RLS); anon/authenticated get nothing.
-- ============================================================
alter table discord.duplicate_clusters enable row level security;
alter table discord.theme_clusters enable row level security;
alter table discord.issues enable row level security;
alter table discord.replies enable row level security;

grant usage on schema discord to service_role;
grant all on all tables in schema discord to service_role;
grant all on all sequences in schema discord to service_role;
