import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';

// POST /api/research/reset - Reset the research engine (wipes all data)
export async function POST() {
  try {
    const engine = getResearchEngine();

    if (engine.getStatus() === 'running' || engine.getStatus() === 'paused') {
      engine.stop();
    }

    engine.reset();

    return NextResponse.json({
      success: true,
      message: 'Research engine reset - all data cleared',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}