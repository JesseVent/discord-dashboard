import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Load env variables
const envText = readFileSync('./.env', 'utf8');
const authToken = envText.match(/^DISCORD_AUTH_TOKEN=(.*)$/m)[1].trim();
const channelId = envText.match(/^DISCORD_CHANNEL_ID=(.*)$/m)[1].trim();
const supabaseUrl = envText.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim();
const supabaseKey = envText.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)[1].trim();
const supabaseSchema = envText.match(/^SUPABASE_SCHEMA=(.*)$/m)?.[1]?.trim() || 'discord';

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: supabaseSchema },
  auth: { persistSession: false },
});

const DELAY_MS = 250; // sleep between thread message requests
const BATCH_SIZE = 100; // process 100 threads at a time

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchThreadMessages(threadId) {
  const url = `https://discord.com/api/v9/channels/${threadId}/messages?limit=100`;
  
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(url, { headers: { authorization: authToken } });
    if (res.ok) {
      const messages = await res.json();
      return messages.reverse(); // Discord returns newest first, we want oldest first
    }
    
    if (res.status === 403 || res.status === 404) {
      // Inaccessible thread
      return null;
    }
    
    if (res.status === 429) {
      const text = await res.text();
      const m = text.match(/retry_after[^0-9]*([\d.]+)/);
      const retryAfter = m ? parseFloat(m[1]) : 5;
      const sleepMs = Math.ceil(retryAfter * 1000) + 500;
      console.warn(`[Thread ${threadId}] Rate limited. Sleeping ${sleepMs}ms...`);
      await sleep(sleepMs);
      continue;
    }
    
    console.error(`Error fetching messages for ${threadId}: ${res.status}`);
    await sleep(2000);
  }
  return null;
}

// 1. Get all issues from Supabase with message_count > 1, oldest fetched/updated first
console.log("Fetching issues list from Supabase...");
const { data: dbIssues, error } = await supabase
  .from('issues')
  .select('id, name, owner_id, first_message_id, first_message_created_at, message_count, replies(id)')
  .gt('message_count', 1)
  .order('fetched_at', { ascending: true });

if (error) {
  console.error("Failed to query issues:", error.message);
  process.exit(1);
}

// Filter issues that don't have replies stored in Supabase
const missing = dbIssues.filter((i) => !i.replies || i.replies.length === 0);
console.log(`Found ${dbIssues.length} issues with replies on Discord in this batch. ${missing.length} are missing replies in Supabase.`);

// Update fetched_at for all issues in this batch that ALREADY have replies stored
const alreadySynced = dbIssues.filter((i) => i.replies && i.replies.length > 0);
if (alreadySynced.length > 0) {
  const alreadySyncedIds = alreadySynced.map((i) => i.id);
  console.log(`Updating fetched_at for ${alreadySyncedIds.length} already-synced issues to rotate queue...`);
  const { error: rotErr } = await supabase
    .from('issues')
    .update({ fetched_at: new Date().toISOString() })
    .in('id', alreadySyncedIds);
  if (rotErr) console.error("Queue rotation failed:", rotErr.message);
}

if (missing.length === 0) {
  console.log("All replies in this batch are already synced! Rotated queue. Exiting.");
  process.exit(0);
}

// Let the user specify a limit via CLI argument (default to 200)
const syncLimit = Number(process.argv[2] || 200);
const toProcess = missing.slice(0, syncLimit);
console.log(`Processing the first ${toProcess.length} threads in this run...`);

let processed = 0;
for (const issue of toProcess) {
  console.log(`[${processed + 1}/${toProcess.length}] Fetching replies for thread: "${issue.name}" (${issue.id})`);
  
  const messages = await fetchThreadMessages(issue.id);
  if (messages) {
    const replies = messages.filter((m) => m.id !== issue.first_message_id);
    
    // Save replies
    const replyRows = replies.map((r) => ({
      id: r.id,
      issue_id: issue.id,
      author_id: r.author?.id ?? 'unknown',
      author_username: r.author?.username ?? 'unknown',
      author_global_name: r.author?.global_name ?? null,
      content: r.content ?? '',
      timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
      has_attachment: (r.attachments?.length ?? 0) > 0,
      attachment_count: r.attachments?.length ?? 0,
    }));
    
    if (replyRows.length > 0) {
      const { error: insErr } = await supabase.from('replies').upsert(replyRows, { onConflict: 'id' });
      if (insErr) {
        console.error(`Failed to upsert replies for ${issue.id}:`, insErr.message);
      }
    }
  }
  
  // Update fetched_at so it moves to the back of the queue
  await supabase
    .from('issues')
    .update({ fetched_at: new Date().toISOString() })
    .eq('id', issue.id);
  
  processed++;
  await sleep(DELAY_MS);
}

console.log(`\n=== Synced replies for ${processed} issues. ===`);
