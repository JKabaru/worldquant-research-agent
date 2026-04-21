// ============================================================
// API: GET /api/persistence/history - Historical Data from SQLite
// Query params: ?type=fingerprints|simulations|errors|feedback|lineage|generations|experience&limit=50
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/persistence/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'simulations';
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const source = searchParams.get('source') || undefined;

    const db = getDatabase();

    switch (type) {
      case 'fingerprints': {
        const data = db.getFingerprints(limit);
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'simulations': {
        const data = db.getSimulationHistory(limit);
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'simulations_successful': {
        const data = db.getSuccessfulSimulations(limit);
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'errors': {
        const data = db.getErrorLogs(limit, source);
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'errors_frequency': {
        const data = db.getErrorFrequency();
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'feedback': {
        const loopFilter = searchParams.get('loop') || undefined;
        const data = db.getFeedbackHistory(loopFilter, limit);
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'lineage': {
        const data = db.getLineageTree(limit);
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'generations': {
        const session = searchParams.get('session') || undefined;
        const data = db.getGenerationStats(session, limit);
        return NextResponse.json({ type, count: data.length, data });
      }
      case 'experience': {
        const strategy = searchParams.get('strategy') || undefined;
        const data = db.sampleReplayBuffer(limit, strategy);
        const stats = db.getReplayBufferStats();
        return NextResponse.json({ type, count: data.length, data, stats });
      }
      case 'category_distribution': {
        const data = db.getCategoryDistribution();
        return NextResponse.json({ type, data });
      }
      case 'style_distribution': {
        const data = db.getStyleDistribution();
        return NextResponse.json({ type, data });
      }
      case 'sessions': {
        const sessionCount = db.getSessionCount();
        const latest = db.getLatestSession();
        return NextResponse.json({ type, sessionCount, latest });
      }
      default:
        return NextResponse.json({ error: `Unknown history type: ${type}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
