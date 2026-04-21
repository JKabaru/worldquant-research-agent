import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';

export async function POST() {
  try {
    const engine = getResearchEngine();
    if (engine.getStatus() !== 'running') {
      return NextResponse.json({ error: 'Research is not running' }, { status: 400 });
    }
    engine.pause();
    return NextResponse.json({ success: true, message: 'Research paused' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
