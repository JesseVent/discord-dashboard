import ZAI from 'z-ai-web-dev-sdk';
import type { Issue, ThemeCluster } from './discord-types';
import { fallbackThemes } from './fallback-themes';

/**
 * SERVER-ONLY: Use the LLM to cluster issues into common themes.
 * Returns up to 8 themes with counts, descriptions, keywords, and sample issue IDs.
 *
 * IMPORTANT: This module imports `z-ai-web-dev-sdk` which depends on Node's
 * `fs/promises`, `path`, `os` — it MUST NOT be imported from client components.
 * Call it only from API routes or server actions.
 */
export async function analyzeThemes(issues: Issue[]): Promise<ThemeCluster[]> {
  if (issues.length === 0) return [];

  // Build a compact payload — strip long content to fit the context window
  const payload = issues.slice(0, 120).map((issue, idx) => ({
    idx,
    title: issue.name.slice(0, 140),
    excerpt: (issue.firstMessageContent || issue.name).slice(0, 280),
  }));

  const systemPrompt = `You are an expert support engineer analyzing Discord forum issues for a developer platform.
Cluster the provided issues into 4-8 high-level themes that capture the most common problem categories.
Common categories for platforms like Supabase include: Auth & JWT issues, Database connectivity/timeouts, Edge Functions, Migrations/Branching, Billing/Plans/Quotas, Network/DNS/Region issues, Dashboard/UI access, Storage, Realtime, RLS/Permissions, Compliance/Security, and Account/OAuth lockout.
But pick themes that best fit the actual data you see.
Return STRICT JSON only, no prose.`;

  const userPrompt = `Issues (JSON array):
${JSON.stringify(payload)}

Return JSON with this exact schema:
{
  "themes": [
    {
      "theme": "Short theme name (2-4 words)",
      "description": "One sentence describing what kind of issues fall under this theme",
      "keywords": ["3-6 keywords or short phrases"],
      "issue_idxs": [0, 5, 12]
    }
  ]
}
Sort themes by descending count (issue_idxs.length). Include only themes with at least 2 issues.`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1800,
    });

    const raw = completion.choices?.[0]?.message?.content ?? '';
    const jsonText = extractJson(raw);
    if (!jsonText) return fallbackThemes(issues);

    const parsed = JSON.parse(jsonText) as {
      themes: Array<{
        theme: string;
        description: string;
        keywords: string[];
        issue_idxs: number[];
      }>;
    };

    const themes: ThemeCluster[] = (parsed.themes ?? [])
      .filter((t) => Array.isArray(t.issue_idxs) && t.issue_idxs.length > 0)
      .map((t) => ({
        theme: String(t.theme ?? 'Unknown').slice(0, 60),
        description: String(t.description ?? '').slice(0, 240),
        keywords: Array.isArray(t.keywords)
          ? t.keywords.slice(0, 6).map((k) => String(k).slice(0, 40))
          : [],
        count: t.issue_idxs.length,
        sampleIssueIds: t.issue_idxs
          .filter((i) => i >= 0 && i < issues.length)
          .slice(0, 5)
          .map((i) => issues[i].id),
      }))
      .sort((a, b) => b.count - a.count);

    if (themes.length === 0) return fallbackThemes(issues);
    return themes;
  } catch (err) {
    console.error('[analyzeThemes] LLM failed:', err);
    return fallbackThemes(issues);
  }
}

function extractJson(text: string): string | null {
  if (!text) return null;
  // Strip code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Find first { ... last }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return candidate.slice(first, last + 1);
}
