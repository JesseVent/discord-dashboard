// Clustering — for a set of issue IDs, build the similarity graph
// and return connected components.

const DEFAULT_THRESHOLD = 0.86; // cosine similarity; tweak via env if needed
const DEFAULT_TOP_K = 5;

export async function clusterIssues(env, issues, { topK = DEFAULT_TOP_K, threshold = DEFAULT_THRESHOLD } = {}) {
  // 1. For each issue, get its top-K nearest neighbors via Vectorize.
  const neighborLists = [];
  for (const issue of issues) {
    const text = buildTextFromIssue(issue);
    if (!text.trim()) continue;
    const vector = await embedText(env, text);
    const matches = await env.VECTORIZE.query(vector, { topK: topK + 1, returnMetadata: true });
    const neighbors = matches.matches
      .filter(m => m.score >= threshold && m.metadata?.issueId && m.metadata.issueId !== issue.id)
      .map(m => ({ issueId: m.metadata.issueId, score: m.score }));
    neighborLists.push({ anchor: issue.id, neighbors });
  }

  // 2. Build undirected edge map.
  const edges = {};
  for (const { anchor, neighbors } of neighborLists) {
    if (!neighbors.length) continue;
    edges[anchor] = neighbors.map(n => n.issueId);
    for (const n of neighbors) {
      if (!edges[n.issueId]) edges[n.issueId] = [];
      if (!edges[n.issueId].includes(anchor)) edges[n.issueId].push(anchor);
    }
  }

  // 3. Union-find → connected components (drop singletons).
  return connectedComponents(edges);
}

function buildTextFromIssue(issue) {
  const name = issue.name ?? "";
  const body = issue.first_message_content ?? "";
  let tags = "";
  if (Array.isArray(issue.applied_tags)) tags = issue.applied_tags.join(" ");
  return [name, body, tags ? `Tags: ${tags}` : ""].filter(Boolean).join("\n\n").slice(0, 8000);
}

async function embedText(env, text) {
  const resp = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [text] });
  return resp.data[0];
}

export function connectedComponents(edges) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let p = parent.get(x);
    if (p !== x) { p = find(p); parent.set(x, p); }
    return parent.get(x);
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [a, bs] of Object.entries(edges)) {
    find(a);
    for (const b of bs) { find(b); union(a, b); }
  }
  const groups = new Map();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  return [...groups.values()].filter(g => g.length >= 2);
}