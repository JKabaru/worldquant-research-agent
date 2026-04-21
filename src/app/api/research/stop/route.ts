import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';

// POST /api/research/stop - Stop the research engine
export async function POST() {
  try {
    const engine = getResearchEngine();

    if (engine.getStatus() !== 'running' && engine.getStatus() !== 'paused') {
      return NextResponse.json({ error: 'Research engine is not running' }, { status: 400 });
    }

    engine.stop();

    return NextResponse.json({
      success: true,
      message: 'Research engine stopping',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
