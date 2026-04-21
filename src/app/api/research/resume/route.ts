import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';

export async function POST() {
  try {
    const engine = getResearchEngine();
    if (engine.getStatus() !== 'paused') {
      return NextResponse.json({ error: 'Research is not paused' }, { status: 400 });
    }
    await engine.resume();
    return NextResponse.json({ success: true, message: 'Research resumed' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
