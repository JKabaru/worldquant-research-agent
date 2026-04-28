import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';

// GET /api/research/history - Get research history and feedback
export async function GET() {
  try {
    const engine = getResearchEngine();
    const state = engine.getState();

    return NextResponse.json({
      feedbackHistory: state.feedbackHistory.slice(-50),
      errorLog: state.errorLog.slice(-50),
      experienceBuffer: state.experienceBuffer.slice(-20),
      generationStats: state.generationStats.slice(-20),
      researchTrace: engine.getRecentTraces(200),
      lineageTree: state.lineageTree,
      totalSimulations: state.totalSimulations,
      successfulAlphas: state.successfulAlphas,
      failedSimulations: state.failedSimulations,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
