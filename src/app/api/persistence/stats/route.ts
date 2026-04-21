// ============================================================
// API: GET /api/persistence/stats - Database & Warehouse Stats
// ============================================================

import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/persistence/database';
import { getDataWarehouse } from '@/lib/persistence/data-warehouse';

export async function GET() {
  try {
    // SQLite stats
    let dbStats = null;
    let dbError = null;
    try {
      dbStats = getDatabase().getStats();
    } catch (error) {
      dbError = error instanceof Error ? error.message : String(error);
    }

    // DuckDB Warehouse stats
    let warehouseStats = null;
    let warehouseError = null;
    try {
      const warehouse = await getDataWarehouse();
      warehouseStats = warehouse.getStats();
    } catch (error) {
      warehouseError = error instanceof Error ? error.message : String(error);
    }

    return NextResponse.json({
      sqlite: {
        connected: !!dbStats,
        error: dbError,
        ...dbStats,
      },
      warehouse: {
        connected: !!warehouseStats,
        error: warehouseError,
        ...warehouseStats,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST: Perform maintenance operations
export async function POST(request: Request) {
  try {
    const body = await request.json() as { action: string };
    const { action } = body;

    switch (action) {
      case 'checkpoint': {
        const db = getDatabase();
        db.checkpoint();
        return NextResponse.json({ success: true, message: 'WAL checkpointed to disk' });
      }
      case 'vacuum': {
        const db = getDatabase();
        db.vacuum();
        return NextResponse.json({ success: true, message: 'Database vacuumed' });
      }
      case 'prune_replay': {
        const db = getDatabase();
        const pruned = db.pruneReplayBuffer(5000);
        return NextResponse.json({ success: true, pruned, message: `Pruned ${pruned} old replay entries` });
      }
      case 'clear_warehouse': {
        const warehouse = await getDataWarehouse();
        warehouse.clearProxyData();
        return NextResponse.json({ success: true, message: 'Warehouse proxy data cleared' });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
