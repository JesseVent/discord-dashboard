// Clustering — for a set of issues, build the similarity graph
// and return connected components.
//
// Cost note: re-embeds each issue via Workers AI. Fine for incremental
// clustering of a few hundred items per run; for the initial 40k use
// `scripts/cluster_bulk.py` (local sentence-transformers + Vectorize REST).

import { buildEmbedText } from "./embed.js";

const DEFAULT_THRESHOLD = 0.86; // cosine similarity; tweak via env if needed
const DEFAULT_TOP_K = 5;

export async function clusterIssues(env, issues, { topK = DEFAULT_TOP_K, threshold = DEFAULT_THRESHOLD } = {}) {
  const neighborLists = [];
  for (const issue of issues) {
    const text = buildEmbedText(issue);
    if (!text.trim()) continue;
    const vector = await embedText(env, text);
    const matches = await env.VECTORIZE.query(vector, { topK: topK + 1, returnMetadata: true });
    const neighbors = matches.matches
      .filter(m => m.score >= threshold && m.metadata?.issueId && m.metadata.issueId !== issue.id)
      .map(m => ({ issueId: m.metadata.issueId, score: m.score }));
    neighborLists.push({ anchor: issue.id, neighbors });
  }

  const edges = {};
  for (const { anchor, neighbors } of neighborLists) {
    if (!neighbors.length) continue;
    edges[anchor] = neighbors.map(n => n.issueId);
    for (const n of neighbors) {
      if (!edges[n.issueId]) edges[n.issueId] = [];
      if (!edges[n.issueId].includes(anchor)) edges[n.issueId].push(anchor);
    }
  }

  return connectedComponents(edges);
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