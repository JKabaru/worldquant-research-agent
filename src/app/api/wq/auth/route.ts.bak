import { NextResponse } from 'next/server';
import { getWQClient } from '@/lib/wq-client';
import { WQCredentials } from '@/lib/types';

// POST /api/wq/auth - Authenticate with WorldQuant BRAIN
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body as WQCredentials;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const client = getWQClient();
    const session = await client.authenticate({ email, password });

    return NextResponse.json({
      success: true,
      message: 'Authentication successful',
      session,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}

// GET /api/wq/auth - Check authentication status
export async function GET() {
  try {
    const client = getWQClient();
    const isAuthenticated = await client.ensureAuthenticated();

    return NextResponse.json({ isAuthenticated });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/wq/auth - Disconnect session
export async function DELETE() {
  try {
    const client = getWQClient();
    await client.disconnect();

    return NextResponse.json({ success: true, message: 'Disconnected' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
