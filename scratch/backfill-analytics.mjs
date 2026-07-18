import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync('./.env', 'utf8');
const supabaseUrl = envText.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim();
const supabaseKey = envText.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)[1].trim();
const supabaseSchema = envText.match(/^SUPABASE_SCHEMA=(.*)$/m)?.[1]?.trim() || 'discord';

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: supabaseSchema },
  auth: { persistSession: false },
});

function calculateAnalytics(issue, replies) {
  const otherReplies = replies.filter((r) => r.author_id !== issue.owner_id);
  const isAnswered = otherReplies.length > 0;

  let responseTimeMs = null;
  let responderCount = 0;
  let resolutionStatus = 'unanswered';

  if (isAnswered) {
    const threadTime = issue.first_message_created_at
      ? new Date(issue.first_message_created_at).getTime()
      : (issue.created_at ? new Date(issue.created_at).getTime() : null);

    const sortedReplies = [...otherReplies].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (threadTime && sortedReplies.length > 0) {
      responseTimeMs = new Date(sortedReplies[0].timestamp).getTime() - threadTime;
      if (responseTimeMs < 0) responseTimeMs = 0;
    }

    const responders = new Set(otherReplies.map((r) => r.author_id).filter(Boolean));
    responderCount = responders.size;

    const hasResolutionKeyword = replies.some((r) => {
      const text = (r.content ?? '').toLowerCase();
      return (
        text.includes('thank') ||
        text.includes('solved') ||
        text.includes('resolved') ||
        text.includes('fixed it') ||
        text.includes('worked') ||
        text.includes('works now') ||
        text.includes('perfect')
      );
    });

    resolutionStatus = hasResolutionKeyword ? 'likely-resolved' : 'in-progress';
  }

  return {
    is_answered: isAnswered,
    response_time_ms: responseTimeMs,
    responder_count: responderCount,
    resolution_status: resolutionStatus,
  };
}

async function main() {
  const isTest = process.argv.includes('--test');
  console.log(`Starting backfill analytics... ${isTest ? '[TEST MODE]' : ''}`);

  // Fetch count
  const { count, error: countErr } = await supabase
    .from('issues')
    .select('id', { count: 'exact', head: true });
  
  if (countErr) {
    console.error("Failed to fetch issues count:", countErr);
    return;
  }

  console.log(`Total issues to process: ${count}`);

  const PAGE_SIZE = 1000;
  const pages = Math.ceil(count / PAGE_SIZE);

  for (let page = 0; page < pages; page++) {
    const offset = page * PAGE_SIZE;
    console.log(`\nProcessing page ${page + 1}/${pages} (offset ${offset})…`);

    // Fetch batch of issues with all columns (to satisfy not-null constraints on upsert)
    const { data: issues, error: issuesErr } = await supabase
      .from('issues')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    
    if (issuesErr) {
      console.error(`Failed to fetch issues on page ${page}:`, issuesErr);
      break;
    }

    if (!issues || issues.length === 0) {
      console.log("No issues returned.");
      break;
    }

    const issueIds = issues.map(i => i.id);

    // Fetch replies in chunks of 100 to avoid URI headers overflow
    const SUB_BATCH_SIZE = 100;
    const replies = [];
    let repliesErrOccurred = false;

    for (let i = 0; i < issueIds.length; i += SUB_BATCH_SIZE) {
      const subBatch = issueIds.slice(i, i + SUB_BATCH_SIZE);
      const { data: subReplies, error: repliesErr } = await supabase
        .from('replies')
        .select('id, issue_id, author_id, timestamp, content')
        .in('issue_id', subBatch);
      
      if (repliesErr) {
        console.error(`Failed to fetch replies for sub-batch starting at index ${i} on page ${page}:`, repliesErr);
        repliesErrOccurred = true;
        break;
      }
      if (subReplies) {
        replies.push(...subReplies);
      }
    }

    if (repliesErrOccurred) {
      break;
    }

    // Group replies by issue_id
    const repliesMap = new Map();
    for (const r of replies || []) {
      if (!repliesMap.has(r.issue_id)) {
        repliesMap.set(r.issue_id, []);
      }
      repliesMap.get(r.issue_id).push(r);
    }

    const updates = issues.map((issue) => {
      const issueReplies = repliesMap.get(issue.id) || [];
      const analytics = calculateAnalytics(issue, issueReplies);
      return {
        ...issue,
        is_answered: analytics.is_answered,
        response_time_ms: analytics.response_time_ms,
        responder_count: analytics.responder_count,
        resolution_status: analytics.resolution_status,
      };
    });

    if (isTest) {
      console.log("Test updates output sample (first 2 items):");
      console.log(updates.slice(0, 2));
      
      const answered = updates.filter(u => u.is_answered);
      const likelyResolved = updates.filter(u => u.resolution_status === 'likely-resolved');
      console.log(`Page summary - Total: ${updates.length}, Answered: ${answered.length}, Likely Resolved: ${likelyResolved.length}`);
      
      console.log("Exiting test mode without writing changes.");
      break;
    }

    // Upsert updates back to supabase issues table
    const { error: upsertErr } = await supabase
      .from('issues')
      .upsert(updates, { onConflict: 'id' });
    
    if (upsertErr) {
      console.error(`Failed to upsert updates for page ${page}:`, upsertErr);
      break;
    }

    console.log(`Successfully backfilled analytics for ${updates.length} issues.`);
  }

  console.log("\nBackfill complete.");
}

main().catch(console.error);
