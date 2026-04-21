import { NextResponse } from 'next/server';
import { getWQClient } from '@/lib/wq-client';

// GET /api/wq/data-fields - Fetch available data fields
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'USA';
    const universe = searchParams.get('universe') || 'TOP3000';
    const delay = parseInt(searchParams.get('delay') || '1');
    const datasetId = searchParams.get('datasetId') || undefined;
    const category = searchParams.get('category') || undefined;
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    const client = getWQClient();
    if (!client.isAuthenticated()) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const result = await client.getDataFields({
      region,
      universe,
      delay,
      datasetId,
      category,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
