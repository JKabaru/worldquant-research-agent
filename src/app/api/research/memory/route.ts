import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';
import { getDatabase } from '@/lib/persistence/database';

// GET /api/research/memory - Get memory graph + retrieval traces
export async function GET(request: Request) {
  try {
    const engine = getResearchEngine();
    const state = engine.getState();
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit') || '200');
    const limit = Number.isFinite(limitParam) ? Math.min(2000, Math.max(1, limitParam)) : 200;

    let nodes: unknown[] = [];
    let edges: unknown[] = [];
    let retrievalTraces: unknown[] = [];
    try {
      const db = getDatabase();
      nodes = db.getMemoryNodes(state.id, limit);
      edges = db.getMemoryEdges(state.id, limit);
      retrievalTraces = db.getRetrievalTraces(state.id, limit);
    } catch {
      // Non-fatal fallback: return in-memory traces only
    }

    return NextResponse.json({
      sessionId: state.id,
      generation: state.currentGeneration,
      status: state.status,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      retrievalTraceCount: retrievalTraces.length,
      nodes,
      edges,
      retrievalTraces,
      recentTrace: engine.getRecentTraces(limit),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
