import { readFileSync, appendFileSync } from 'node:fs';

const envText = readFileSync('/Users/jvent/Dev/discord-dashboard/.env', 'utf8');
const authToken = envText.match(/^DISCORD_AUTH_TOKEN=(.*)$/m)[1].trim();
const channelId = envText.match(/^DISCORD_CHANNEL_ID=(.*)$/m)[1].trim();
const GUILD_ID = '839993398554656828';

const LOG = '/private/tmp/claude-501/-Users-jvent-Dev-discord-dashboard/1ea5e779-6db2-4895-b9d0-7213fe55bd84/scratchpad/scrape-resume.log';
const PAGE_SIZE = 25;
const BASE_DELAY_MS = 400; // this route's real bucket is much tighter than the 50 req/s global cap
const POSTDATA_DELAY_MS = 400;
const SYNC_BATCH = 200;
const START_OFFSET = 3575; // resume point — search results are sorted by last_message_time desc, so this is stable across runs

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normalizeIssue(thread, firstMessage) {
  const owner = thread.owner?.user;
  const attachments = firstMessage?.attachments ?? [];
  return {
    id: thread.id,
    name: thread.name,
    createdAt: thread.thread_metadata?.create_timestamp ?? '',
    archivedAt: thread.thread_metadata?.archive_timestamp ?? null,
    archived: thread.thread_metadata?.archived ?? false,
    locked: thread.thread_metadata?.locked ?? false,
    messageCount: thread.message_count ?? 0,
    memberCount: thread.member_count ?? 0,
    totalMessageSent: thread.total_message_sent ?? 0,
    appliedTags: thread.applied_tags ?? [],
    ownerId: thread.owner_id,
    ownerUsername: owner?.username ?? 'unknown',
    ownerGlobalName: owner?.global_name ?? owner?.username ?? null,
    ownerAvatar: owner?.avatar ?? null,
    firstMessageId: firstMessage?.id ?? null,
    firstMessageContent: firstMessage?.content ?? '',
    firstMessageAuthorId: firstMessage?.author?.id ?? null,
    firstMessageAuthorName: firstMessage?.author?.global_name ?? firstMessage?.author?.username ?? null,
    firstMessageCreatedAt: firstMessage?.timestamp ?? null,
    hasAttachment: attachments.length > 0,
    attachmentFilenames: attachments.map((a) => a.filename),
  };
}

// Extract a Discord retry_after (seconds) from our proxy's error text, if this
// failure was actually an upstream 429 that the proxy collapsed into a 502.
function extractRetryAfter(text) {
  // The proxy's error message is JSON-escaped (\"retry_after\": 1.2), so don't
  // require unescaped quotes around the key — just match the key then the number.
  const m = text.match(/retry_after[^0-9]*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

async function fetchWithBackoff(url, opts, label) {
  let consecutive429 = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok) return res;

    const text = await res.text();
    const retryAfter = extractRetryAfter(text);
    if (retryAfter != null) {
      consecutive429 += 1;
      const backoffMs = Math.ceil(retryAfter * 1000) + 300 * consecutive429;
      log(`rate-limited on ${label} (attempt ${attempt + 1}, retry_after=${retryAfter}s) -> sleeping ${backoffMs}ms`);
      await sleep(backoffMs);
      continue;
    }
    // real (non-rate-limit) failure — surface it to the caller
    log(`non-429 failure on ${label}: ${res.status} ${text.slice(0, 200)}`);
    return res;
  }
  throw new Error(`${label} still rate-limited after 15 attempts`);
}

async function syncBatch(issues) {
  if (issues.length === 0) return;
  const res = await fetch('http://localhost:3000/api/db/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ issues, channelId, guildId: GUILD_ID }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) log(`SYNC FAILED: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  else log(`synced batch of ${issues.length} issues (server reports issueCount=${data.issueCount})`);
}

log(`=== resuming scrape: channel ${channelId}, starting at offset ${START_OFFSET} ===`);

const allThreadsById = new Map();
const firstMessagesById = new Map();
let offset = START_OFFSET;
let totalResults = Infinity;
let fetchedCount = START_OFFSET;
let pendingIssues = [];
let hardFailures = 0;

while (offset < totalResults) {
  let res;
  try {
    res = await fetchWithBackoff(
      'http://localhost:3000/api/discord/search',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId, authToken, limit: PAGE_SIZE, offset }),
      },
      `search offset=${offset}`,
    );
  } catch (err) {
    log(`search hard-fail at offset ${offset}: ${err.message}`);
    hardFailures += 1;
    if (hardFailures >= 10) { log('too many hard failures, stopping'); break; }
    await sleep(2000);
    continue;
  }

  if (!res.ok) {
    hardFailures += 1;
    if (hardFailures >= 10) { log('too many hard failures, stopping'); break; }
    await sleep(1000);
    continue;
  }

  const page = await res.json();
  totalResults = page.total_results ?? totalResults;

  for (const fm of page.first_messages ?? []) {
    if (fm?.channel_id) firstMessagesById.set(fm.channel_id, fm);
  }
  for (const t of page.threads ?? []) {
    allThreadsById.set(t.id, t);
    pendingIssues.push(normalizeIssue(t, firstMessagesById.get(t.id)));
  }

  fetchedCount += page.threads?.length ?? 0;
  if (fetchedCount % 1000 < PAGE_SIZE) log(`progress: ${fetchedCount}/${totalResults} threads fetched`);

  if (pendingIssues.length >= SYNC_BATCH) {
    await syncBatch(pendingIssues);
    pendingIssues = [];
  }

  if (!page.has_more) break;
  offset += PAGE_SIZE;
  await sleep(BASE_DELAY_MS);
}

await syncBatch(pendingIssues);
pendingIssues = [];
log(`search phase complete: fetched up to ${fetchedCount}/${totalResults}`);

const missingIds = [...allThreadsById.keys()].filter((id) => !firstMessagesById.has(id));
log(`backfilling first_message content for ${missingIds.length} threads...`);

let backfillBatchIssues = [];
let backfilled = 0;
for (let i = 0; i < missingIds.length; i += 10) {
  const batch = missingIds.slice(i, i + 10);
  let res;
  try {
    res = await fetchWithBackoff(
      'http://localhost:3000/api/discord/post-data',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId, authToken, threadIds: batch }),
      },
      `post-data batch@${i}`,
    );
  } catch (err) {
    log(`post-data hard-fail at ${i}: ${err.message}`);
    continue;
  }
  if (res.ok) {
    const data = await res.json();
    for (const [tid, info] of Object.entries(data.threads ?? {})) {
      if (info?.first_message) {
        firstMessagesById.set(tid, info.first_message);
        backfillBatchIssues.push(normalizeIssue(allThreadsById.get(tid), info.first_message));
        backfilled += 1;
      }
    }
  }
  if (backfillBatchIssues.length >= SYNC_BATCH) {
    await syncBatch(backfillBatchIssues);
    backfillBatchIssues = [];
  }
  if (i % 500 < 10) log(`backfill progress: ${Math.min(i + 10, missingIds.length)}/${missingIds.length}`);
  await sleep(POSTDATA_DELAY_MS);
}
await syncBatch(backfillBatchIssues);

log(`=== resume run complete: fetched up to ${fetchedCount}/${totalResults}, ${backfilled} backfilled ===`);
