import { NextResponse } from 'next/server';
import { getResearchEngine } from '@/lib/research-engine';
import { ResearchConfig } from '@/lib/types';

// POST /api/research/start - Start the research engine
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const engine = getResearchEngine();

    // Check if already running
    if (engine.getStatus() === 'running') {
      return NextResponse.json({ error: 'Research engine is already running' }, { status: 409 });
    }

    const config: ResearchConfig = {
      providerId: body.providerId,
      modelId: body.modelId,
      region: body.region || 'USA',
      universe: body.universe || 'TOP3000',
      delay: body.delay || 1,
      neutralization: body.neutralization || 'INDUSTRY',
      maxConcurrentSimulations: body.maxConcurrentSimulations || 5,
      maxDailySimulations: body.maxDailySimulations || 100,
      targetSharpe: body.targetSharpe || 1.5,
      targetFitness: body.targetFitness || 1.0,
      maxTurnover: body.maxTurnover || 0.7,
      diversityThreshold: body.diversityThreshold || 0.7,
      autoSubmit: body.autoSubmit || false,
      researchStrategy: body.researchStrategy || 'evolutionary',
      maxGenerations: body.maxGenerations || 100,
      populationSize: body.populationSize || 5,
      enableAutoCorrection: body.enableAutoCorrection !== false,
      enableDiversityManagement: body.enableDiversityManagement !== false,
      stylePremiaRotation: body.stylePremiaRotation !== false,
    };

    engine.configure(config);
    await engine.start();

    return NextResponse.json({
      success: true,
      message: 'Research engine started',
      state: engine.getState(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
