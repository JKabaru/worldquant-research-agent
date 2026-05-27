// ============================================================
// Dynamic Simulation Settings API
// GET  /api/settings — return persisted config (seed from defaults if empty)
// PUT  /api/settings — save updated config
// ============================================================

import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/persistence/database';
import {
  WQ_REGIONS,
  WQ_NEUTRALIZATIONS,
  DEFAULT_SIMULATION_SETTINGS,
} from '@/lib/constants';
import type { SimulationSettingsConfig } from '@/lib/types';

function buildDefaultConfig(): SimulationSettingsConfig {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    regions: WQ_REGIONS.map(r => ({
      value: r.value,
      label: r.label,
      universes: [...r.universes],
    })),
    neutralizations: [...WQ_NEUTRALIZATIONS],
    defaults: {
      region: DEFAULT_SIMULATION_SETTINGS.region,
      universe: DEFAULT_SIMULATION_SETTINGS.universe,
      delay: DEFAULT_SIMULATION_SETTINGS.delay,
      decay: DEFAULT_SIMULATION_SETTINGS.decay,
      neutralization: DEFAULT_SIMULATION_SETTINGS.neutralization,
      truncation: DEFAULT_SIMULATION_SETTINGS.truncation,
      instrumentType: DEFAULT_SIMULATION_SETTINGS.instrumentType,
      pasteurization: DEFAULT_SIMULATION_SETTINGS.pasteurization,
      unitHandling: DEFAULT_SIMULATION_SETTINGS.unitHandling,
      nanHandling: DEFAULT_SIMULATION_SETTINGS.nanHandling,
      maxTrade: DEFAULT_SIMULATION_SETTINGS.maxTrade,
      language: DEFAULT_SIMULATION_SETTINGS.language,
      testPeriod: DEFAULT_SIMULATION_SETTINGS.testPeriod,
    },
  };
}

function seedDefaultConfig(): SimulationSettingsConfig {
  const config = buildDefaultConfig();
  try {
    const db = getDatabase();
    db.saveSimulationConfig(JSON.stringify(config), 1);
  } catch {
    // Non-fatal: DB may not be initialized yet
  }
  return config;
}

// GET /api/settings — return simulation config
export async function GET() {
  try {
    const db = getDatabase();
    const row = db.getSimulationConfig();

    if (row && row.config_json) {
      try {
        const parsed = JSON.parse(row.config_json) as SimulationSettingsConfig;
        return NextResponse.json(parsed);
      } catch {
        // Stale/invalid JSON in DB — reseed
        const config = seedDefaultConfig();
        return NextResponse.json(config);
      }
    }

    // No config in DB — seed from defaults
    const config = seedDefaultConfig();
    return NextResponse.json(config);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT /api/settings — save updated config
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<SimulationSettingsConfig>;

    // Validate required structure
    if (body.regions && (!Array.isArray(body.regions) || body.regions.length === 0)) {
      return NextResponse.json({ error: 'regions must be a non-empty array' }, { status: 400 });
    }
    if (body.neutralizations && (!Array.isArray(body.neutralizations) || body.neutralizations.length === 0)) {
      return NextResponse.json({ error: 'neutralizations must be a non-empty array' }, { status: 400 });
    }

    // Merge with current config to preserve any missing fields
    const db = getDatabase();
    const currentRow = db.getSimulationConfig();
    const current: SimulationSettingsConfig = currentRow?.config_json
      ? JSON.parse(currentRow.config_json)
      : buildDefaultConfig();

    const merged: SimulationSettingsConfig = {
      ...current,
      ...body,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };

    db.saveSimulationConfig(JSON.stringify(merged), merged.version);
    return NextResponse.json(merged);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
