import { NextResponse } from 'next/server';
import { getProviderClient, getProvider } from '@/lib/provider';

// POST /api/providers/[id]/test - Test provider connection
export async function POST(
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

    const result = await client.testConnection();

    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
