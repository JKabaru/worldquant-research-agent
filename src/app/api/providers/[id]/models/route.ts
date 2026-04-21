import { NextResponse } from 'next/server';
import { getProviderClient, getProvider } from '@/lib/provider';

// GET /api/providers/[id]/models - List models for a specific provider
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    const client = getProviderClient();
    client.connect(provider);

    const models = await client.listModels();

    return NextResponse.json({
      models,
      providerId: id,
      providerName: provider.name,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
