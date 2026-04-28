import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';

// GET /api/research/trace - Get structured research trace for transparency
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit') || '200');
    const limit = Number.isFinite(limitParam) ? Math.min(2000, Math.max(1, limitParam)) : 200;

    const engine = getResearchEngine();
    const state = engine.getState();
    const trace = engine.getRecentTraces(limit);

    return NextResponse.json({
      sessionId: state.id,
      generation: state.currentGeneration,
      status: state.status,
      traceCount: trace.length,
      trace,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
