import { NextResponse } from 'next/server';
import { getProviderPresets, saveProvider, getAllProviders, deleteProvider, setActiveProvider, getProvider } from '@/lib/provider';
import { ModelProvider } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

// GET /api/providers - List all configured providers and presets
export async function GET() {
  try {
    const providers = getAllProviders();
    const presets = getProviderPresets();

    return NextResponse.json({
      providers,
      presets,
      activeProvider: providers.find(p => p.isActive) || null,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/providers - Create a new provider configuration
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, baseUrl, apiKey } = body as {
      name: string;
      baseUrl: string;
      apiKey: string;
    };
    void (body as Record<string, string>).type; // type used implicitly

    if (!name || !baseUrl || !apiKey) {
      return NextResponse.json({ error: 'Missing required fields: name, baseUrl, apiKey' }, { status: 400 });
    }

    const provider: ModelProvider = {
      id: uuidv4(),
      name,
      baseUrl,
      apiKey,
      isActive: getAllProviders().length === 0, // First provider is active by default
      createdAt: new Date().toISOString(),
    };

    saveProvider(provider);

    return NextResponse.json({ provider }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/providers - Delete a provider
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing provider id' }, { status: 400 });

    const deleted = deleteProvider(id);
    return NextResponse.json({ deleted });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/providers - Update provider (e.g., set active)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, isActive } = body as { id: string; isActive?: boolean };

    if (!id) return NextResponse.json({ error: 'Missing provider id' }, { status: 400 });

    if (isActive !== undefined && isActive) {
      setActiveProvider(id);
    }

    const provider = getProvider(id);
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });

    return NextResponse.json({ provider });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
