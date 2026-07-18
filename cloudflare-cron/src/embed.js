// Embedding helpers — build text, call Workers AI, upsert to Vectorize.
const MODEL = "@cf/baai/bge-base-en-v1.5";

export function buildEmbedText(issue) {
  const name = issue.name ?? "";
  const body = issue.first_message_content ?? "";
  let tags = "";
  if (Array.isArray(issue.applied_tags)) tags = issue.applied_tags.join(" ");
  else if (typeof issue.applied_tags === "string" && issue.applied_tags.length > 2) {
    try { tags = JSON.parse(issue.applied_tags).join(" "); } catch { tags = ""; }
  }
  return [name, body, tags ? `Tags: ${tags}` : ""].filter(Boolean).join("\n\n").slice(0, 8000);
}

export async function embedText(env, text) {
  const resp = await env.AI.run(MODEL, { text: [text] });
  // Workers AI returns { shape: [n], data: [[...], ...] }
  return resp.data[0];
}

export async function embedAndUpsert(env, issue) {
  const text = buildEmbedText(issue);
  if (!text.trim()) return null;
  const vector = await embedText(env, text);
  await env.VECTORIZE.upsert([{
    id: `issue:${issue.id}`,
    values: vector,
    metadata: {
      issueId: String(issue.id),
      channelId: String(issue.channel_id ?? ""),
      sentiment: String(issue.sentiment ?? ""),
    },
  }]);
  return `issue:${issue.id}`;
}

export async function embedQuery(env, query) {
  return embedText(env, query);
}