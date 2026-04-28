import { NextResponse } from 'next/server';
import { getWQClient } from '@/lib/wq-client';

// GET /api/wq/operators - Fetch available operators
export async function GET() {
  try {
    const client = getWQClient();
    if (!(await client.ensureAuthenticated())) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const operators = await client.getOperators();

    return NextResponse.json({ operators });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
