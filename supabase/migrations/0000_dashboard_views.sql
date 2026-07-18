-- ============================================================
-- DISCORD DASHBOARD OPTIMIZATION VIEWS
-- Run this in your Supabase SQL Editor to create the views.
-- ============================================================

-- 1. Lightweight Issues View
-- Excludes the massive first_message_content to drastically reduce payload sizes
-- for the dashboard's bulk load query, while keeping enough text for basic keyword matching.
CREATE OR REPLACE VIEW discord.dashboard_issues_light AS
SELECT 
  id,
  name,
  channel_id,
  guild_id,
  owner_id,
  owner_username,
  owner_global_name,
  owner_avatar,
  created_at,
  archived_at,
  archived,
  locked,
  message_count,
  member_count,
  total_message_sent,
  applied_tags,
  first_message_id,
  first_message_author_id,
  first_message_author_name,
  first_message_created_at,
  -- Truncate content for lightweight searching without transferring megabytes of data
  LEFT(first_message_content, 250) AS first_message_content,
  response_time_ms,
  responder_count,
  is_answered,
  resolution_status,
  sentiment,
  sentiment_score,
  sentiment_summary,
  duplicate_cluster_id,
  fetched_at,
  updated_at
FROM discord.issues;

-- 2. Daily Time-Series View
-- Pre-aggregates issue counts by day for the "Issues Over Time" chart
CREATE OR REPLACE VIEW discord.dashboard_daily_stats AS
SELECT 
  DATE_TRUNC('day', created_at)::DATE AS date,
  channel_id,
  COUNT(*) AS issue_count,
  SUM(message_count) AS total_messages,
  SUM(CASE WHEN is_answered = true THEN 1 ELSE 0 END) AS answered_count
FROM discord.issues
GROUP BY 1, 2
ORDER BY 1 DESC;

-- 3. Top Responders Aggregate View
-- Pre-aggregates top community responders to avoid pulling all replies to the client
CREATE OR REPLACE VIEW discord.top_responders_view AS
SELECT 
  i.channel_id,
  r.author_id,
  r.author_username,
  r.author_global_name,
  COUNT(r.id) AS reply_count,
  COUNT(DISTINCT r.issue_id) AS issues_helped
FROM discord.replies r
JOIN discord.issues i ON r.issue_id = i.id
WHERE r.author_id != i.owner_id -- exclude OP
GROUP BY 1, 2, 3, 4
ORDER BY reply_count DESC;

-- Add indices to speed up queries
CREATE INDEX IF NOT EXISTS idx_issues_channel_id ON discord.issues(channel_id);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON discord.issues(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_archived ON discord.issues(archived);
CREATE INDEX IF NOT EXISTS idx_replies_issue_id ON discord.replies(issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_is_answered ON discord.issues(is_answered);
CREATE INDEX IF NOT EXISTS idx_issues_resolution_status ON discord.issues(resolution_status);

-- Create a global metrics view for fast server-side KPIs
CREATE OR REPLACE VIEW discord.dashboard_global_metrics AS
SELECT 
  channel_id,
  COUNT(id) AS total_issues,
  SUM(CASE WHEN is_answered = true THEN 1 ELSE 0 END) AS answered_issues,
  SUM(message_count) AS total_messages,
  SUM(CASE WHEN resolution_status = 'likely-resolved' THEN 1 ELSE 0 END) AS resolved_issues,
  AVG(response_time_ms) AS avg_response_time_ms,
  COUNT(DISTINCT owner_id) AS unique_users,
  SUM(CASE WHEN archived = true THEN 1 ELSE 0 END) AS archived_issues
FROM discord.issues
GROUP BY channel_id;
