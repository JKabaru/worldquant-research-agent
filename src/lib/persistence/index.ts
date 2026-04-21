// ============================================================
// Hybrid Persistence Layer - Exports
// ============================================================
// SQLite: Transactional database for fingerprints, replay, logs, lineage
// DuckDB: Analytical warehouse for proxy data, PCA, correlations
// ============================================================

export { AlphaDatabase, getDatabase } from './database';
export type {
  FingerprintRow,
  ExperienceReplayRow,
  SimulationLogRow,
  LineageRow,
  GenerationStatsRow,
  ErrorLogRow,
  FeedbackRow,
  ResearchSessionRow,
  DatabaseStats,
} from './database';

export { DataWarehouse, getDataWarehouse } from './data-warehouse';
export type {
  ProxyPriceRow,
  FundamentalRow,
  ProxyReturnSeries,
  CorrelationResult,
  AutoCorrelationResult,
  WarehouseStats,
} from './data-warehouse';
