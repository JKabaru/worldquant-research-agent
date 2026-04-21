import { eventBridge } from '@/lib/event-bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const stream = eventBridge.getEventStream();

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
