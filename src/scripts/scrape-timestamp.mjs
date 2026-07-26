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

const GUILD_ID = '839993398554656828';
const PAGE_SIZE = 50;
const DELAY_MS = 300;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normalizeIssue(thread, firstMessage) {
  const owner = thread.owner?.user;
  const attachments = firstMessage?.attachments ?? [];
  return {
    id: thread.id,
    name: thread.name,
    channel_id: channelId || thread.id,
    guild_id: GUILD_ID,
    owner_id: thread.owner_id,
    owner_username: owner?.username ?? 'unknown',
    owner_global_name: owner?.global_name ?? owner?.username ?? null,
    owner_avatar: owner?.avatar ?? null,
    created_at: thread.thread_metadata?.create_timestamp || new Date().toISOString(),
    archived_at: thread.thread_metadata?.archive_timestamp ?? null,
    archived: thread.thread_metadata?.archived ?? false,
    locked: thread.thread_metadata?.locked ?? false,
    message_count: thread.message_count ?? 0,
    member_count: thread.member_count ?? 0,
    total_message_sent: thread.total_message_sent ?? 0,
    applied_tags: thread.applied_tags ?? [],
    first_message_id: firstMessage?.id ?? null,
    first_message_content: firstMessage?.content ?? '',
    first_message_author_id: firstMessage?.author?.id ?? null,
    first_message_author_name: firstMessage?.author?.global_name ?? firstMessage?.author?.username ?? null,
    first_message_created_at: firstMessage?.timestamp ?? null,
  };
}

async function upsertIssues(issues) {
  if (issues.length === 0) return;
  const { error } = await supabase.from('issues').upsert(issues, { onConflict: 'id' });
  if (error) console.error("Supabase upsert error:", error.message);
  else console.log(`Upserted batch of ${issues.length} threads.`);
}

// Check if a starting timestamp was passed, otherwise default to current time
let beforeTimestamp = process.argv[2] || new Date().toISOString();
console.log(`=== Starting historical scrape. Paging back from archive timestamp: ${beforeTimestamp} ===`);

let totalFetched = 0;

while (true) {
  const url = `https://discord.com/api/v9/channels/${channelId}/threads/archived/public?limit=${PAGE_SIZE}&before=${encodeURIComponent(beforeTimestamp)}`;
  
  let res;
  let attempt = 0;
  for (; attempt < 10; attempt++) {
    res = await fetch(url, { headers: { authorization: authToken } });
    if (res.ok) break;
    
    if (res.status === 429) {
      const text = await res.text();
      const m = text.match(/retry_after[^0-9]*([\d.]+)/);
      const retryAfter = m ? parseFloat(m[1]) : 5;
      const sleepMs = Math.ceil(retryAfter * 1000) + 500;
      console.warn(`Rate limited. Sleeping ${sleepMs}ms...`);
      await sleep(sleepMs);
      continue;
    }
    
    console.error(`Non-429 error (status ${res.status}):`, await res.text());
    await sleep(2000);
  }
  
  if (!res || !res.ok) {
    console.error("Too many failed attempts. Exiting.");
    break;
  }
  
  const data = await res.json();
  const threads = data.threads || [];
  const firstMessages = data.first_messages || [];
  
  if (threads.length === 0) {
    console.log("No more threads found.");
    break;
  }
  
  const fmMap = new Map(firstMessages.map(m => [m.channel_id, m]));
  const issueRows = threads.map(t => normalizeIssue(t, fmMap.get(t.id)));
  
  await upsertIssues(issueRows);
  
  totalFetched += threads.length;
  const lastThread = threads[threads.length - 1];
  beforeTimestamp = lastThread.thread_metadata?.archive_timestamp;
  
  console.log(`Progress: Fetched ${totalFetched} threads. Next timestamp: ${beforeTimestamp}`);
  
  if (!data.has_more) {
    console.log("Discord reports no more threads.");
    break;
  }
  
  await sleep(DELAY_MS);
}

console.log(`=== Scraping complete. Fetched and synced ${totalFetched} threads. ===`);
