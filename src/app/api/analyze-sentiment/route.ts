import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import type { Issue } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/analyze-sentiment
 * Body: { issues: Issue[] }
 *
 * Uses the LLM to score sentiment for each issue based on its title + first message + replies.
 * Returns: { results: [{ id, sentiment, score, summary }] }
 *
 * Sentiment values: frustrated | neutral | positive | resolved | unknown
 * Score: -1.0 (very frustrated) to 1.0 (very positive/resolved)
 */

const SENTIMENT_VALUES = ['frustrated', 'neutral', 'positive', 'resolved'] as const;
type Sentiment = (typeof SENTIMENT_VALUES)[number] | 'unknown';

const SENTIMENT_SCORES: Record<Sentiment, number> = {
  frustrated: -0.7,
  neutral: 0.0,
  positive: 0.5,
  resolved: 0.9,
  unknown: 0.0,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const issues = (body.issues ?? []) as Issue[];

    if (!Array.isArray(issues) || issues.length === 0) {
      return NextResponse.json({ error: 'issues must be a non-empty array' }, { status: 400 });
    }

    // Build a compact payload — limit to 50 issues, truncate content
    const payload = issues.slice(0, 50).map((issue, idx) => {
      const replyTexts = (issue.replies ?? [])
        .slice(0, 5) // up to 5 replies
        .map((r) => (r.content ?? '').slice(0, 200))
        .filter(Boolean);
      return {
        idx,
        title: issue.name.slice(0, 120),
        body: (issue.firstMessageContent || '').slice(0, 400),
        replies: replyTexts,
        resolutionStatus: issue.resolutionStatus ?? 'unknown',
      };
    });

    const systemPrompt = `You are an expert support analyst scoring the sentiment of Discord support issues.
For each issue, classify its overall sentiment into exactly one of:
- "frustrated" — the user is upset, angry, or stuck (e.g. "this is unacceptable", "been waiting for days", "nothing works")
- "neutral" — factual request for help, no strong emotion
- "positive" — user is appreciative, curious, or constructive
- "resolved" — the issue was solved and user confirmed (look for "thanks", "that worked", "solved" in replies)

Consider both the original post AND the replies. A frustrated post with a resolution reply should be "resolved".
Return STRICT JSON only, no prose.`;

    const userPrompt = `Issues (JSON array):
${JSON.stringify(payload)}

Return JSON with this exact schema:
{
  "results": [
    {
      "idx": 0,
      "sentiment": "frustrated" | "neutral" | "positive" | "resolved",
      "summary": "one short sentence (max 80 chars) explaining the sentiment"
    }
  ]
}
Include one entry per issue, in the same order as the input.`;

    let results: Array<{ idx: number; sentiment: string; summary: string }> = [];

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
        const parsed = JSON.parse(jsonText) as { results: Array<{ idx: number; sentiment: string; summary: string }> };
        results = parsed.results ?? [];
      }
    } catch (err) {
      console.error('[/api/analyze-sentiment] LLM failed:', err);
      // Fall through to heuristic fallback
    }

    // Map results back to issues; fill in any missing with heuristic
    const resultMap = new Map<number, { sentiment: Sentiment; summary: string }>();
    for (const r of results) {
      const sentiment = SENTIMENT_VALUES.includes(r.sentiment as (typeof SENTIMENT_VALUES)[number])
        ? (r.sentiment as Sentiment)
        : 'unknown';
      resultMap.set(r.idx, { sentiment, summary: (r.summary ?? '').slice(0, 120) });
    }

    const finalResults = issues.slice(0, 50).map((issue, idx) => {
      const fromLlm = resultMap.get(idx);
      if (fromLlm) {
        return {
          id: issue.id,
          sentiment: fromLlm.sentiment,
          score: SENTIMENT_SCORES[fromLlm.sentiment],
          summary: fromLlm.summary,
        };
      }
      // Heuristic fallback: derive from resolution status + keywords
      const fallback = heuristicSentiment(issue);
      return {
        id: issue.id,
        sentiment: fallback.sentiment,
        score: SENTIMENT_SCORES[fallback.sentiment],
        summary: fallback.summary,
      };
    });

    return NextResponse.json({ results: finalResults });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/analyze-sentiment]', msg);
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

/**
 * Heuristic fallback when LLM is unavailable.
 * Uses resolution status + keyword matching.
 */
function heuristicSentiment(issue: Issue): { sentiment: Sentiment; summary: string } {
  if (issue.resolutionStatus === 'likely-resolved') {
    return { sentiment: 'resolved', summary: 'Issue appears resolved based on reply keywords.' };
  }

  const text = `${issue.name} ${issue.firstMessageContent}`.toLowerCase();
  const frustratedKeywords = [
    'unacceptable', 'frustrated', 'angry', 'furious', 'ridiculous', 'terrible',
    'awful', 'worst', 'broken', 'been waiting', 'days', 'hours', 'urgent',
    'critical', 'emergency', 'last straw', 'giving up', 'done with',
  ];
  const positiveKeywords = [
    'thank', 'thanks', 'appreciate', 'great', 'love', 'awesome', 'helpful',
    'grateful', 'wonderful', 'excellent',
  ];

  if (frustratedKeywords.some((k) => text.includes(k))) {
    return { sentiment: 'frustrated', summary: 'Frustrated language detected in issue text.' };
  }
  if (positiveKeywords.some((k) => text.includes(k))) {
    return { sentiment: 'positive', summary: 'Positive or appreciative language detected.' };
  }
  return { sentiment: 'neutral', summary: 'No strong emotional signals detected.' };
}
