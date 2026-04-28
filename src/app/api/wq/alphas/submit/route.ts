import { NextResponse } from 'next/server';
import { getWQClient } from '@/lib/wq-client';

export async function POST(request: Request) {
  try {
    const { alphaId } = await request.json();
    if (!alphaId) {
      return NextResponse.json({ error: 'Missing alphaId' }, { status: 400 });
    }
    const client = getWQClient();
    if (!(await client.ensureAuthenticated())) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const result = await client.submitAlpha(alphaId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
