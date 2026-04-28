import { NextResponse } from 'next/server';
import { getWQClient } from '@/lib/wq-client';
import { WQSimulationRequest } from '@/lib/types';

// POST /api/wq/simulations - Submit a simulation to WorldQuant BRAIN
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { expression, settings } = body as {
      expression: string;
      settings?: Record<string, unknown>;
    };

    if (!expression) {
      return NextResponse.json({ error: 'Alpha expression is required' }, { status: 400 });
    }

    const client = getWQClient();
    if (!(await client.ensureAuthenticated())) {
      return NextResponse.json({ error: 'Not authenticated. Please login first.' }, { status: 401 });
    }

    const simulationData: WQSimulationRequest = {
      type: 'REGULAR',
      settings: {
        instrumentType: 'EQUITY',
        region: (settings?.region as string) || 'USA',
        universe: (settings?.universe as string) || 'TOP3000',
        delay: (settings?.delay as number) || 1,
        decay: (settings?.decay as number) || 0,
        neutralization: (settings?.neutralization as string) || 'INDUSTRY',
        truncation: (settings?.truncation as number) || 0.08,
        pasteurization: 'ON',
        unitHandling: 'VERIFY',
        nanHandling: 'OFF',
        maxTrade: 'OFF',
        language: 'FASTEXPR',
        visualization: false,
        testPeriod: 'P5Y0M0D',
      },
      regular: expression,
    };

    const { progressUrl, simulationId } = await client.submitSimulation(simulationData);

    // Simulation is submitted, client polls via GET endpoint
    // The progressUrl is returned for the client to poll
    void client; // ensure client reference

    // Return immediately with polling URL
    return NextResponse.json({
      success: true,
      simulationId,
      progressUrl,
      message: 'Simulation submitted. Use the progress URL to poll for results.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET /api/wq/simulations - Check simulation status
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const progressUrl = searchParams.get('url');

    if (!progressUrl) {
      return NextResponse.json({ error: 'Missing simulation progress URL' }, { status: 400 });
    }

    const client = getWQClient();
    if (!(await client.ensureAuthenticated())) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const result = await client.pollSimulation(
      progressUrl,
      30000 // Short timeout for status check
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
