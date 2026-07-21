SET search_path TO discord, public;

-- Add indices to speed up queries
CREATE INDEX IF NOT EXISTS idx_issues_channel_id ON issues(channel_id);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_archived ON issues(archived);
CREATE INDEX IF NOT EXISTS idx_replies_issue_id ON replies(issue_id);
CREATE INDEX IF NOT EXISTS idx_issues_is_answered ON issues(is_answered);
CREATE INDEX IF NOT EXISTS idx_issues_resolution_status ON issues(resolution_status);

-- Create a global metrics view for fast server-side KPIs
CREATE OR REPLACE VIEW discord.dashboard_global_metrics AS
SELECT 
  channel_id,
  COUNT(id) AS total_issues,
  SUM(CASE WHEN is_answered = true THEN 1 ELSE 0 END) AS answered_issues,
  SUM(message_count) AS total_messages,
  SUM(CASE WHEN resolution_status = 'likely-resolved' THEN 1 ELSE 0 END) AS resolved_issues,
  AVG(response_time_ms) AS avg_response_time_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_time_ms) AS median_response_time_ms,
  SUM(CASE WHEN response_time_ms <= 3600000 THEN 1 ELSE 0 END) AS fast_response_count,
  COUNT(DISTINCT owner_id) AS unique_users,
  SUM(CASE WHEN archived = true THEN 1 ELSE 0 END) AS archived_issues
FROM discord.issues
GROUP BY channel_id;
