import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import type { Issue } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/detect-duplicates
 * Body: { issues: Issue[] }
 *
 * Uses the LLM to cluster semantically similar issues — spot recurring bugs.
 * Returns: { clusters: [{ name, description, issueIds: string[] }] }
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const issues = (body.issues ?? []) as Issue[];

    if (!Array.isArray(issues) || issues.length === 0) {
      return NextResponse.json({ error: 'issues must be a non-empty array' }, { status: 400 });
    }

    // Build compact payload — limit to 80 issues, truncate
    const payload = issues.slice(0, 80).map((issue, idx) => ({
      idx,
      title: issue.name.slice(0, 140),
      excerpt: (issue.firstMessageContent || issue.name).slice(0, 220),
      tags: issue.appliedTags ?? [],
    }));

    const systemPrompt = `You are an expert support engineer identifying DUPLICATE or near-duplicate issues in a Discord support forum.
Cluster issues that describe the SAME underlying problem (same root cause, same error, same feature).
Issues in the same cluster should be about the same thing — not just the same topic area.
For example, three issues about "Supabase auth returning 401 after JWT update" are duplicates.
But "auth 401" and "auth MFA lockout" are NOT duplicates — different root causes.
Return STRICT JSON only, no prose.`;

    const userPrompt = `Issues (JSON array):
${JSON.stringify(payload)}

Return JSON with this exact schema:
{
  "clusters": [
    {
      "name": "Short label for the duplicate cluster (e.g. 'Auth 401 after JWT update')",
      "description": "One sentence describing the shared root cause",
      "issue_idxs": [0, 5, 12]
    }
  ]
}
Rules:
- Only include clusters with 2+ issues
- Sort clusters by size (largest first)
- An issue can only belong to ONE cluster
- If there are no duplicates, return { "clusters": [] }`;

    let clusters: Array<{ name: string; description: string; issue_idxs: number[] }> = [];

    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      });

      const raw = completion.choices?.[0]?.message?.content ?? '';
      const jsonText = extractJson(raw);
      if (jsonText) {
        const parsed = JSON.parse(jsonText) as { clusters: Array<{ name: string; description: string; issue_idxs: number[] }> };
        clusters = parsed.clusters ?? [];
      }
    } catch (err) {
      console.error('[/api/detect-duplicates] LLM failed:', err);
    }

    // Map indexes back to issue IDs
    const mappedClusters = clusters
      .filter((c) => Array.isArray(c.issue_idxs) && c.issue_idxs.length >= 2)
      .map((c) => ({
        name: String(c.name ?? 'Duplicate cluster').slice(0, 80),
        description: String(c.description ?? '').slice(0, 200),
        issueIds: c.issue_idxs
          .filter((i) => i >= 0 && i < issues.length)
          .map((i) => issues[i].id),
      }))
      .filter((c) => c.issueIds.length >= 2)
      .sort((a, b) => b.issueIds.length - a.issueIds.length);

    return NextResponse.json({ clusters: mappedClusters });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/detect-duplicates]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function extractJson(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return candidate.slice(first, last + 1);
}
