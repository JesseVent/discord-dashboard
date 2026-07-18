// Main Worker entry — HTTP routes + scheduled triggers.
import { embedAndUpsert, embedQuery, buildEmbedText } from "./embed.js";
import { clusterIssues } from "./cluster.js";
import {
  fetchIssueById,
  fetchIssuesPage,
  fetchUnclusteredIssueIds,
  insertCluster,
} from "./supabase.js";

const CRON_SECRET_HEADER = "Authorization";

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    if (cron === "0 * * * *") return pingSync(env);
    if (cron === "15 3 * * *") return runDailyCluster(env, ctx);
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const auth = req.headers.get(CRON_SECRET_HEADER);
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      return new Response("unauthorized", { status: 401 });
    }

    try {
      if (path === "/embed" && req.method === "POST") {
        return await handleEmbed(req, env);
      }
      if (path === "/search" && req.method === "POST") {
        return await handleSearch(req, env);
      }
      if (path === "/cluster" && req.method === "POST") {
        return await handleCluster(env, ctx);
      }
      if (path === "/health") return new Response("ok");
      return new Response("not found", { status: 404 });
    } catch (err) {
      return new Response(`error: ${err.message}`, { status: 500 });
    }
  },
};

async function pingSync(env) {
  const url = env.TARGET_URL;
  if (!url) return console.error("Missing TARGET_URL");
  if (!env.CRON_SECRET) return console.error("Missing CRON_SECRET");
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
    console.log(`Pinged sync. Status: ${resp.status}`);
  } catch (err) {
    console.error(`Sync ping failed: ${err.message}`);
  }
}

async function runDailyCluster(env, ctx) {
  ctx.waitUntil(dailyClusterJob(env));
}

async function dailyClusterJob(env) {
  // Cluster issues that don't yet have a cluster assignment.
  const ids = await fetchUnclusteredIssueIds(env, 500);
  if (!ids.length) return console.log("No unclustered issues");
  const issues = (await Promise.all(ids.map(id => fetchIssueById(env, id)))).filter(Boolean);
  const groups = await clusterIssues(env, issues);
  console.log(`Found ${groups.length} clusters from ${issues.length} issues`);
  for (const members of groups) {
    const head = members[0];
    const sample = issues.find(i => i.id === head);
    const name = sample?.name?.slice(0, 80) || `cluster-${head}`;
    await insertCluster(env, { name, description: null, issueIds: members });
  }
}

async function handleEmbed(req, env) {
  const body = await req.json();
  const issue = body.issue ?? body;
  const id = await embedAndUpsert(env, issue);
  return Response.json({ id });
}

async function handleSearch(req, env) {
  const { query, topK = 10 } = await req.json();
  const vector = await embedQuery(env, query);
  const matches = await env.VECTORIZE.query(vector, { topK, returnMetadata: true });
  return Response.json({
    matches: matches.matches.map(m => ({
      issueId: m.metadata?.issueId,
      score: m.score,
      channelId: m.metadata?.channelId,
    })),
  });
}

async function handleCluster(env, ctx) {
  ctx.waitUntil((async () => {
    await dailyClusterJob(env);
  })());
  return Response.json({ ok: true });
}