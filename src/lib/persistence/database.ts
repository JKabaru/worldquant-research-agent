// ============================================================
// SQLite Transactional Database - Hybrid Persistence Layer
// ============================================================
// Stores: alpha fingerprints, experience replay buffers,
// simulation logs, lineage data, generation stats, error logs.
//
// Performance tuning for high-throughput research logging:
//   PRAGMA journal_mode = WAL;        -- Write-Ahead Logging
//   PRAGMA synchronous = NORMAL;      -- Faster writes (safe with WAL)
//   PRAGMA temp_store = MEMORY;       -- Temp tables in RAM
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// --- Types ---

export interface FingerprintRow {
  id: string;
  fingerprint: string;
  expression: string;
  normalized_expression: string;
  category: string;
  style: string;
  sharpe: number | null;
  fitness: number | null;
  turnover: number | null;
  margin: number | null;
  status: 'accepted' | 'rejected' | 'simulating' | 'failed' | 'discarded';
  generation: number;
  strategy: string;
  parent_ids: string | null; // JSON array
  alpha_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExperienceReplayRow {
  id: string;
  expression: string;
  modification: string;
  old_metric: number;
  new_metric: number;
  strategy: string;
  improvement: number;
  td_error: number;
  priority: number;
  access_count: number;
  created_at: string;
}

export interface SimulationLogRow {
  id: string;
  candidate_id: string;
  expression: string;
  fingerprint: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  sharpe: number | null;
  fitness: number | null;
  turnover: number | null;
  margin: number | null;
  drawdown: number | null;
  long_count: number | null;
  short_count: number | null;
  pnl: number | null;
  volatility: number | null;
  checks: string | null; // JSON array
  error: string | null;
  submitted_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  generation: number;
}

export interface LineageRow {
  id: string;
  expression: string;
  fingerprint: string;
  parent_ids: string | null; // JSON array
  children_ids: string | null; // JSON array
  generation: number;
  strategy: string;
  sharpe: number | null;
  fitness: number | null;
  is_extinct: boolean;
  created_at: string;
}

export interface GenerationStatsRow {
  generation: number;
  total_candidates: number;
  successful: number;
  average_sharpe: number;
  average_fitness: number;
  best_sharpe: number;
  discovery_rate: number;
  diversity_score: number;
  dominant_category: string;
  timestamp: string;
  session_id: string;
}

export interface ErrorLogRow {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  message: string;
  expression: string | null;
  details: string | null;
  candidate_id: string | null;
}

export interface FeedbackRow {
  id: string;
  candidate_id: string;
  loop: 'inner' | 'middle' | 'outer';
  feedback: string;
  action: string;
  result: string;
  timestamp: string;
}

export interface ResearchSessionRow {
  id: string;
  status: string;
  config: string; // JSON
  total_simulations: number;
  successful_alphas: number;
  failed_simulations: number;
  current_generation: number;
  started_at: string;
  last_activity: string;
  ended_at: string | null;
}

export interface DatabaseStats {
  fingerprints: number;
  experienceReplay: number;
  simulationLogs: number;
  lineage: number;
  generationStats: number;
  errorLogs: number;
  feedbackEntries: number;
  researchTraces: number;
  memoryNodes: number;
  memoryEdges: number;
  retrievalTraces: number;
  researchSessions: number;
  databaseSizeBytes: number;
  walSizeBytes: number;
}

export interface ResearchTraceRow {
  id: string;
  session_id: string;
  generation: number;
  candidate_id: string | null;
  trace_type: string;
  message: string;
  payload: string | null;
  created_at: string;
}

export interface MemoryNodeRow {
  id: string;
  session_id: string;
  node_type: string;
  ref_id: string | null;
  content: string;
  metadata: string | null;
  created_at: string;
}

export interface MemoryEdgeRow {
  id: string;
  session_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  metadata: string | null;
  created_at: string;
}

export interface RetrievalTraceRow {
  id: string;
  session_id: string;
  generation: number;
  model_id: string | null;
  query_type: string;
  selected_node_ids: string | null;
  prompt_budget_tokens: number | null;
  created_at: string;
}

// --- Database Class ---

export class AlphaDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    const dataDir = path.join(process.cwd(), 'data');

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = dbPath || path.join(dataDir, 'alpha_factory.db');

