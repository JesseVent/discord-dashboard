// One-shot ingest of all threads (active + archived) for a Discord channel
// into discord.issues + discord.replies via PostgREST.
//
//   node scripts/ingest-channel.mjs <channelId>
//
// Works for both forum and text channels. For text-channel threads the
// "first message" (the question the thread was started from) lives in the
// type-21 THREAD_STARTER_MESSAGE stub's `referenced_message`, not in the
// thread itself — so this script fetches each thread's messages and derives:
//   first_message = stub.referenced_message  (or oldest message, or thread name)
//   replies       = the real (non-system) messages in the thread
// Response analytics (first-reply latency, responder count, is_answered,
// resolution status) are computed to match computeResponseAnalytics().
//
// Reads DISCORD_AUTH_TOKEN + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// from .env. Token is never printed.
import { readFile } from "node:fs/promises";

const DISCORD_API = "https://discord.com/api/v9";
const PAGE_SIZE = 25;
const MAX_THREADS = 100000;
const MSG_CONCURRENCY = 6;
const MSG_LIMIT = 100;

const envText = await readFile(".env", "utf8").catch(() => "");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TOKEN = process.env.DISCORD_AUTH_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCHEMA = process.env.SUPABASE_SCHEMA || "discord";
const CHANNEL_ID = process.argv[2];
if (!CHANNEL_ID) throw new Error("usage: node scripts/ingest-channel.mjs <channelId>");
if (!TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("DISCORD_AUTH_TOKEN / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
}

const authHeaders = { authorization: TOKEN, accept: "*/*", "content-type": "application/json" };

// Resolve the channel's guild_id (the codebase hardcodes the Supabase guild, but
// these channels live in the DataExpert guild — derive it per channel instead).
const chInfo = await (await fetch(`${DISCORD_API}/channels/${CHANNEL_ID}`, { headers: authHeaders })).json();
if (!chInfo || !chInfo.guild_id) throw new Error(`could not resolve channel ${CHANNEL_ID} (status: ${chInfo?.message ?? "unknown"})`);
const GUILD_ID = chInfo.guild_id;
console.log(`channel ${CHANNEL_ID} ("${chInfo.name}", type ${chInfo.type}) → guild ${GUILD_ID}`);

async function rate(fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fn();
    if (res.ok) return res.json();
    if (res.status === 429) {
      const t = await res.text().catch(() => "");
      const m = t.match(/retry_after[^0-9]*([\d.]+)/);
      await new Promise((r) => setTimeout(r, (m ? parseFloat(m[1]) : 2) * 1000 + 100));
      continue;
    }
    if (res.status === 403 || res.status === 404) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

const get = (url) => rate(() => fetch(url, { headers: authHeaders, cache: "no-store" }));

async function searchPage(archived, offset) {
  const url = new URL(`${DISCORD_API}/channels/${CHANNEL_ID}/threads/search`);
  url.searchParams.set("archived", String(archived));
  url.searchParams.set("sort_by", "last_message_time");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("tag_setting", "match_some");
  return get(url);
}

// --- paginate threads (active first, then archived) ---
// Capture search `first_messages` (forum channels provide the true original
// post here). Text channels return no first_messages; for those we derive the
// first message from the type-21 stub's referenced_message via the messages endpoint.
const seen = new Set();
const threads = [];
const searchFirstMessages = new Map();
let activeTotal = 0, archivedTotal = 0;
function absorb(page) {
  for (const t of page.threads ?? []) if (!seen.has(t.id)) { seen.add(t.id); threads.push(t); }
  for (const fm of page.first_messages ?? []) if (fm?.channel_id) searchFirstMessages.set(fm.channel_id, fm);
}
for (let offset = 0; threads.length < MAX_THREADS; offset += PAGE_SIZE) {
  const page = await searchPage(false, offset);
  if (!page) break;
  activeTotal = page.total_results ?? activeTotal;
  absorb(page);
  if (!(page.has_more ?? false)) break;
  console.log(`active: ${threads.length} (total ${activeTotal})`);
}
for (let offset = 0; threads.length < MAX_THREADS; offset += PAGE_SIZE) {
  const page = await searchPage(true, offset);
  if (!page) break;
  archivedTotal = page.total_results ?? archivedTotal;
  absorb(page);
  if (!(page.has_more ?? false)) break;
  console.log(`+archived: ${threads.length} (archived total ${archivedTotal})`);
}
console.log(`found ${threads.length} threads (active ${activeTotal}, archived ${archivedTotal}); ${searchFirstMessages.size} have search first_messages`);

// --- fetch messages per thread (newest-first → reverse to oldest-first) ---
async function fetchMessages(threadId) {
  const msgs = [];
  let before;
  while (msgs.length < MSG_LIMIT) {
    const url = new URL(`${DISCORD_API}/channels/${threadId}/messages`);
    url.searchParams.set("limit", String(Math.min(100, MSG_LIMIT - msgs.length)));
    if (before) url.searchParams.set("before", before);
    const batch = await get(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    msgs.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  return msgs.reverse(); // oldest-first
}

const queue = [...threads];
const issues = [];
const replyRows = [];
let done = 0;

async function worker() {
  while (queue.length) {
    const t = queue.shift();
    if (!t) break;
    try {
      // 1) first_message: prefer search first_messages (forum); else derive from messages (text channel)
      let fm = searchFirstMessages.get(t.id);
      let msgs = null;
      if (!fm) {
        // text-channel: the original post lives in the type-21 stub's referenced_message
        msgs = await fetchMessages(t.id);
        const stub = msgs.find((m) => m.type === 21 && m.referenced_message);
        fm = stub ? stub.referenced_message : (msgs.length > 0 ? msgs[0] : null);
      }
      const fmContent = fm?.content ?? t.name;
      const fmAuthor = fm?.author;
      const fmId = fm?.id ?? null;

      // 2) replies: fetch messages if the thread has >1 message (skip otherwise)
      let replyMsgs = [];
      if ((t.message_count ?? 0) > 1) {
        if (!msgs) msgs = await fetchMessages(t.id);
        const stub = msgs.find((m) => m.type === 21 && m.referenced_message);
        replyMsgs = msgs.filter((m) => m !== stub && m.id !== fmId);
      }
      const ownerId = t.owner_id ?? fmAuthor?.id ?? null;

      // 3) computeResponseAnalytics
      const otherReplies = replyMsgs.filter((m) => m.author?.id !== ownerId);
      const isAnswered = otherReplies.length > 0;
      let responseTimeMs = null, responderCount = 0;
      let resolutionStatus = "unanswered";
      if (isAnswered) {
        const threadTime = fm?.timestamp ? new Date(fm.timestamp).getTime() : (t.thread_metadata?.create_timestamp ? new Date(t.thread_metadata.create_timestamp).getTime() : null);
        const sorted = [...otherReplies].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        if (threadTime && sorted.length > 0) {
          responseTimeMs = new Date(sorted[0].timestamp).getTime() - threadTime;
          if (responseTimeMs < 0) responseTimeMs = 0;
        }
        responderCount = new Set(otherReplies.map((m) => m.author?.id).filter(Boolean)).size;
        const hasResolution = replyMsgs.some((m) => {
          const text = (m.content ?? "").toLowerCase();
          return text.includes("thank") || text.includes("solved") || text.includes("resolved") || text.includes("fixed it") || text.includes("worked") || text.includes("works now") || text.includes("perfect");
        });
        resolutionStatus = hasResolution ? "likely-resolved" : "in-progress";
      }

      issues.push({
        id: t.id, name: t.name, channel_id: CHANNEL_ID, guild_id: GUILD_ID,
        owner_id: ownerId,
        owner_username: t.owner?.user?.username ?? fmAuthor?.username ?? "unknown",
        owner_global_name: t.owner?.user?.global_name ?? t.owner?.user?.username ?? fmAuthor?.global_name ?? fmAuthor?.username ?? null,
        owner_avatar: t.owner?.user?.avatar ?? fmAuthor?.avatar ?? null,
        created_at: t.thread_metadata?.create_timestamp || new Date().toISOString(),
        archived_at: t.thread_metadata?.archive_timestamp ?? null,
        archived: t.thread_metadata?.archived ?? false,
        locked: t.thread_metadata?.locked ?? false,
        message_count: t.message_count ?? (msgs?.length ?? 0),
        member_count: t.member_count ?? 0,
        total_message_sent: t.total_message_sent ?? 0,
        applied_tags: t.applied_tags ?? [],
        first_message_id: fmId,
        first_message_content: fmContent,
        first_message_author_id: fmAuthor?.id ?? null,
        first_message_author_name: fmAuthor?.global_name ?? fmAuthor?.username ?? null,
        first_message_created_at: fm?.timestamp ?? null,
        is_answered: isAnswered,
        response_time_ms: responseTimeMs,
        responder_count: responderCount,
        resolution_status: resolutionStatus,
      });
      for (const r of replyMsgs) {
        replyRows.push({
          id: r.id, issue_id: t.id,
          author_id: r.author?.id ?? "unknown",
          author_username: r.author?.username ?? "unknown",
          author_global_name: r.author?.global_name ?? null,
          content: r.content ?? "",
          timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
          has_attachment: (r.attachments?.length ?? 0) > 0,
          attachment_count: r.attachments?.length ?? 0,
        });
      }
    } catch (err) {
      console.warn(`thread ${t.id} failed:`, err.message);
    } finally {
      done++;
      if (done % 50 === 0 || done === threads.length) console.log(`messages: ${done}/${threads.length}, ${replyRows.length} replies so far`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(MSG_CONCURRENCY, threads.length) }, worker));

// --- upsert via PostgREST ---
async function upsert(table, rows, onConflict) {
  let ok = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Profile": SCHEMA, "Accept-Profile": SCHEMA,
        "Content-Type": "application/json",
        Prefer: `resolution=merge-duplicates,return=minimal${onConflict ? `,on-conflict=${onConflict}` : ""}`,
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok && res.status !== 206) throw new Error(`${table} upsert (${res.status}): ${(await res.text()).slice(0, 300)}`);
    ok += batch.length;
  }
  return ok;
}

console.log(`upserting ${issues.length} issues + ${replyRows.length} replies…`);
const issueCount = await upsert("issues", issues, "id");
const replyCount = replyRows.length > 0 ? await upsert("replies", replyRows, "id") : 0;
console.log(JSON.stringify({ channel: CHANNEL_ID, issues: issueCount, replies: replyCount, activeTotal, archivedTotal }, null, 2));