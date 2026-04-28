import { NextResponse } from 'next/server';
import { getConfiguredSourcePaths, previewSourceContext } from '@/lib/source-memory';

// GET /api/research/source-context?query=...&maxSnippets=...&maxTokens=...
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get('query') || '').trim();
    const maxSnippetsParam = Number(url.searchParams.get('maxSnippets') || '6');
    const maxTokensParam = Number(url.searchParams.get('maxTokens') || '380');

    const maxSnippets = Number.isFinite(maxSnippetsParam)
      ? Math.min(20, Math.max(1, Math.floor(maxSnippetsParam)))
      : 6;

    const maxTokens = Number.isFinite(maxTokensParam)
      ? Math.min(2000, Math.max(50, Math.floor(maxTokensParam)))
      : 380;

    const effectiveQuery = query || 'general alpha research guidance';
    const preview = previewSourceContext(effectiveQuery, maxSnippets, maxTokens);

    return NextResponse.json({
      sourceFiles: getConfiguredSourcePaths(),
      ...preview,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