    // Clean stale lock files from previous crash or improper shutdown
    const staleLocks = [this.dbPath + '-shm', this.dbPath + '-wal', this.dbPath + '-journal'];
    for (const lockPath of staleLocks) {
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
          console.log(`[Database] Removed stale lock: ${path.basename(lockPath)}`);
        } catch { /* ignore - another process may have it */ }
      }
    }

    // Open connection (creates file if not exists)
    this.db = new Database(this.dbPath);

    // === CRITICAL PERFORMANCE TUNING ===
    // Enable Write-Ahead Logging for faster concurrent writes
    this.db.pragma('journal_mode = WAL');

    // Reduce synchronous writes for speed (safe with WAL mode)
    // NORMAL is safe: fsyncs only the WAL file, not the data file on every commit
    this.db.pragma('synchronous = NORMAL');

    // Store temporary tables and indices in memory
    this.db.pragma('temp_store = MEMORY');

    // Increase cache size to 64MB (default is 2MB)
    this.db.pragma('cache_size = -65536');

    // Use cross-platform mutex for file locking
    this.db.pragma('locking_mode = NORMAL');

    // Enable auto-vacuum to reclaim space from deleted rows
    this.db.pragma('auto_vacuum = INCREMENTAL');

    // Initialize schema
    this.createSchema();

    // Prepare statements for high-throughput inserts
    this.prepareInsertStatements();
  }

  // --- Prepared Statements ---
  private insertFingerprintStmt: Database.Statement | null = null;
  private insertExperienceStmt: Database.Statement | null = null;
  private insertSimulationStmt: Database.Statement | null = null;
  private insertLineageStmt: Database.Statement | null = null;
  private insertGenStatsStmt: Database.Statement | null = null;
  private insertErrorLogStmt: Database.Statement | null = null;
  private insertFeedbackStmt: Database.Statement | null = null;
  private insertTraceStmt: Database.Statement | null = null;
  private insertMemoryNodeStmt: Database.Statement | null = null;
  private insertMemoryEdgeStmt: Database.Statement | null = null;
  private insertRetrievalTraceStmt: Database.Statement | null = null;

  private prepareInsertStatements(): void {
    this.insertFingerprintStmt = this.db.prepare(`
      INSERT OR REPLACE INTO alpha_fingerprints
        (id, fingerprint, expression, normalized_expression, category, style,
         sharpe, fitness, turnover, margin, status, generation, strategy,
         parent_ids, alpha_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertExperienceStmt = this.db.prepare(`
      INSERT INTO experience_replay
        (id, expression, modification, old_metric, new_metric, strategy,
         improvement, td_error, priority, access_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertSimulationStmt = this.db.prepare(`
      INSERT INTO simulation_logs
        (id, candidate_id, expression, fingerprint, status, sharpe, fitness,
         turnover, margin, drawdown, long_count, short_count, pnl, volatility,
         checks, error, submitted_at, completed_at, duration_ms, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertLineageStmt = this.db.prepare(`
      INSERT OR REPLACE INTO lineage_tree
        (id, expression, fingerprint, parent_ids, children_ids, generation,
         strategy, sharpe, fitness, is_extinct, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertGenStatsStmt = this.db.prepare(`
      INSERT OR REPLACE INTO generation_stats
        (generation, total_candidates, successful, average_sharpe, average_fitness,
         best_sharpe, discovery_rate, diversity_score, dominant_category, timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertErrorLogStmt = this.db.prepare(`
      INSERT INTO error_logs
        (id, timestamp, level, source, message, expression, details, candidate_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertFeedbackStmt = this.db.prepare(`
      INSERT INTO feedback_history
        (id, candidate_id, loop, feedback, action, result, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertTraceStmt = this.db.prepare(`
      INSERT INTO research_traces
        (id, session_id, generation, candidate_id, trace_type, message, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertMemoryNodeStmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory_nodes
        (id, session_id, node_type, ref_id, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertMemoryEdgeStmt = this.db.prepare(`
      INSERT INTO memory_edges
        (id, session_id, from_node_id, to_node_id, edge_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertRetrievalTraceStmt = this.db.prepare(`
      INSERT INTO retrieval_traces
        (id, session_id, generation, model_id, query_type, selected_node_ids, prompt_budget_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  // --- Schema Creation ---

  private createSchema(): void {
    this.db.exec(`
      -- Alpha Fingerprints: the canonical record of every alpha ever generated
      CREATE TABLE IF NOT EXISTS alpha_fingerprints (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        expression TEXT NOT NULL,
        normalized_expression TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Other',
        style TEXT NOT NULL DEFAULT 'momentum',
        sharpe REAL,
        fitness REAL,
        turnover REAL,
        margin REAL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('accepted','rejected','simulating','failed','discarded','pending')),
        generation INTEGER NOT NULL DEFAULT 0,
        strategy TEXT NOT NULL DEFAULT '',
        parent_ids TEXT,  -- JSON array of parent candidate IDs
        alpha_id TEXT,    -- WQ BRAIN alpha ID if submitted
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Index for fast duplicate fingerprint lookup
      CREATE INDEX IF NOT EXISTS idx_fingerprints_fp ON alpha_fingerprints(fingerprint);

      -- Index for category distribution queries
      CREATE INDEX IF NOT EXISTS idx_fingerprints_category ON alpha_fingerprints(category);

      -- Index for style distribution queries
      CREATE INDEX IF NOT EXISTS idx_fingerprints_style ON alpha_fingerprints(style);

      -- Index for status filtering
      CREATE INDEX IF NOT EXISTS idx_fingerprints_status ON alpha_fingerprints(status);

      -- Index for generation tracking
      CREATE INDEX IF NOT EXISTS idx_fingerprints_gen ON alpha_fingerprints(generation);

      -- Composite index for diversity queries (category + style)
      CREATE INDEX IF NOT EXISTS idx_fingerprints_cat_style ON alpha_fingerprints(category, style);


      -- Experience Replay Buffer: Karpathy-style learning from past actions
      CREATE TABLE IF NOT EXISTS experience_replay (
        id TEXT PRIMARY KEY,
        expression TEXT NOT NULL,
        modification TEXT NOT NULL DEFAULT 'none',
        old_metric REAL NOT NULL DEFAULT 0,
        new_metric REAL NOT NULL DEFAULT 0,
        strategy TEXT NOT NULL DEFAULT '',
        improvement REAL NOT NULL DEFAULT 0,
        td_error REAL NOT NULL DEFAULT 0,  -- TD-error for prioritized replay
        priority REAL NOT NULL DEFAULT 0,   -- Sampling priority (proportional to |td_error|)
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Index for priority-sorted sampling
      CREATE INDEX IF NOT EXISTS idx_replay_priority ON experience_replay(priority DESC);

      -- Index for strategy-filtered sampling
      CREATE INDEX IF NOT EXISTS idx_replay_strategy ON experience_replay(strategy);


      -- Simulation Logs: complete record of every simulation ever run
      CREATE TABLE IF NOT EXISTS simulation_logs (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        expression TEXT NOT NULL,
        fingerprint TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','failed')),
        sharpe REAL,
        fitness REAL,
        turnover REAL,
        margin REAL,
        drawdown REAL,
        long_count INTEGER,
        short_count INTEGER,
        pnl REAL,
        volatility REAL,
        checks TEXT,  -- JSON array of WQCheck
        error TEXT,
        submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        duration_ms INTEGER,
        generation INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_simlogs_status ON simulation_logs(status);
      CREATE INDEX IF NOT EXISTS idx_simlogs_gen ON simulation_logs(generation);
      CREATE INDEX IF NOT EXISTS idx_simlogs_sharpe ON simulation_logs(sharpe DESC);
      CREATE INDEX IF NOT EXISTS idx_simlogs_fp ON simulation_logs(fingerprint);


      -- Lineage Tree: tracks alpha ancestry for evolutionary tracking
      CREATE TABLE IF NOT EXISTS lineage_tree (
        id TEXT PRIMARY KEY,
        expression TEXT NOT NULL,
        fingerprint TEXT NOT NULL DEFAULT '',
        parent_ids TEXT,      -- JSON array
        children_ids TEXT,    -- JSON array
        generation INTEGER NOT NULL DEFAULT 0,
        strategy TEXT NOT NULL DEFAULT '',
        sharpe REAL,
        fitness REAL,
        is_extinct INTEGER NOT NULL DEFAULT 0,  -- boolean as integer
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_lineage_gen ON lineage_tree(generation);
      CREATE INDEX IF NOT EXISTS idx_lineage_extinct ON lineage_tree(is_extinct);


      -- Generation Stats: per-generation summary for outer loop analytics
      CREATE TABLE IF NOT EXISTS generation_stats (
        generation INTEGER NOT NULL,
        total_candidates INTEGER NOT NULL DEFAULT 0,
        successful INTEGER NOT NULL DEFAULT 0,
        average_sharpe REAL NOT NULL DEFAULT 0,
        average_fitness REAL NOT NULL DEFAULT 0,
        best_sharpe REAL NOT NULL DEFAULT 0,
        discovery_rate REAL NOT NULL DEFAULT 0,
        diversity_score REAL NOT NULL DEFAULT 0,
        dominant_category TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (generation, session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_genstats_session ON generation_stats(session_id);


      -- Error Logs: structured error history for learning and debugging
      CREATE TABLE IF NOT EXISTS error_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        level TEXT NOT NULL CHECK(level IN ('info','warning','error','critical')),
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        expression TEXT,
        details TEXT,
        candidate_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_errors_level ON error_logs(level);
      CREATE INDEX IF NOT EXISTS idx_errors_source ON error_logs(source);
      CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON error_logs(timestamp DESC);


      -- Feedback History: records from all three feedback loops
      CREATE TABLE IF NOT EXISTS feedback_history (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL DEFAULT '',
        loop TEXT NOT NULL CHECK(loop IN ('inner','middle','outer')),
        feedback TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_loop ON feedback_history(loop);
      CREATE INDEX IF NOT EXISTS idx_feedback_candidate ON feedback_history(candidate_id);

      -- Research Trace: transparent lifecycle records for candidate decisions and loop control
      CREATE TABLE IF NOT EXISTS research_traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        generation INTEGER NOT NULL DEFAULT 0,
        candidate_id TEXT,
        trace_type TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        payload TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_trace_session ON research_traces(session_id, generation);
      CREATE INDEX IF NOT EXISTS idx_trace_type ON research_traces(trace_type);
      CREATE INDEX IF NOT EXISTS idx_trace_candidate ON research_traces(candidate_id);

      -- Memory graph nodes for explicit learning structure
      CREATE TABLE IF NOT EXISTS memory_nodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        node_type TEXT NOT NULL DEFAULT '',
        ref_id TEXT,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_session ON memory_nodes(session_id, node_type);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_ref ON memory_nodes(ref_id);

      -- Memory graph edges for causal relationships
      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL DEFAULT '',
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memory_edges_session ON memory_edges(session_id, edge_type);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_from ON memory_edges(from_node_id);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON memory_edges(to_node_id);

      -- Retrieval traces for prompt transparency
      CREATE TABLE IF NOT EXISTS retrieval_traces (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        generation INTEGER NOT NULL DEFAULT 0,
        model_id TEXT,
        query_type TEXT NOT NULL DEFAULT '',
        selected_node_ids TEXT,
        prompt_budget_tokens INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_retrieval_traces_session ON retrieval_traces(session_id, generation);


      -- Research Sessions: track complete research runs
      CREATE TABLE IF NOT EXISTS research_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','paused','stopping','error','completed')),
        config TEXT NOT NULL DEFAULT '{}',  -- JSON
        total_simulations INTEGER NOT NULL DEFAULT 0,
        successful_alphas INTEGER NOT NULL DEFAULT 0,
        failed_simulations INTEGER NOT NULL DEFAULT 0,
        current_generation INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_activity TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        state_snapshot TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_status ON research_sessions(status);


      -- Provider Configs: persist user-configured LLM providers across restarts
      CREATE TABLE IF NOT EXISTS provider_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        provider_type TEXT NOT NULL DEFAULT 'custom',
        model_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_provider_configs_active ON provider_configs(is_active);


      -- Model Selections: persist selected model per provider
      CREATE TABLE IF NOT EXISTS model_selections (
        provider_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      
      -- Simulation Settings Config: persistent simulation config with region/universe/neutralization options
      CREATE TABLE IF NOT EXISTS simulation_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        version INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // ============================================================
  // Alpha Fingerprints Operations
  // ============================================================

  saveFingerprint(fp: Omit<FingerprintRow, 'created_at' | 'updated_at'>): void {
    this.insertFingerprintStmt!.run(
      fp.id, fp.fingerprint, fp.expression, fp.normalized_expression,
      fp.category, fp.style, fp.sharpe, fp.fitness, fp.turnover, fp.margin,
      fp.status, fp.generation, fp.strategy, fp.parent_ids, fp.alpha_id,
      new Date().toISOString(), new Date().toISOString()
    );
  }

  updateFingerprintStatus(id: string, status: FingerprintRow['status'], alphaId?: string): void {
    this.db.prepare(`
      UPDATE alpha_fingerprints SET status = ?, alpha_id = ?, updated_at = ? WHERE id = ?
    `).run(status, alphaId || null, new Date().toISOString(), id);
  }

  isDuplicateFingerprint(fingerprint: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM alpha_fingerprints WHERE fingerprint = ? LIMIT 1'
    ).get(fingerprint) as unknown | undefined;
    return row !== undefined;
  }

  getFingerprints(limit = 1000): FingerprintRow[] {
    return this.db.prepare(
      'SELECT * FROM alpha_fingerprints ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as FingerprintRow[];
  }

  getCategoryDistribution(): Record<string, number> {
    const rows = this.db.prepare(
      'SELECT category, COUNT(*) as count FROM alpha_fingerprints GROUP BY category'
    ).all() as Array<{ category: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.category] = row.count;
    }
    return result;
  }

  getStyleDistribution(): Record<string, number> {
    const rows = this.db.prepare(
      'SELECT style, COUNT(*) as count FROM alpha_fingerprints GROUP BY style'
    ).all() as Array<{ style: string; count: number }>;

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.style] = row.count;
    }
    return result;
  }

  getAcceptedExpressions(): Array<{ expression: string; fingerprint: string; category: string; style: string }> {
    return this.db.prepare(
      'SELECT expression, fingerprint, category, style FROM alpha_fingerprints WHERE status = ? ORDER BY created_at DESC'
    ).all('accepted') as Array<{ expression: string; fingerprint: string; category: string; style: string }>;
  }

  // ============================================================
  // Experience Replay Buffer Operations (TD-Error Prioritized)
  // ============================================================

  addToReplay(entry: Omit<ExperienceReplayRow, 'id' | 'created_at' | 'td_error' | 'priority' | 'access_count'>): void {
    // TD-error = |improvement| (how surprising this experience was)
    const tdError = Math.abs(entry.improvement);
    const priority = tdError + 0.01; // Small epsilon ensures new entries get sampled at least once

    this.insertExperienceStmt!.run(
      `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      entry.expression, entry.modification, entry.old_metric, entry.new_metric,
      entry.strategy, entry.improvement, tdError, priority, 0,
      new Date().toISOString()
    );
  }

  // TD-error prioritized sampling: higher priority = more likely to be sampled
  sampleReplayBuffer(count: number, strategy?: string): ExperienceReplayRow[] {
    if (strategy) {
      return this.db.prepare(`
        SELECT * FROM experience_replay
        WHERE strategy = ? OR strategy = ''
        ORDER BY priority DESC
        LIMIT ?
      `).all(strategy, count) as ExperienceReplayRow[];
    }

    return this.db.prepare(`
      SELECT * FROM experience_replay ORDER BY priority DESC LIMIT ?
    `).all(count) as ExperienceReplayRow[];
  }

  // Update TD-error after replay and adjust priority (decaying)
  updateReplayTDError(id: string, newImprovement: number): void {
    const newTDError = Math.abs(newImprovement);
    const decayFactor = 0.99; // Slightly decay priority to focus on recent learning
    this.db.prepare(`
      UPDATE experience_replay
      SET td_error = ?, priority = (? * ?), access_count = access_count + 1
      WHERE id = ?
    `).run(newTDError, newTDError + 0.01, decayFactor, id);
  }

  getReplayBufferStats(): { total: number; avgImprovement: number; avgTDError: number; strategies: Record<string, number> } {
    const stats = this.db.prepare(`
      SELECT COUNT(*) as total,
             AVG(improvement) as avg_improvement,
             AVG(td_error) as avg_td_error
      FROM experience_replay
    `).get() as { total: number; avg_improvement: number | null; avg_td_error: number | null };

    const strategyRows = this.db.prepare(
      'SELECT strategy, COUNT(*) as count FROM experience_replay GROUP BY strategy'
    ).all() as Array<{ strategy: string; count: number }>;

    const strategies: Record<string, number> = {};
    for (const row of strategyRows) {
      strategies[row.strategy] = row.count;
    }

    return {
      total: stats.total,
      avgImprovement: stats.avg_improvement || 0,
      avgTDError: stats.avg_td_error || 0,
      strategies,
    };
  }

  // Prune old low-priority entries to keep buffer manageable
  pruneReplayBuffer(maxSize: number = 5000): number {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM experience_replay').get() as { c: number }).c;
    if (count <= maxSize) return 0;

    const deleteCount = count - maxSize;
    this.db.prepare(`
      DELETE FROM experience_replay WHERE id IN (
        SELECT id FROM experience_replay ORDER BY priority ASC, access_count ASC LIMIT ?
      )
    `).run(deleteCount);

    return deleteCount;
  }

  // ============================================================
  // Simulation Logs Operations
  // ============================================================

  logSimulation(log: Omit<SimulationLogRow, 'id'>): string {
    const id = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.insertSimulationStmt!.run(
      id, log.candidate_id, log.expression, log.fingerprint, log.status,
      log.sharpe, log.fitness, log.turnover, log.margin,
      log.drawdown, log.long_count, log.short_count, log.pnl, log.volatility,
      log.checks, log.error, log.submitted_at, log.completed_at,
      log.duration_ms, log.generation
    );
    return id;
  }

  updateSimulationResult(id: string, result: {
    status: SimulationLogRow['status'];
    sharpe?: number;
    fitness?: number;
    turnover?: number;
    margin?: number;
    drawdown?: number;
    long_count?: number;
    short_count?: number;
    pnl?: number;
    volatility?: number;
    checks?: string;
    error?: string;
    completed_at?: string;
    duration_ms?: number;
  }): void {
    this.db.prepare(`
      UPDATE simulation_logs SET status = ?, sharpe = ?, fitness = ?, turnover = ?,
        margin = ?, drawdown = ?, long_count = ?, short_count = ?, pnl = ?,
        volatility = ?, checks = ?, error = ?, completed_at = ?, duration_ms = ?
      WHERE id = ?
    `).run(
      result.status, result.sharpe, result.fitness, result.turnover,
      result.margin, result.drawdown, result.long_count, result.short_count,
      result.pnl, result.volatility, result.checks, result.error,
      result.completed_at, result.duration_ms, id
    );
  }

  getSimulationHistory(limit = 100): SimulationLogRow[] {
    return this.db.prepare(
      'SELECT * FROM simulation_logs ORDER BY submitted_at DESC LIMIT ?'
    ).all(limit) as SimulationLogRow[];
  }

  getSuccessfulSimulations(limit = 50): SimulationLogRow[] {
    return this.db.prepare(
      'SELECT * FROM simulation_logs WHERE status = ? AND sharpe IS NOT NULL ORDER BY sharpe DESC LIMIT ?'
    ).all('complete', limit) as SimulationLogRow[];
  }

  getSimulationsByGeneration(generation: number): SimulationLogRow[] {
    return this.db.prepare(
      'SELECT * FROM simulation_logs WHERE generation = ? ORDER BY submitted_at'
    ).all(generation) as SimulationLogRow[];
  }

  // ============================================================
  // Gap 7: Alpha Performance History (Longitudinal Monitoring)
  // ============================================================

  /**
   * Query performance history for a given alpha fingerprint across generations.
   * Used by monitorAlphaHealth() to detect degradation > 20%.
   */
  getAlphaPerformanceHistory(fingerprint: string): Array<{ generation: number; sharpe: number; fitness: number }> {
    return this.db.prepare(`
      SELECT generation, sharpe, fitness
      FROM simulation_logs
      WHERE fingerprint = ? AND status = 'complete' AND sharpe IS NOT NULL
      ORDER BY generation ASC
    `).all(fingerprint) as Array<{ generation: number; sharpe: number; fitness: number }>;
  }

  // ============================================================
  // Lineage Tree Operations
  // ============================================================

  addLineageNode(node: Omit<LineageRow, 'created_at'>): void {
    this.insertLineageStmt!.run(
      node.id, node.expression, node.fingerprint, node.parent_ids,
      node.children_ids, node.generation, node.strategy,
      node.sharpe, node.fitness, node.is_extinct ? 1 : 0,
      new Date().toISOString()
    );
  }

  updateLineageChildren(parentId: string, childId: string): void {
    const row = this.db.prepare('SELECT children_ids FROM lineage_tree WHERE id = ?').get(parentId) as { children_ids: string | null } | undefined;
    let children: string[] = [];
    if (row?.children_ids) {
      try { children = JSON.parse(row.children_ids); } catch { children = []; }
    }
    if (!children.includes(childId)) {
      children.push(childId);
      this.db.prepare('UPDATE lineage_tree SET children_ids = ? WHERE id = ?').run(JSON.stringify(children), parentId);
    }
  }

  markExtinct(nodeId: string): void {
    this.db.prepare('UPDATE lineage_tree SET is_extinct = 1 WHERE id = ?').run(nodeId);
  }

  getLineageTree(maxDepth: number = 10): LineageRow[] {
    return this.db.prepare(
      'SELECT * FROM lineage_tree ORDER BY generation ASC LIMIT ?'
    ).all(maxDepth * 50) as LineageRow[];
  }

  getAncestorTrace(nodeId: string, maxGenerations: number = 10): LineageRow[] {
    // BFS to find all ancestors
    const result: LineageRow[] = [];
    const visited = new Set<string>();
    const queue: string[][] = [[nodeId]];
    let depth = 0;

    while (queue.length > 0 && depth < maxGenerations) {
      const currentIds = queue.shift() || [];
      const placeholders = currentIds.map(() => '?').join(',');
      const rows = this.db.prepare(
        `SELECT * FROM lineage_tree WHERE id IN (${placeholders}) AND is_extinct = 0`
      ).all(...currentIds) as LineageRow[];

      const nextIds: string[] = [];
      for (const row of rows) {
        if (!visited.has(row.id)) {
          visited.add(row.id);
          result.push(row);
          if (row.parent_ids) {
            try { nextIds.push(...JSON.parse(row.parent_ids)); } catch { /* ignore */ }
          }
        }
      }

      if (nextIds.length > 0) queue.push(nextIds);
      depth++;
    }

    return result;
  }

  // ============================================================
  // Generation Stats Operations
  // ============================================================

  saveGenerationStats(stats: Omit<GenerationStatsRow, 'timestamp'>): void {
    this.insertGenStatsStmt!.run(
      stats.generation, stats.total_candidates, stats.successful,
      stats.average_sharpe, stats.average_fitness, stats.best_sharpe,
      stats.discovery_rate, stats.diversity_score, stats.dominant_category,
      new Date().toISOString(), stats.session_id
    );
  }

  getGenerationStats(session?: string, limit = 50): GenerationStatsRow[] {
    if (session) {
      return this.db.prepare(
        'SELECT * FROM generation_stats WHERE session_id = ? ORDER BY generation DESC LIMIT ?'
      ).all(session, limit) as GenerationStatsRow[];
    }
    return this.db.prepare(
      'SELECT * FROM generation_stats ORDER BY generation DESC LIMIT ?'
    ).all(limit) as GenerationStatsRow[];
  }

  getRecentDiscoveryRate(window: number = 5): number {
    const rows = this.db.prepare(
      'SELECT discovery_rate FROM generation_stats ORDER BY generation DESC LIMIT ?'
    ).all(window) as Array<{ discovery_rate: number }>;

    if (rows.length === 0) return 0;
    return rows.reduce((s, r) => s + r.discovery_rate, 0) / rows.length;
  }

  // ============================================================
  // Error Log Operations
  // ============================================================

  logError(entry: Omit<ErrorLogRow, 'id' | 'timestamp'>): void {
    this.insertErrorLogStmt!.run(
      `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      new Date().toISOString(), entry.level, entry.source, entry.message,
      entry.expression, entry.details, entry.candidate_id
    );
  }

  getErrorLogs(limit = 50, source?: string): ErrorLogRow[] {
    if (source) {
      return this.db.prepare(
        'SELECT * FROM error_logs WHERE source = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(source, limit) as ErrorLogRow[];
    }
    return this.db.prepare(
      'SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as ErrorLogRow[];
  }

  getErrorFrequency(): Array<{ source: string; count: number; last_seen: string }> {
    return this.db.prepare(`
      SELECT source, COUNT(*) as count, MAX(timestamp) as last_seen
      FROM error_logs
      GROUP BY source
      ORDER BY count DESC
    `).all() as Array<{ source: string; count: number; last_seen: string }>;
  }

  // ============================================================
  // Feedback History Operations
  // ============================================================

  logFeedback(entry: Omit<FeedbackRow, 'id' | 'timestamp'>): void {
    this.insertFeedbackStmt!.run(
      `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      entry.candidate_id, entry.loop, entry.feedback, entry.action, entry.result,
      new Date().toISOString()
    );
  }

  logTrace(entry: Omit<ResearchTraceRow, 'id' | 'created_at'>): void {
    this.insertTraceStmt!.run(
      `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      entry.session_id,
      entry.generation,
      entry.candidate_id,
      entry.trace_type,
      entry.message,
      entry.payload,
      new Date().toISOString(),
    );
  }

  getResearchTraces(sessionId: string, limit: number = 200): ResearchTraceRow[] {
    return this.db.prepare(`
      SELECT * FROM research_traces
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit) as ResearchTraceRow[];
  }

  upsertMemoryNode(entry: Omit<MemoryNodeRow, 'created_at'>): void {
    this.insertMemoryNodeStmt!.run(
      entry.id,
      entry.session_id,
      entry.node_type,
      entry.ref_id,
      entry.content,
      entry.metadata,
      new Date().toISOString(),
    );
  }

  addMemoryEdge(entry: Omit<MemoryEdgeRow, 'id' | 'created_at'>): string {
    const id = `edge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.insertMemoryEdgeStmt!.run(
      id,
      entry.session_id,
      entry.from_node_id,
      entry.to_node_id,
      entry.edge_type,
      entry.metadata,
      new Date().toISOString(),
    );
    return id;
  }

  addRetrievalTrace(entry: Omit<RetrievalTraceRow, 'id' | 'created_at'>): string {
    const id = `rtrace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.insertRetrievalTraceStmt!.run(
      id,
      entry.session_id,
      entry.generation,
      entry.model_id,
      entry.query_type,
      entry.selected_node_ids,
      entry.prompt_budget_tokens,
      new Date().toISOString(),
    );
    return id;
  }

  getMemoryNodes(sessionId: string, limit: number = 200): MemoryNodeRow[] {
    return this.db.prepare(`
      SELECT * FROM memory_nodes
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit) as MemoryNodeRow[];
  }

  getMemoryEdges(sessionId: string, limit: number = 300): MemoryEdgeRow[] {
    return this.db.prepare(`
      SELECT * FROM memory_edges
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit) as MemoryEdgeRow[];
  }

  getRetrievalTraces(sessionId: string, limit: number = 200): RetrievalTraceRow[] {
    return this.db.prepare(`
      SELECT * FROM retrieval_traces
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit) as RetrievalTraceRow[];
  }

  getFeedbackHistory(loop?: string, limit = 50): FeedbackRow[] {
    if (loop) {
      return this.db.prepare(
        'SELECT * FROM feedback_history WHERE loop = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(loop, limit) as FeedbackRow[];
    }
    return this.db.prepare(
      'SELECT * FROM feedback_history ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as FeedbackRow[];
  }

  // ============================================================
  // Research Session Operations
  // ============================================================

  createSession(id: string, config: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO research_sessions (id, status, config, started_at, last_activity)
      VALUES (?, 'running', ?, datetime('now'), datetime('now'))
    `).run(id, JSON.stringify(config));
  }

  updateSessionActivity(id: string, status: string, stats: {
    totalSimulations: number;
    successfulAlphas: number;
    failedSimulations: number;
    currentGeneration: number;
  }): void {
    this.db.prepare(`
      UPDATE research_sessions
      SET status = ?, total_simulations = ?, successful_alphas = ?,
          failed_simulations = ?, current_generation = ?, last_activity = datetime('now'),
          ended_at = CASE WHEN ? IN ('completed', 'error') THEN datetime('now') ELSE ended_at END
      WHERE id = ?
    `).run(status, stats.totalSimulations, stats.successfulAlphas,
      stats.failedSimulations, stats.currentGeneration, status, id);
  }

  saveSessionSnapshot(id: string, snapshot: string): void {
    this.db.prepare(`
      UPDATE research_sessions SET state_snapshot = ? WHERE id = ?
    `).run(snapshot, id);
  }

  getSessionSnapshot(id: string): string | null {
    const row = this.db.prepare(
      'SELECT state_snapshot FROM research_sessions WHERE id = ?'
    ).get(id) as { state_snapshot: string } | undefined;
    return row?.state_snapshot || null;
  }

  getPausedSession(): ResearchSessionRow | null {
    return (this.db.prepare(
      "SELECT * FROM research_sessions WHERE status = 'paused' ORDER BY started_at DESC LIMIT 1"
    ).get() as ResearchSessionRow) || null;
  }

  getRunningSession(): ResearchSessionRow | null {
    return (this.db.prepare(
      "SELECT * FROM research_sessions WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
    ).get() as ResearchSessionRow) || null;
  }

  recoverCrashedSessions(): number {
    // Find sessions that were 'running' when server crashed
    const result = this.db.prepare(
      "UPDATE research_sessions SET status = 'paused' WHERE status = 'running'"
    ).run();
    return result.changes;
  }

  getLatestSession(): ResearchSessionRow | null {
    return (this.db.prepare(
      'SELECT * FROM research_sessions ORDER BY started_at DESC LIMIT 1'
    ).get() as ResearchSessionRow) || null;
  }

  getSessionCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM research_sessions').get() as { c: number }).c;
  }

  // ============================================================
  // Batch Operations (High-Throughput) ---

  saveBatchFingerprints(fingerprints: FingerprintRow[]): void {
    const transaction = this.db.transaction((fps: FingerprintRow[]) => {
      for (const fp of fps) {
        this.insertFingerprintStmt!.run(
          fp.id, fp.fingerprint, fp.expression, fp.normalized_expression,
          fp.category, fp.style, fp.sharpe, fp.fitness, fp.turnover, fp.margin,
          fp.status, fp.generation, fp.strategy, fp.parent_ids, fp.alpha_id,
          fp.created_at, fp.updated_at
        );
      }
    });
    transaction(fingerprints);
  }

  // ============================================================
  // Provider Config Operations (Gap 2)
  // ============================================================

  saveProviderConfig(provider: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    isActive: boolean;
    providerType?: string;
    modelId?: string;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO provider_configs (id, name, base_url, api_key, is_active, provider_type, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      provider.id,
      provider.name,
      provider.baseUrl,
      provider.apiKey,
      provider.isActive ? 1 : 0,
      provider.providerType || 'custom',
      provider.modelId || null,
      provider.createdAt,
    );
  }

  getAllProviderConfigs(): Array<{
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    isActive: boolean;
    providerType: string;
    modelId: string | null;
    createdAt: string;
  }> {
    const rows = this.db.prepare('SELECT * FROM provider_configs ORDER BY created_at ASC').all() as Array<{
      id: string;
      name: string;
      base_url: string;
      api_key: string;
      is_active: number;
      provider_type: string;
      model_id: string | null;
      created_at: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      isActive: row.is_active === 1,
      providerType: row.provider_type,
      modelId: row.model_id,
      createdAt: row.created_at,
    }));
  }

  deleteProviderConfig(id: string): boolean {
    const result = this.db.prepare('DELETE FROM provider_configs WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM model_selections WHERE provider_id = ?').run(id);
    return result.changes > 0;
  }

  setActiveProviderConfig(id: string): void {
    // Deactivate all first
    this.db.prepare('UPDATE provider_configs SET is_active = 0').run();
    // Activate the specified one
    this.db.prepare('UPDATE provider_configs SET is_active = 1 WHERE id = ?').run(id);
  }

  getActiveProviderConfig(): {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    isActive: boolean;
    providerType: string;
    modelId: string | null;
    createdAt: string;
  } | null {
    const row = this.db.prepare('SELECT * FROM provider_configs WHERE is_active = 1 LIMIT 1').get() as {
      id: string;
      name: string;
      base_url: string;
      api_key: string;
      is_active: number;
      provider_type: string;
      model_id: string | null;
      created_at: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      isActive: row.is_active === 1,
      providerType: row.provider_type,
      modelId: row.model_id,
      createdAt: row.created_at,
    };
  }

  saveModelSelection(providerId: string, modelId: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO model_selections (provider_id, model_id, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(providerId, modelId);
  }

  getModelSelection(providerId: string): string | null {
    const row = this.db.prepare('SELECT model_id FROM model_selections WHERE provider_id = ?').get(providerId) as { model_id: string } | undefined;
    return row?.model_id || null;
  }

  // ============================================================
  // Database Maintenance ---

  getStats(): DatabaseStats {
    const db = this.db;

    const fingerprints = (db.prepare('SELECT COUNT(*) as c FROM alpha_fingerprints').get() as { c: number }).c;
    const experienceReplay = (db.prepare('SELECT COUNT(*) as c FROM experience_replay').get() as { c: number }).c;
    const simulationLogs = (db.prepare('SELECT COUNT(*) as c FROM simulation_logs').get() as { c: number }).c;
    const lineage = (db.prepare('SELECT COUNT(*) as c FROM lineage_tree').get() as { c: number }).c;
    const generationStats = (db.prepare('SELECT COUNT(*) as c FROM generation_stats').get() as { c: number }).c;
    const errorLogs = (db.prepare('SELECT COUNT(*) as c FROM error_logs').get() as { c: number }).c;
    const feedbackEntries = (db.prepare('SELECT COUNT(*) as c FROM feedback_history').get() as { c: number }).c;
    const researchTraces = (db.prepare('SELECT COUNT(*) as c FROM research_traces').get() as { c: number }).c;
    const memoryNodes = (db.prepare('SELECT COUNT(*) as c FROM memory_nodes').get() as { c: number }).c;
    const memoryEdges = (db.prepare('SELECT COUNT(*) as c FROM memory_edges').get() as { c: number }).c;
    const retrievalTraces = (db.prepare('SELECT COUNT(*) as c FROM retrieval_traces').get() as { c: number }).c;
    const researchSessions = (db.prepare('SELECT COUNT(*) as c FROM research_sessions').get() as { c: number }).c;

    let databaseSizeBytes = 0;
    let walSizeBytes = 0;

    try {
      const dbStat = fs.statSync(this.dbPath);
      databaseSizeBytes = dbStat.size;
    } catch { /* ignore */ }

    try {
      const walPath = this.dbPath + '-wal';
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
    } catch { /* ignore */ }

    return {
      fingerprints,
      experienceReplay,
      simulationLogs,
      lineage,
      generationStats,
      errorLogs,
      feedbackEntries,
      researchTraces,
      memoryNodes,
      memoryEdges,
      retrievalTraces,
      researchSessions,
      databaseSizeBytes,
      walSizeBytes,
    };
  }

  vacuum(): void {
    this.db.exec('PRAGMA incremental_vacuum');
  }

  // ============================================================
  // Simulation Settings Config — persisted simulation options
  // ============================================================

  getSimulationConfig(): { version: number; config_json: string; updated_at: string } | null {
    try {
      const row = this.db.prepare(
        'SELECT version, config_json, updated_at FROM simulation_config WHERE id = 1'
      ).get() as { version: number; config_json: string; updated_at: string } | undefined;
      return row || null;
    } catch {
      return null;
    }
  }

  saveSimulationConfig(configJson: string, version = 1): void {
    this.db.prepare(`
      INSERT INTO simulation_config (id, version, config_json, updated_at)
      VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(version, configJson);
  }

  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  clearAllData(): void {
    const transaction = this.db.transaction(() => {
      this.db.exec('DELETE FROM alpha_fingerprints');
      this.db.exec('DELETE FROM experience_replay');
      this.db.exec('DELETE FROM lineage_data');
      this.db.exec('DELETE FROM simulation_logs');
      this.db.exec('DELETE FROM research_sessions');
      this.db.exec('DELETE FROM research_traces');
      this.db.exec('DELETE FROM memory_nodes');
      this.db.exec('DELETE FROM memory_edges');
      this.db.exec('DELETE FROM retrieval_traces');
      this.db.exec('DELETE FROM error_logs');
      this.db.exec('DELETE FROM feedback_entries');
      this.db.exec('DELETE FROM generation_stats');
    });
    transaction();
  }

  close(): void {
    this.checkpoint();
    this.db.close();
  }
}

// Singleton
let dbInstance: AlphaDatabase | null = null;

export function getDatabase(): AlphaDatabase {
  if (!dbInstance) {
    dbInstance = new AlphaDatabase();
  }
  return dbInstance;
}

// Graceful shutdown - release locks on server exit
function cleanup(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
      console.log('[Database] Closed on shutdown');
    } catch (e) {
      console.warn('[Database] Close error:', e);
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  process.on('beforeExit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
