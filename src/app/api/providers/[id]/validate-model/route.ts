import { NextResponse } from 'next/server';
import { getProviderClient, getProvider } from '@/lib/provider';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const { id } = await params;
    const body = await request.json();
    const { modelId } = body;

    if (!modelId) {
      return NextResponse.json(
        { success: false, message: 'modelId is required' },
        { status: 400 }
      );
    }

    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json(
        { success: false, message: 'Provider not found' },
        { status: 404 }
      );
    }

    const client = getProviderClient();
    client.connect(provider);

    const testPrompt = 'Reply with only a JSON object: {"status": "ok", "test": "passed"}';

    const response = await client.chatCompletion(
      [
        { role: 'system', content: 'You are a helpful assistant that responds in valid JSON format.' },
        { role: 'user', content: testPrompt },
      ],
      modelId,
      0.3,
      256,
      { type: 'json_object' }
    );

    const latencyMs = Date.now() - startTime;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response);
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Model did not return valid JSON. The model may not support JSON response format.',
        latencyMs,
      });
    }

    if (parsed.status === 'ok' || parsed.test === 'passed') {
      return NextResponse.json({
        success: true,
        message: `Model validated successfully. Latency: ${latencyMs}ms`,
        latencyMs,
      });
    }

    return NextResponse.json({
      success: false,
      message: `Model returned unexpected response: ${response.slice(0, 100)}`,
      latencyMs,
    });

  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : String(error);

    let userMessage = msg;

    if (msg.includes('401') || msg.includes('authentication')) {
      userMessage = 'Authentication failed. Check your API key.';
    } else if (msg.includes('403') || msg.includes('forbidden')) {
      userMessage = 'Access forbidden. Check API key permissions.';
    } else if (msg.includes('429') || msg.includes('rate limit')) {
      userMessage = 'Rate limit exceeded. Please wait and try again.';
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      userMessage = 'Request timed out. The model may be unavailable.';
    } else if (msg.includes('model') && msg.includes('not found')) {
      userMessage = 'Model not found. The model ID may be incorrect.';
    } else if (msg.includes('response_format')) {
      userMessage = 'Model does not support JSON response format.';
    }

    return NextResponse.json({
      success: false,
      message: userMessage,
      error: msg,
      latencyMs,
    });
  }
}