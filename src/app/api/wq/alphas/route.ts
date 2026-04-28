import { NextResponse } from 'next/server';
import { getWQClient } from '@/lib/wq-client';

// GET /api/wq/alphas - List user's alphas from WorldQuant BRAIN
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status') || undefined;
    const minFitness = searchParams.get('minFitness') ? parseFloat(searchParams.get('minFitness')!) : undefined;
    const minSharpe = searchParams.get('minSharpe') ? parseFloat(searchParams.get('minSharpe')!) : undefined;
    const order = searchParams.get('order') || undefined;

    const client = getWQClient();
    if (!(await client.ensureAuthenticated())) {
      return NextResponse.json({ error: 'Not authenticated. Please login first.' }, { status: 401 });
    }

    const result = await client.listUserAlphas({
      limit,
      offset,
      status,
      minFitness,
      minSharpe,
      order,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
