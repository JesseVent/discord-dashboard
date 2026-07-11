import { NextRequest, NextResponse } from 'next/server';
import { analyzeThemes } from '@/lib/theme-analyzer';
import type { Issue } from '@/lib/discord-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/analyze-themes
 * Body: { issues: Issue[] }
 * Uses LLM (z-ai-web-dev-sdk) to cluster issues into common themes.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const issues = (body.issues ?? []) as Issue[];

    if (!Array.isArray(issues) || issues.length === 0) {
      return NextResponse.json(
        { error: 'issues must be a non-empty array' },
        { status: 400 },
      );
    }

    const themes = await analyzeThemes(issues);
    return NextResponse.json({ themes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/analyze-themes]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
