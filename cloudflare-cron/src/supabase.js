// Supabase REST helpers — minimal client, no SDK to keep bundle small.
// Uses Accept-Profile header so the discord schema works without exposing
// it in pgrest.db_schemas (which requires the postgres superuser).
const SCHEMA = "discord";

function headers(env, extra = {}) {
  return {
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    // Read from discord; write to discord
    "Accept-Profile": SCHEMA,
    "Content-Profile": SCHEMA,
    ...extra,
  };
}

function table(env, name) { return `${env.SUPABASE_URL}/rest/v1/${name}`; }

export async function fetchIssuesPage(env, { offset = 0, limit = 1000, select = "id,name,channel_id,applied_tags,first_message_content,sentiment" } = {}) {
  const url = `${table(env, "issues")}?select=${select}&order=id&offset=${offset}&limit=${limit}`;
  const resp = await fetch(url, { headers: headers(env) });
  if (!resp.ok) throw new Error(`fetchIssuesPage ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

export async function fetchIssueById(env, id) {
  const url = `${table(env, "issues")}?id=eq.${id}&select=id,name,channel_id,applied_tags,first_message_content,sentiment`;
  const resp = await fetch(url, { headers: headers(env) });
  if (!resp.ok) throw new Error(`fetchIssueById ${resp.status}: ${await resp.text()}`);
  const rows = await resp.json();
  return rows[0] ?? null;
}

export async function fetchUnclusteredIssueIds(env, limit = 1000) {
  const url = `${table(env, "issues")}?select=id&duplicate_cluster_id=is.null&limit=${limit}`;
  const resp = await fetch(url, { headers: headers(env) });
  if (!resp.ok) throw new Error(`fetchUnclusteredIssueIds ${resp.status}: ${await resp.text()}`);
  return (await resp.json()).map(r => r.id);
}

export async function insertCluster(env, { name, description = null, issueIds }) {
  if (!issueIds.length) return null;
  const url = table(env, "duplicate_clusters");
  const resp = await fetch(url, {
    method: "POST",
    headers: headers(env, { Prefer: "return=representation" }),
    body: JSON.stringify({ name, description, issue_count: issueIds.length }),
  });
  if (!resp.ok) throw new Error(`insertCluster ${resp.status}: ${await resp.text()}`);
  const [row] = await resp.json();
  await assignIssuesToCluster(env, issueIds, row.id);
  return row.id;
}

export async function assignIssuesToCluster(env, issueIds, clusterId) {
  // POST to a stored proc would be cleaner; for now batch PATCH in chunks.
  const CHUNK = 100;
  for (let i = 0; i < issueIds.length; i += CHUNK) {
    const slice = issueIds.slice(i, i + CHUNK);
    const ids = slice.map(id => `"${id}"`).join(",");
    const url = `${table(env, "issues")}?id=in.(${ids})`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: headers(env),
      body: JSON.stringify({ duplicate_cluster_id: clusterId }),
    });
    if (!resp.ok) throw new Error(`assignIssuesToCluster ${resp.status}: ${await resp.text()}`);
  }
}