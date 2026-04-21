import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';
import { getProviderClient } from '@/lib/provider';

// GET /api/research/status - Get research engine status
export async function GET() {
  try {
    const engine = getResearchEngine();
    const state = engine.getState();

    // Include rate limit stats if provider is connected
    let rateLimitStats = null;
    try {
      const provider = getProviderClient();
      if (provider.isConnected()) {
        rateLimitStats = provider.getRateLimitStats();
      }
    } catch { /* ignore */ }

    return NextResponse.json({ ...state, rateLimitStats });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
