// ============================================================
// Research Engine - Core orchestrator with multi-timescale loops
// Hybrid Persistence: SQLite (transactional) + DuckDB/Parquet (analytical)
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  ResearchConfig, ResearchState, AlphaCandidate, SimulationRecord,
  ResearchError, FeedbackRecord, ExperienceTuple, LineageNode,
  GenerationStats, WQAlpha, WQSimulationResult, LossComponents,
  InnerLoopResult, MiddleLoopResult, OuterLoopResult, StylePremia, MacroRegime, RewardBreakdown,
} from './types';
import { getAllProviders, getProvider, getProviderClient } from './provider';
import { getWQClient } from './wq-client';
import { AlphaValidator } from './validator';
import { DiversityManager } from './diversity';
import {
  ALPHA_QUALITY_THRESHOLDS,
  STYLE_PREMIA_CONFIG,
} from './constants';
import { getDatabase, type DatabaseStats } from './persistence/database';
import { getDataWarehouse } from './persistence/data-warehouse';
import { eventBridge } from './event-bridge';
import { formatSourceContextForPrompt, getConfiguredSourcePaths } from './source-memory';

export type ResearchEventCallback = (event: {
  type: 'status' | 'alpha_generated' | 'simulation_submitted' | 'simulation_complete' |
        'alpha_accepted' | 'alpha_rejected' | 'error' | 'generation_complete' |
        'correction' | 'diversity_check' | 'style_rotation' | 'critique_resubmit' |
        'hypothesis_generated' | 'mutation_spike';
  data: unknown;
}) => void;

export class ResearchEngine {
  private state: ResearchState;
  private validator: AlphaValidator;
  private diversityManager: DiversityManager;
  private eventCallback: ResearchEventCallback | null = null;
  private abortController: AbortController | null = null;
  private simulationCounter: { count: number; date: string } = { count: 0, date: '' };
  // Persistence layer references (initialized on demand)
  private dbInitialized = false;
  private warehouseInitialized = false;
  // Gap 7: Tracks acceptance metrics (sharpe, fitness) when an alpha is first accepted,
  // used by monitorAlphaHealth() to detect degradation.
  private acceptanceMetrics: Map<string, { sharpe: number; fitness: number }> = new Map();
  // Reward history by generation for quality progression tracking.
  private rewardHistory: Array<{ generation: number; candidateId: string; reward: RewardBreakdown }> = [];
  private memoryNodeByCandidate: Map<string, string> = new Map();
  private traceBuffer: Array<{
    id: string;
    sessionId: string;
    generation: number;
    candidateId: string | null;
    traceType: string;
    message: string;
    payload?: Record<string, unknown>;
    timestamp: string;
  }> = [];

  constructor() {
    this.validator = new AlphaValidator();
    this.diversityManager = new DiversityManager();
    this.state = this.createInitialState();
  }

  /**
   * Initialize SQLite database and restore saved state.
   * Called once on server startup or when research starts.
   */
  async initializePersistence(): Promise<void> {
    if (this.dbInitialized) return;
    try {
      const db = getDatabase();
      this.restoreFingerprintsFromDB(db);
      this.restoreExperienceFromDB(db);

      // Gap 5: Auto-recover crashed sessions (server died while running)
      const recovered = db.recoverCrashedSessions();
      if (recovered > 0) {
        console.log(`[ResearchEngine] Recovered ${recovered} crashed session(s) as paused`);
      }

      this.dbInitialized = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[ResearchEngine] SQLite init failed (running in-memory): ${msg}`);
    }
    try {
      await getDataWarehouse();
      this.warehouseInitialized = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[ResearchEngine] DuckDB init failed (analytical features degraded): ${msg}`);
    }
  }

  /**
   * Get persistence statistics for the UI.
   */
  getPersistenceStats(): { database: DatabaseStats | null; warehouseAvailable: boolean } {
    let database: DatabaseStats | null = null;
    if (this.dbInitialized) {
      try { database = getDatabase().getStats(); } catch { /* ignore */ }
    }
    return { database, warehouseAvailable: this.warehouseInitialized };
  }

  private createInitialState(): ResearchState {
    return {
      id: uuidv4(),
      status: 'idle',
      config: null,
      currentGeneration: 0,
      totalSimulations: 0,
      successfulAlphas: 0,
      failedSimulations: 0,
      startTime: null,
      lastActivity: null,
      livingAlphas: [],
      candidateQueue: [],
      simulationHistory: [],
      errorLog: [],
      diversityMetrics: null,
      feedbackHistory: [],
      experienceBuffer: [],
      lineageTree: null,
      generationStats: [],
      // Gap 3: Default dynamic weights (base architecture weights)
      dynamicWeights: { sharpe: 2.0, fitness: 1.5, turnover: 1.0, correlation: 0.8 },
      // Gap 4: Queue for polished/corrected expressions awaiting re-simulation
      polishQueue: [],
      // Gap 5: Health history for anti-deadlock tracking
      healthHistory: [],
      // Gap 5: Mutation spike remaining generations (0 = no spike active)
      mutationSpikeRemaining: 0,
      // Gap 7: Counter for degraded alphas removed from living library
      degradedAlphas: 0,
      // Gap 8: Inferred macro regime for style timing adjustments
      macroRegime: { inflation: 'normal', growth: 'normal', volatility: 'normal' },
      // Current processing state (exposed for UI display)
      currentHypothesis: null,
      currentExpression: null,
    };
  }

  // --- Persistence: Restore from SQLite on Startup ---

  private restoreFingerprintsFromDB(db: ReturnType<typeof getDatabase>): void {
    try {
      const accepted = db.getAcceptedExpressions();
      for (const row of accepted) {
        this.diversityManager.addFingerprint(row.fingerprint, row.expression, row.category, row.style as StylePremia);
      }
      if (accepted.length > 0) {
        this.state.diversityMetrics = this.diversityManager.getMetrics();
      }
    } catch { /* non-fatal */ }
  }

  private restoreExperienceFromDB(db: ReturnType<typeof getDatabase>): void {
    try {
      const topEntries = db.sampleReplayBuffer(100);
      this.state.experienceBuffer = topEntries.map(e => ({
        expression: e.expression,
        modification: e.modification,
        oldMetric: e.old_metric,
        newMetric: e.new_metric,
        strategy: e.strategy,
        timestamp: e.created_at,
        improvement: e.improvement,
      }));
    } catch { /* non-fatal */ }
  }

  onEvent(callback: ResearchEventCallback): void {
    this.eventCallback = callback;
  }

  private emit(event: Parameters<ResearchEventCallback>[0]): void {
    this.eventCallback?.(event);
    // Gap 4: Also emit to SSE event bridge for real-time UI updates
    eventBridge.emit(event.type, event);
  }

  private logTrace(
    traceType: string,
    message: string,
    candidateId: string | null = null,
    payload?: Record<string, unknown>
  ): void {
    const entry = {
      id: uuidv4(),
      sessionId: this.state.id,
      generation: this.state.currentGeneration,
      candidateId,
      traceType,
      message,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.traceBuffer.push(entry);
    if (this.traceBuffer.length > 5000) this.traceBuffer = this.traceBuffer.slice(-2000);
    if (this.dbInitialized) {
      try {
        getDatabase().logTrace({
          session_id: entry.sessionId,
          generation: entry.generation,
          candidate_id: entry.candidateId,
          trace_type: entry.traceType,
          message: entry.message,
          payload: entry.payload ? JSON.stringify(entry.payload) : null,
        });
      } catch { /* non-fatal */ }
    }
  }

  private upsertMemoryNode(
    nodeId: string,
    nodeType: string,
    content: string,
    refId: string | null = null,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.dbInitialized) return;
    try {
      getDatabase().upsertMemoryNode({
        id: nodeId,
        session_id: this.state.id,
        node_type: nodeType,
        ref_id: refId,
        content,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });
    } catch { /* non-fatal */ }
  }

  private addMemoryEdge(fromNodeId: string, toNodeId: string, edgeType: string, metadata?: Record<string, unknown>): void {
    if (!this.dbInitialized) return;
    try {
      getDatabase().addMemoryEdge({
        session_id: this.state.id,
        from_node_id: fromNodeId,
        to_node_id: toNodeId,
        edge_type: edgeType,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });
    } catch { /* non-fatal */ }
  }

  private addRetrievalTrace(queryType: string, selectedNodeIds: string[], promptBudgetTokens: number): void {
    if (!this.dbInitialized) return;
    try {
      getDatabase().addRetrievalTrace({
        session_id: this.state.id,
        generation: this.state.currentGeneration,
        model_id: this.state.config?.modelId || null,
        query_type: queryType,
        selected_node_ids: JSON.stringify(selectedNodeIds),
        prompt_budget_tokens: promptBudgetTokens,
      });
    } catch { /* non-fatal */ }
  }

  getState(): ResearchState {
    return { ...this.state };
  }

  getStatus(): string {
    return this.state.status;
  }

  getRecentTraces(limit: number = 200): Array<{
    id: string;
    sessionId: string;
    generation: number;
    candidateId: string | null;
    traceType: string;
    message: string;
    payload?: Record<string, unknown>;
    timestamp: string;
  }> {
    return this.traceBuffer.slice(-Math.max(1, limit));
  }

  // --- Configuration ---

  configure(config: ResearchConfig): void {
    const normalizedConfig: ResearchConfig = { ...config };
    if (normalizedConfig.freeTierMode) {
      normalizedConfig.populationSize = Math.min(normalizedConfig.populationSize || 5, 4);
      normalizedConfig.maxConcurrentSimulations = Math.min(normalizedConfig.maxConcurrentSimulations || 3, 2);
      normalizedConfig.maxDailySimulations = Math.min(normalizedConfig.maxDailySimulations || 100, 60);
    }
    this.state.config = normalizedConfig;
    this.state.id = uuidv4();
    this.state.errorLog = [];
    this.state.feedbackHistory = [];
    this.state.generationStats = [];
    this.traceBuffer = [];
    this.memoryNodeByCandidate.clear();
    if (typeof normalizedConfig.strictCorrelationThreshold === 'number') {
      this.diversityManager.setMaxCorrelation(normalizedConfig.strictCorrelationThreshold);
    }
  }

  // --- Start Research ---

  async start(): Promise<void> {
    if (!this.state.config) throw new Error('Research not configured');

    const wqClient = getWQClient();
    if (!(await wqClient.ensureAuthenticated())) throw new Error('Not authenticated with WorldQuant BRAIN');
    this.ensureProviderConnected();

    // Ensure persistence is initialized
    await this.initializePersistence();

    this.state = { ...this.createInitialState(), config: this.state.config };
    this.state.status = 'running';
    this.state.startTime = new Date().toISOString();
    this.state.lastActivity = new Date().toISOString();
    this.abortController = new AbortController();
    this.simulationCounter = { count: 0, date: new Date().toISOString().split('T')[0] };

    // Create research session in SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().createSession(this.state.id, this.state.config as unknown as Record<string, unknown>);
      } catch { /* non-fatal */ }
    }

    // Fetch existing alphas for correlation baseline
    await this.loadExistingAlphas();
    if (!this.diversityManager.hasSubmittedBaseline()) {
      this.state.status = 'error';
      throw new Error('Submitted-alpha baseline is required but unavailable; refusing to run to prevent correlation leakage');
    }

    this.emit({ type: 'status', data: { status: 'running', message: 'Research engine started' } });

    // Start the research loop
    this.runResearchLoop().catch(error => {
      this.state.status = 'error';
      this.logError('outer_loop', 'Research loop crashed', undefined, error instanceof Error ? error.message : String(error));
      this.emit({ type: 'error', data: { message: 'Research loop crashed', error: String(error) } });
      // Persist session end
      if (this.dbInitialized) {
        try {
          getDatabase().updateSessionActivity(this.state.id, 'error', {
            totalSimulations: this.state.totalSimulations,
            successfulAlphas: this.state.successfulAlphas,
            failedSimulations: this.state.failedSimulations,
            currentGeneration: this.state.currentGeneration,
          });
        } catch { /* non-fatal */ }
      }
    });
  }

  stop(): void {
    this.state.status = 'stopping';
    this.abortController?.abort();
    this.state.lastActivity = new Date().toISOString();

    // Persist session end state
    if (this.dbInitialized) {
      try {
        getDatabase().updateSessionActivity(this.state.id, 'stopped', {
          totalSimulations: this.state.totalSimulations,
          successfulAlphas: this.state.successfulAlphas,
          failedSimulations: this.state.failedSimulations,
          currentGeneration: this.state.currentGeneration,
        });
        // Clear paused session state
        getDatabase().saveSessionSnapshot(this.state.id, '');
      } catch { /* non-fatal */ }
    }

    this.emit({ type: 'status', data: { status: 'stopping', message: 'Research engine stopping...' } });
  }

  // --- Pause Research (Gap 5) ---

  pause(): void {
    if (this.state.status !== 'running') return;
    this.state.status = 'paused';
    this.state.lastActivity = new Date().toISOString();

    // Persist full state to SQLite for resume
    this.persistResearchState();

    this.emit({ type: 'status', data: { status: 'paused', message: 'Research paused' } });
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') return;

    // Try to restore from DB if state was lost
    if (this.state.currentGeneration === 0) {
      await this.restoreResearchState();
    }

    this.state.status = 'running';
    this.abortController = new AbortController();

    this.emit({ type: 'status', data: { status: 'running', message: 'Research resumed' } });

    // Update session status in SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().updateSessionActivity(this.state.id, 'running', {
          totalSimulations: this.state.totalSimulations,
          successfulAlphas: this.state.successfulAlphas,
          failedSimulations: this.state.failedSimulations,
          currentGeneration: this.state.currentGeneration,
        });
      } catch { /* non-fatal */ }
    }

    // Continue the research loop from where we left off
    if (!this.diversityManager.hasSubmittedBaseline()) {
      this.state.status = 'error';
      throw new Error('Submitted-alpha baseline missing on resume; refusing to continue');
    }
    this.runResearchLoop().catch(error => {
      this.state.status = 'error';
      this.logError('outer_loop', 'Research loop crashed after resume', undefined, error instanceof Error ? error.message : String(error));
    });
  }

  getPausedState(): boolean {
    return this.state.status === 'paused';
  }

  private persistResearchState(): void {
    if (!this.dbInitialized) return;
    try {
      const snapshot = JSON.stringify({
        currentGeneration: this.state.currentGeneration,
        totalSimulations: this.state.totalSimulations,
        successfulAlphas: this.state.successfulAlphas,
        failedSimulations: this.state.failedSimulations,
        dynamicWeights: this.state.dynamicWeights,
        mutationSpikeRemaining: this.state.mutationSpikeRemaining,
        degradedAlphas: this.state.degradedAlphas,
        macroRegime: this.state.macroRegime,
        livingAlphasCount: this.state.livingAlphas.length,
        config: this.state.config,
      });
      getDatabase().updateSessionActivity(this.state.id, 'paused', {
        totalSimulations: this.state.totalSimulations,
        successfulAlphas: this.state.successfulAlphas,
        failedSimulations: this.state.failedSimulations,
        currentGeneration: this.state.currentGeneration,
      });
      getDatabase().saveSessionSnapshot(this.state.id, snapshot);
    } catch { /* non-fatal */ }
  }

  private async restoreResearchState(): Promise<void> {
    if (!this.dbInitialized) return;
    try {
      const db = getDatabase();
      const session = db.getPausedSession();
      if (!session) return;

      const snapshot = db.getSessionSnapshot(session.id);
      if (!snapshot) return;

      const state = JSON.parse(snapshot);
      this.state.id = session.id;
      this.state.currentGeneration = state.currentGeneration || 0;
      this.state.totalSimulations = state.totalSimulations || 0;
      this.state.successfulAlphas = state.successfulAlphas || 0;
      this.state.failedSimulations = state.failedSimulations || 0;
      this.state.dynamicWeights = state.dynamicWeights || { sharpe: 2.0, fitness: 1.5, turnover: 1.0, correlation: 0.8 };
      this.state.mutationSpikeRemaining = state.mutationSpikeRemaining || 0;
      this.state.degradedAlphas = state.degradedAlphas || 0;
      this.state.macroRegime = state.macroRegime || { inflation: 'normal', growth: 'normal', volatility: 'normal' };
      this.state.config = state.config || this.state.config;

      // Restore fingerprints from DB
      this.restoreFingerprintsFromDB(db);

      // Reload existing alphas for correlation baseline
      await this.loadExistingAlphas();

      // Restore generation stats from DB (with deduplication by generation number)
      const genStats = db.getGenerationStats(session.id);
      const seenGenerations = new Set<number>();
      this.state.generationStats = genStats
        .filter(g => {
          if (seenGenerations.has(g.generation)) return false;
          seenGenerations.add(g.generation);
          return true;
        })
        .map(g => ({
        generation: g.generation,
        totalCandidates: g.total_candidates,
        successful: g.successful,
        averageSharpe: g.average_sharpe,
        averageFitness: g.average_fitness,
        bestSharpe: g.best_sharpe,
        discoveryRate: g.discovery_rate,
        diversityScore: g.diversity_score,
        dominantCategory: g.dominant_category,
        timestamp: g.timestamp,
      }));

      console.log(`[ResearchEngine] Restored paused session: gen ${this.state.currentGeneration}, ${this.state.successfulAlphas} alphas`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[ResearchEngine] Failed to restore research state: ${msg}`);
    }
  }

  // --- Main Research Loop (Outer Loop) ---

  private async runResearchLoop(): Promise<void> {
    const config = this.state.config!;
    const maxGen = config.maxGenerations || 100;

    while (this.state.currentGeneration < maxGen && this.state.status === 'running') {
      if (this.abortController?.signal.aborted) break;

      this.state.currentGeneration++;
      this.state.lastActivity = new Date().toISOString();

      let genSuccessful = 0;
      let genTotal = 0;
      let genSharpeSum = 0;
      let genFitnessSum = 0;
      let genBestSharpe = 0;
      let genRewardSum = 0;
      let genBestReward = Number.NEGATIVE_INFINITY;

      this.emit({
        type: 'status',
        data: {
          status: 'running',
          generation: this.state.currentGeneration,
          message: `Starting generation ${this.state.currentGeneration}`,
        },
      });
      this.logTrace('generation_start', `Starting generation ${this.state.currentGeneration}`, null, {
        generation: this.state.currentGeneration,
      });

      // Gap 7: Monitor living alpha health at start of each generation
      this.monitorAlphaHealth();

       // Gap 8: Update macro regime inference every 10 generations
       if (this.state.currentGeneration % 10 === 0) {
         this.updateMacroRegime();
       }

       // Refresh correlation baseline from WQ API every 100 generations
       if (this.state.currentGeneration > 1 && this.state.currentGeneration % 100 === 0) {
         await this.refreshCorrelationBaseline();
         this.emit({
           type: 'status',
           data: { message: `Correlation baseline refreshed (generation ${this.state.currentGeneration})` },
         });
       }

       // Outer Loop: Strategy selection and style rotation
       const outerResult = this.executeOuterLoop();

      // Quality-gated generation: generate many -> rank -> simulate few
      const simulationTarget = Math.min(config.populationSize || 5, 10);
      const generationMultiplier = Math.min(
        8,
        Math.max(1, config.generationMultiplier || (config.freeTierMode ? 3 : 4))
      );
      const rawBatchSize = Math.min(
        Math.max((config.populationSize || 5) * generationMultiplier, simulationTarget),
        40
      );
      const rawCandidates = await this.generateCandidates(rawBatchSize, outerResult);
      for (const c of rawCandidates) {
        const nodeId = `candidate_${c.id}`;
        this.memoryNodeByCandidate.set(c.id, nodeId);
        this.upsertMemoryNode(nodeId, 'expression', this.diversityManager.extractPatternSignature(c.expression), c.id, {
          strategy: c.strategy,
          generation: c.generation,
        });
      }
      const candidates = this.rankCandidatesForSimulation(rawCandidates, outerResult, simulationTarget);
      this.emit({
        type: 'status',
        data: {
          message: `Quality ranker: generated ${rawCandidates.length}, shortlisted ${candidates.length}, target simulations ${simulationTarget}`,
          generation: this.state.currentGeneration,
        },
      });
      this.logTrace('quality_shortlist', 'Quality ranker shortlisted candidates', null, {
        generated: rawCandidates.length,
        shortlisted: candidates.length,
        simulationTarget,
      });
      this.addRetrievalTrace('quality_rank_shortlist', candidates.map(c => `candidate_${c.id}`), 400);

      // Gap 9: Concurrent simulation batch processing
      // Filter candidates through validation + diversity first, then batch simulate
      const validCandidates: AlphaCandidate[] = [];
      for (const candidate of candidates) {
        if (this.abortController?.signal.aborted || this.state.status !== 'running') break;
        if (validCandidates.length >= simulationTarget) break;
        genTotal++;

        // Inner Loop: Validate expression
        const validationResult = this.executeInnerLoop(candidate);
        if (!validationResult.isValid) {
          this.handleValidationFailure(candidate, validationResult);
          this.logTrace('validation_failed', 'Inner-loop validation failed', candidate.id, {
            errors: validationResult.errors,
          });
          const candidateNode = this.memoryNodeByCandidate.get(candidate.id);
          if (candidateNode) {
            const errorNode = `validation_${candidate.id}_${Date.now()}`;
            this.upsertMemoryNode(errorNode, 'validation_error', validationResult.errors.join('; '), candidate.id, {
              generation: this.state.currentGeneration,
            });
            this.addMemoryEdge(candidateNode, errorNode, 'failed_with');
          }
          const reward = this.computeRewardFromFailure(candidate, 'syntax_failure');
          genRewardSum += reward.totalReward;
          genBestReward = Math.max(genBestReward, reward.totalReward);
          continue;
        }

        // Diversity Check — Layer 1: basic (fingerprint, semantic, category, style)
        const basicDiversity = this.diversityManager.evaluateCandidate(candidate);
        if (!basicDiversity.accepted) {
          this.emit({
            type: 'diversity_check',
            data: { candidateId: candidate.id, accepted: false, reasons: basicDiversity.reasons },
          });
          this.state.candidateQueue.push({ ...candidate, status: 'discarded' });
          this.logTrace('diversity_rejected', 'Candidate rejected by base diversity', candidate.id, {
            reasons: basicDiversity.reasons,
          });
          const candidateNode = this.memoryNodeByCandidate.get(candidate.id);
          if (candidateNode) {
            const rejectNode = `diversity_${candidate.id}_${Date.now()}`;
            this.upsertMemoryNode(rejectNode, 'correlation_rejection', basicDiversity.reasons.join('; '), candidate.id, {
              generation: this.state.currentGeneration,
              layer: 'base',
            });
            this.addMemoryEdge(candidateNode, rejectNode, 'rejected_by_diversity');
          }
          const reward = this.computeRewardFromFailure(candidate, 'diversity_rejection');
          genRewardSum += reward.totalReward;
          genBestReward = Math.max(genBestReward, reward.totalReward);
          continue;
        }

        // Diversity Check — Layer 2: portfolio correlation against submitted alphas
        let correlationResult: {
          accepted: boolean;
          reasons: string[];
          pcaCoverage: number;
          pcaRecommendation: string;
          topMatches: Array<{ clusterId: string; similarity: number }>;
        } | null = null;
        try {
          correlationResult = await this.diversityManager.evaluateCandidateWithPCA(candidate);
        } catch (e) {
          // Correlation check failed (should not happen); log and accept candidate
          const msg = e instanceof Error ? e.message : String(e);
          this.logError('diversity', 'Correlation check failed', candidate.expression, msg);
          // In degraded mode, accept without correlation enforcement
          correlationResult = {
            accepted: true,
            reasons: [],
            pcaCoverage: 0,
            pcaRecommendation: 'Correlation check unavailable',
            topMatches: [],
          };
        }

        if (correlationResult && !correlationResult.accepted) {
          this.emit({
            type: 'diversity_check',
            data: {
              candidateId: candidate.id,
              accepted: false,
              reasons: [...basicDiversity.reasons, ...correlationResult.reasons],
              correlation: correlationResult.pcaCoverage,
              recommendation: correlationResult.pcaRecommendation,
            },
          });
          this.state.candidateQueue.push({ ...candidate, status: 'discarded' });
          this.logTrace('correlation_rejected', 'Candidate rejected by submitted-alpha similarity', candidate.id, {
            reasons: correlationResult.reasons,
            pcaCoverage: correlationResult.pcaCoverage,
            topMatches: correlationResult.topMatches,
          });
          const candidateNode = this.memoryNodeByCandidate.get(candidate.id);
          if (candidateNode) {
            const rejectNode = `corr_${candidate.id}_${Date.now()}`;
            this.upsertMemoryNode(rejectNode, 'correlation_rejection', correlationResult.reasons.join('; '), candidate.id, {
              pcaCoverage: correlationResult.pcaCoverage,
              topMatches: correlationResult.topMatches,
            });
            this.addMemoryEdge(candidateNode, rejectNode, 'rejected_by_correlation');
          }

          // Record correlation rejection for LLM feedback (rolling summary)
          this.diversityManager.recordCorrelationRejection(candidate, correlationResult);
          const reward = this.computeRewardFromFailure(candidate, 'diversity_rejection');
          genRewardSum += reward.totalReward;
          genBestReward = Math.max(genBestReward, reward.totalReward);
          continue;
        }

        // Check daily simulation limit
        if (!this.checkSimulationBudget(config.maxDailySimulations)) break;

        validCandidates.push(candidate);
      }

      // Submit simulations in concurrent batches respecting maxConcurrentSimulations
      const concurrencyLimit = config.maxConcurrentSimulations || 3;
      for (let i = 0; i < validCandidates.length; i += concurrencyLimit) {
        if (this.abortController?.signal.aborted || this.state.status !== 'running') break;

        const batch = validCandidates.slice(i, i + concurrencyLimit);

        // Stagger submissions within a batch by 2 seconds each
        const submitPromises = batch.map((candidate, idx) =>
          new Promise<{ candidate: AlphaCandidate; result: WQSimulationResult | null }>((resolve) => {
            setTimeout(async () => {
              if (this.abortController?.signal.aborted || this.state.status !== 'running') {
                resolve({ candidate, result: null });
                return;
              }
              const result = await this.submitSimulation(candidate);
              resolve({ candidate, result });
            }, idx * 2000); // 2-second stagger within batch
          })
        );

        const batchResults = await Promise.allSettled(submitPromises);

        for (const settled of batchResults) {
          if (settled.status !== 'fulfilled') continue;
          const { candidate, result } = settled.value;

          if (!result || result.status === 'FAILED' || result.status === 'ERROR') {
            this.handleSimulationFailure(candidate, result);
            this.logTrace('simulation_failed', 'Simulation failed or errored', candidate.id, {
              error: result?.error || 'unknown',
            });
            const candidateNode = this.memoryNodeByCandidate.get(candidate.id);
            if (candidateNode) {
              const failNode = `simfail_${candidate.id}_${Date.now()}`;
              this.upsertMemoryNode(failNode, 'simulation_result', result?.error || 'simulation failure', candidate.id, {
                status: result?.status || 'FAILED',
              });
              this.addMemoryEdge(candidateNode, failNode, 'evaluated_as');
            }
            const reward = this.computeRewardFromFailure(candidate, 'simulation_failure');
            genRewardSum += reward.totalReward;
            genBestReward = Math.max(genBestReward, reward.totalReward);
            continue;
          }

          // Middle Loop: Analyze results and potentially polish
          if (result.alpha) {
            this.logTrace('simulation_complete', 'Simulation completed with alpha metrics', candidate.id, {
              sharpe: result.alpha.sharpe,
              fitness: result.alpha.fitness,
              turnover: result.alpha.turnover,
              robustnessScore: result.alpha.enrichment?.robustnessScore,
            });
            const candidateNode = this.memoryNodeByCandidate.get(candidate.id);
            if (candidateNode) {
              const simNode = `sim_${candidate.id}_${Date.now()}`;
              this.upsertMemoryNode(simNode, 'simulation_result', `Sharpe=${result.alpha.sharpe.toFixed(3)}, Fitness=${result.alpha.fitness.toFixed(3)}`, candidate.id, {
                sharpe: result.alpha.sharpe,
                fitness: result.alpha.fitness,
                turnover: result.alpha.turnover,
                robustnessScore: result.alpha.enrichment?.robustnessScore,
              });
              this.addMemoryEdge(candidateNode, simNode, 'evaluated_as');
            }
            const reward = this.computeRewardFromAlpha(candidate, result.alpha);
            genRewardSum += reward.totalReward;
            genBestReward = Math.max(genBestReward, reward.totalReward);
            this.executeMiddleLoop(candidate, result.alpha);
            genSuccessful++;
            genSharpeSum += result.alpha.sharpe;
            genFitnessSum += result.alpha.fitness;
            genBestSharpe = Math.max(genBestSharpe, result.alpha.sharpe);

            // Add to experience buffer
            this.addToExperienceBuffer(candidate, result.alpha);

            // Track lineage
            this.trackLineage(candidate, result.alpha);
          }
        }
      }

      // Record generation stats
      const genStats: GenerationStats = {
        generation: this.state.currentGeneration,
        totalCandidates: genTotal,
        successful: genSuccessful,
        averageSharpe: genTotal > 0 ? genSharpeSum / genTotal : 0,
        averageFitness: genTotal > 0 ? genFitnessSum / genTotal : 0,
        bestSharpe: genBestSharpe,
        discoveryRate: genTotal > 0 ? genSuccessful / genTotal : 0,
        diversityScore: this.diversityManager.getMetrics().averagePairwiseCorrelation,
        averageReward: genTotal > 0 ? genRewardSum / genTotal : 0,
        bestReward: Number.isFinite(genBestReward) ? genBestReward : 0,
        dominantCategory: this.getDominantCategory(),
        timestamp: new Date().toISOString(),
      };

      // Prevent duplicate generations (shouldn't happen, but safety check)
      const existingIndex = this.state.generationStats.findIndex(
        g => g.generation === genStats.generation
      );
      if (existingIndex >= 0) {
        this.state.generationStats[existingIndex] = genStats; // Update instead of duplicate
      } else {
        this.state.generationStats.push(genStats);
      }

      // Persist generation stats to SQLite
      if (this.dbInitialized) {
        try {
          getDatabase().saveGenerationStats({
            generation: genStats.generation,
            total_candidates: genStats.totalCandidates,
            successful: genStats.successful,
            average_sharpe: genStats.averageSharpe,
            average_fitness: genStats.averageFitness,
            best_sharpe: genStats.bestSharpe,
            discovery_rate: genStats.discoveryRate,
            diversity_score: genStats.diversityScore,
            dominant_category: genStats.dominantCategory,
            session_id: this.state.id,
          });
        } catch { /* non-fatal */ }
      }

      // Update session activity in SQLite
      if (this.dbInitialized) {
        try {
          getDatabase().updateSessionActivity(this.state.id, 'running', {
            totalSimulations: this.state.totalSimulations,
            successfulAlphas: this.state.successfulAlphas,
            failedSimulations: this.state.failedSimulations,
            currentGeneration: this.state.currentGeneration,
          });
        } catch { /* non-fatal */ }
      }

      this.emit({
        type: 'generation_complete',
        data: genStats,
      });
      this.logTrace('generation_complete', 'Generation finished', null, {
        generation: genStats.generation,
        totalCandidates: genStats.totalCandidates,
        successful: genStats.successful,
        averageReward: genStats.averageReward,
        bestReward: genStats.bestReward,
      });

      // Anti-deadlock: check if discovery rate is dropping
      this.checkAntiDeadlock();

      // Gap 4: Process polishQueue — re-simulate polished/corrected expressions
      await this.processPolishQueue(config);

      // Wait between generations
      await this.rateLimit(5000);
    }

    // Research completed
    if (this.state.status === 'running') {
      this.state.status = 'idle';
      this.state.lastActivity = new Date().toISOString();

      // Persist session completion to SQLite
      if (this.dbInitialized) {
        try {
          getDatabase().updateSessionActivity(this.state.id, 'completed', {
            totalSimulations: this.state.totalSimulations,
            successfulAlphas: this.state.successfulAlphas,
            failedSimulations: this.state.failedSimulations,
            currentGeneration: this.state.currentGeneration,
          });
          // Prune experience replay buffer to keep it manageable
          getDatabase().pruneReplayBuffer(5000);
          // Checkpoint WAL to disk
          getDatabase().checkpoint();
        } catch { /* non-fatal */ }
      }

      this.emit({
        type: 'status',
        data: {
          status: 'idle',
          message: `Research completed after ${this.state.currentGeneration} generations`,
          stats: {
            totalSimulations: this.state.totalSimulations,
            successfulAlphas: this.state.successfulAlphas,
            failedSimulations: this.state.failedSimulations,
          },
        },
      });
    }
  }

  // --- Inner Loop: Syntax & Positional Validation ---

  private executeInnerLoop(candidate: AlphaCandidate): InnerLoopResult {
    const result = this.validator.validate(candidate.expression);
    if (result.normalizedExpression) {
      candidate.expression = result.normalizedExpression;
    }
    if (result.fingerprint) {
      candidate.fingerprint = result.fingerprint;
    }
    return result;
  }

  private handleValidationFailure(candidate: AlphaCandidate, result: InnerLoopResult): void {
    candidate.status = 'failed';
    candidate.error = result.errors.join('; ');

    this.state.candidateQueue.push(candidate);
    this.state.failedSimulations++;

    this.logError('inner_loop', 'Validation failed', candidate.expression, result.errors.join('; '));

    // Persist rejected fingerprint to SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().saveFingerprint({
          id: candidate.id,
          fingerprint: candidate.fingerprint,
          expression: candidate.expression,
          normalized_expression: candidate.expression,
          category: this.classifyCategory(candidate.expression),
          style: this.classifyStyle(candidate.expression),
          sharpe: null, fitness: null, turnover: null, margin: null,
          status: 'failed',
          generation: candidate.generation,
          strategy: candidate.strategy,
          parent_ids: candidate.parentId ? JSON.stringify([candidate.parentId]) : null,
          alpha_id: null,
        });
      } catch { /* non-fatal */ }
    }

    // Attempt auto-correction via LLM
    if (this.state.config?.enableAutoCorrection) {
      this.autoCorrectExpression(candidate, result.errors).catch(() => {});
    }
  }

  private handleSimulationFailure(candidate: AlphaCandidate, simResult: WQSimulationResult | null): void {
    candidate.status = 'failed';
    candidate.error = simResult?.error || 'Simulation failed';

    this.state.candidateQueue.push(candidate);
    this.state.failedSimulations++;

    this.logError('simulator', 'Simulation failed', candidate.expression, simResult?.error);

    // Persist simulation failure to SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().updateFingerprintStatus(candidate.id, 'rejected');
      } catch { /* non-fatal */ }
    }

    // If simulation error contains unknown operator, add to inaccessible list
    if (simResult?.error) {
      const inaccesibleMatch = simResult.error.match(/unknown (?:function|operator) ["'](\w+)["']/i);
      if (inaccesibleMatch) {
        this.validator.addInaccessibleOp(inaccesibleMatch[1]);
        this.addFeedback('inner', candidate.id, `Marked operator as inaccessible: ${inaccesibleMatch[1]}`, 'learning', 'inaccessible');
      }
    }
  }

  // --- Middle Loop: Metric Optimization & Polishing ---

  private executeMiddleLoop(candidate: AlphaCandidate, alpha: WQAlpha): MiddleLoopResult {
    const result: MiddleLoopResult = {
      needsPolishing: false,
      suggestedModifications: [],
    };

    const thresholds = ALPHA_QUALITY_THRESHOLDS;
    const modifications: string[] = [];

    // Hard post-simulation correlation gate: if WQ reports high self-correlation against submitted
    // alphas, force reject and blacklist the pattern so it cannot be re-generated easily.
    const hasCorrelationData = this.hasReportedCorrelationData(alpha);
    if (!hasCorrelationData) {
      const blacklistedPattern = this.diversityManager.blacklistExpressionPattern(candidate.expression);
      candidate.status = 'failed';
      candidate.error = 'Rejected post-simulation: missing correlation payload from platform';
      this.state.candidateQueue.push(candidate);
      this.logTrace('correlation_rejected', 'Rejected due to missing platform correlation payload', candidate.id, {
        blacklistedPattern,
      });
      this.addFeedback(
        'middle',
        candidate.id,
        'Post-simulation reject: missing platform correlation payload',
        'rejected',
        `Blacklisted pattern: ${blacklistedPattern}`
      );
      return result;
    }

    const maxReportedCorrelation = this.getMaxReportedCorrelation(alpha);
    const hardCorrelationLimit = this.getHardCorrelationLimit();
    if (maxReportedCorrelation >= hardCorrelationLimit) {
      const topMatches = this.getTopCorrelationMatches(alpha);
      const blacklistedPattern = this.diversityManager.blacklistExpressionPattern(candidate.expression);

      candidate.status = 'failed';
      candidate.error = `Rejected post-simulation: correlation ${(maxReportedCorrelation * 100).toFixed(1)}% >= ${(hardCorrelationLimit * 100).toFixed(1)}%`;
      this.state.candidateQueue.push(candidate);

      this.logTrace('correlation_rejected', 'Rejected by post-simulation hard correlation gate', candidate.id, {
        maxReportedCorrelation,
        hardCorrelationLimit,
        topMatches,
        blacklistedPattern,
      });
      this.addFeedback(
        'middle',
        candidate.id,
        `Post-simulation reject: correlation ${(maxReportedCorrelation * 100).toFixed(1)}% >= ${(hardCorrelationLimit * 100).toFixed(1)}%`,
        'rejected',
        `Blacklisted pattern: ${blacklistedPattern}`
      );
      this.diversityManager.recordCorrelationRejection(candidate, {
        pcaCoverage: maxReportedCorrelation,
        topMatches: topMatches.map(m => ({
          clusterId: this.diversityManager.getOrCreateClusterId(m.alphaId),
          similarity: m.similarity,
        })),
      });
      return result;
    }

    // Check each metric — standard acceptance criteria
    if (alpha.sharpe >= thresholds.minSharpe && alpha.fitness >= thresholds.minFitness &&
        alpha.turnover <= thresholds.maxTurnover &&
        !alpha.checks.some(c => c.result === 'FAIL')) {
      // Alpha passes all thresholds - accept it
      this.acceptAlpha(candidate, alpha);
      return result;
    }

    // Gap 6: Value Added auto-accept — if ValueAdded > 0.3, accept even if Sharpe is slightly below threshold
    // (only when other metrics are decent and no check failures)
    if (alpha.sharpe < thresholds.minSharpe && alpha.sharpe >= thresholds.minSharpe * 0.85 &&
        alpha.fitness >= thresholds.minFitness * 0.9 &&
        alpha.turnover <= thresholds.maxTurnover &&
        !alpha.checks.some(c => c.result === 'FAIL')) {
      const va = this.computeValueAdded(alpha.sharpe);
      if (va > 0.3) {
        this.addFeedback('middle', candidate.id,
          `Auto-accepted via Value Added criterion (VA=${va.toFixed(3)} > 0.3) despite Sharpe=${alpha.sharpe.toFixed(3)} < ${thresholds.minSharpe}`,
          'auto_accept', 'value_added');
        this.acceptAlpha(candidate, alpha);
        return result;
      }
    }

    // Needs polishing
    result.needsPolishing = true;

    if (alpha.sharpe < thresholds.minSharpe && alpha.sharpe > 0.8) {
      modifications.push('Signal is weak - try amplifying with signed_power(x, 0.5) or ts_rank for stronger cross-sectional signal');
    }
    if (alpha.fitness < thresholds.minFitness) {
      modifications.push(`Fitness ${alpha.fitness.toFixed(3)} below ${thresholds.minFitness} - try adjusting lookback window or neutralization method`);
    }
    if (alpha.turnover > thresholds.maxTurnover) {
      modifications.push(`Turnover ${(alpha.turnover * 100).toFixed(1)}% exceeds ${(thresholds.maxTurnover * 100).toFixed(1)}% - apply ts_decay_linear(x, window) or humpdecay(x, halfLife)`);
    }
    if (alpha.checks.some(c => c.result === 'FAIL')) {
      const failedChecks = alpha.checks.filter(c => c.result === 'FAIL').map(c => c.name);
      modifications.push(`Failed checks: ${failedChecks.join(', ')} - adjust expression to pass all platform checks`);
    }
    if (alpha.margin < 5 && alpha.margin > -100) {
      modifications.push(`Low margin (${alpha.margin.toFixed(2)} bps) - consider optimization of execution or delay settings`);
    }

    result.suggestedModifications = modifications;

    // If promising but not quite there, attempt LLM-based polishing
    if (alpha.sharpe > 1.0 || alpha.fitness > 0.8) {
      result.polishedExpression = candidate.expression; // Will be updated by LLM
      this.attemptPolish(candidate, alpha, modifications).catch(() => {});
    }

    candidate.status = 'failed';
    candidate.error = `Metrics below threshold: ${modifications.join('; ')}`;
    this.state.candidateQueue.push(candidate);

    this.addFeedback('middle', candidate.id, modifications.join('; '), 'rejected', modifications.join('; '));

    return result;
  }

  private getHardCorrelationLimit(): number {
    const configured = this.state.config?.strictCorrelationThreshold;
    if (typeof configured === 'number' && Number.isFinite(configured)) {
      return Math.min(0.7, Math.max(0.2, configured));
    }
    return 0.35;
  }

  private getMaxReportedCorrelation(alpha: WQAlpha): number {
    const powerPool = Object.values(alpha.correlations?.powerPool || {});
    const prod = Object.values(alpha.correlations?.prod || {});
    const values = [...powerPool, ...prod]
      .map(v => Number(v))
      .filter(v => Number.isFinite(v))
      .map(v => Math.abs(v));
    if (values.length === 0) return 0;
    return Math.max(...values);
  }

  private hasReportedCorrelationData(alpha: WQAlpha): boolean {
    const powerCount = Object.keys(alpha.correlations?.powerPool || {}).length;
    const prodCount = Object.keys(alpha.correlations?.prod || {}).length;
    return powerCount + prodCount > 0;
  }

  private getTopCorrelationMatches(alpha: WQAlpha): Array<{ alphaId: string; similarity: number }> {
    const allEntries = [
      ...Object.entries(alpha.correlations?.powerPool || {}),
      ...Object.entries(alpha.correlations?.prod || {}),
    ]
      .map(([alphaId, similarity]) => ({ alphaId, similarity: Math.abs(Number(similarity)) }))
      .filter(item => Number.isFinite(item.similarity))
      .sort((a, b) => b.similarity - a.similarity);
    return allEntries.slice(0, 5);
  }

  // --- Outer Loop: Evolutionary Strategy & Dataset Rotation ---

  private executeOuterLoop(): OuterLoopResult {
    const stats = this.state.generationStats;
    const config = this.state.config!;
    const maxGen = config.maxGenerations || 100;

    // Determine strategy
    let strategy = config.researchStrategy;

    // If last few generations had low discovery rate, switch strategy
    if (stats.length >= 3) {
      const recentAvgRate = stats.slice(-3).reduce((s, g) => s + g.discoveryRate, 0) / 3;
      if (recentAvgRate < 0.1 && config.researchStrategy !== 'random') {
        strategy = 'random';
        this.addFeedback('outer', '', `Discovery rate dropped to ${(recentAvgRate * 100).toFixed(1)}% - switching to random exploration`, 'strategy_change', 'random');
      }
    }

    // Dataset rotation
    const allStyles = Object.keys(STYLE_PREMIA_CONFIG);
    const currentDominant = this.getDominantCategory();
    const rotationOrder = allStyles.filter(s => s !== currentDominant);

    // Gap 8: Apply macro regime adjustments to style rotation weights
    let focusStyle = rotationOrder[this.state.currentGeneration % rotationOrder.length] || 'momentum';
    const macroRegime = this.state.macroRegime;

    // If macro conditions suggest non-normal regime, try to select a boosted style first
    if (macroRegime.inflation === 'high') {
      // Boost defensive or quality
      const boosted = rotationOrder.find(s => s === 'defensive' || s === 'quality');
      if (boosted && Math.random() < 0.6) focusStyle = boosted;
    }
    if (macroRegime.growth === 'low') {
      // Boost defensive or carry
      const boosted = rotationOrder.find(s => s === 'defensive' || s === 'carry');
      if (boosted && Math.random() < 0.6) focusStyle = boosted;
    }
    if (macroRegime.volatility === 'high') {
      // Boost defensive
      const boosted = rotationOrder.find(s => s === 'defensive');
      if (boosted && Math.random() < 0.6) focusStyle = boosted;
    }

    // Mutation rate increases if discovery rate drops
    let mutationRate = 0.3;
    if (stats.length >= 5) {
      const recentRate = stats.slice(-5).reduce((s, g) => s + g.discoveryRate, 0) / 5;
      if (recentRate < 0.15) mutationRate = 0.6;
    }

    // Gap 5: Apply mutation spike if active (overrides normal mutation rate)
    if (this.state.mutationSpikeRemaining > 0) {
      mutationRate = Math.max(mutationRate, 0.8);
      this.state.mutationSpikeRemaining--;
      this.emit({
        type: 'mutation_spike',
        data: {
          generation: this.state.currentGeneration,
          remainingGenerations: this.state.mutationSpikeRemaining,
          mutationRate,
        },
      });
    }

    // Tournament selection for evolutionary strategy
    const selectedParents = this.selectParents(Math.min(3, this.state.livingAlphas.length));

    // Gap 3: Compute dynamic weights based on generation progress
    const progress = this.state.currentGeneration / maxGen;
    if (progress < 0.2) {
      // Early stages: emphasize exploration — lower Sharpe threshold
      this.state.dynamicWeights = { sharpe: 1.5, fitness: 1.0, turnover: 0.8, correlation: 0.5 };
    } else if (progress > 0.8) {
      // Late stages: emphasize exploitation — higher Sharpe requirement
      this.state.dynamicWeights = { sharpe: 2.5, fitness: 2.0, turnover: 1.2, correlation: 1.0 };
    } else {
      // Middle stages: use base weights
      this.state.dynamicWeights = { sharpe: 2.0, fitness: 1.5, turnover: 1.0, correlation: 0.8 };
    }

    return {
      strategy,
      datasetRotation: [focusStyle],
      mutationRate,
      selectedParents,
      newCandidates: [],
    };
  }

  private selectParents(count: number): string[] {
    // Tournament selection: pick best alphas
    const sorted = [...this.state.livingAlphas]
      .sort((a, b) => b.sharpe - a.sharpe)
      .slice(0, count * 2);

    const selected: string[] = [];
    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      selected.push(sorted[i]?.id || '');
    }

    return selected;
  }

  // --- Alpha Generation via LLM ---
  // Gap 1: Two-agent architecture: Hypothesis Generator → Code Specialist

  private async generateCandidates(count: number, outerResult: OuterLoopResult): Promise<AlphaCandidate[]> {
    const provider = getProviderClient();

    if (!provider.isConnected()) {
      this.ensureProviderConnected();
      if (!provider.isConnected()) {
        this.logError('provider', 'Model provider not connected', undefined, 'No active provider connection available');
        return [];
      }
    }

    const style = outerResult.datasetRotation[0] || 'momentum';
    const styleConfig = STYLE_PREMIA_CONFIG[style as keyof typeof STYLE_PREMIA_CONFIG];

    // Gap 2: If evolutionary strategy with living alphas, use crossover/mutation instead
    const useEvolutionaryGeneration = outerResult.strategy === 'evolutionary'
      && this.state.livingAlphas.length >= 2
      && Math.random() < (outerResult.mutationRate || 0.3);

    if (useEvolutionaryGeneration) {
      const evolvedCandidates = this.generateEvolutionaryCandidates(count, outerResult, style, styleConfig);
      if (evolvedCandidates.length > 0) {
        this.emit({
          type: 'alpha_generated',
          data: { method: 'evolutionary', count: evolvedCandidates.length },
        });
        return evolvedCandidates;
      }
      // Fallback to LLM generation if evolution produced nothing
    }

    // Gap 1 Step 1: Generate investment hypotheses (plain text)
    const hypotheses = await this.generateHypotheses(count, style, styleConfig, outerResult);

    // Set current hypothesis for UI tracking (use first hypothesis as the "active" one)
    if (hypotheses.length > 0) {
      this.state.currentHypothesis = hypotheses[0];
    }

    // Gap 1 Step 2: Translate hypotheses into FASTEXPR expressions
    const candidates = await this.translateHypothesesToExpressions(hypotheses, style, styleConfig, outerResult);

    // Clear hypothesis after translation complete
    this.state.currentHypothesis = null;

    this.emit({
      type: 'hypothesis_generated',
      data: { count: hypotheses.length, style, translatedCount: candidates.length },
    });

    return candidates;
  }

  /**
   * Gap 1: Hypothesis Generator Agent
   * Produces investment theses as plain text (e.g., "High-volume price breakouts often mean-revert")
   */
  private async generateHypotheses(
    count: number,
    style: string,
    styleConfig: { datasets: string[]; operators: string[]; description: string },
    outerResult: OuterLoopResult,
  ): Promise<string[]> {
    const config = this.state.config!;
    const provider = getProviderClient();

    try {
      const prompt = this.buildHypothesisPrompt(count, style, styleConfig, outerResult);

      const response = await provider.chatCompletion(
        [
          { role: 'system', content: this.getHypothesisGeneratorPrompt(style, styleConfig) },
          { role: 'user', content: prompt },
        ],
        config.modelId,
        0.9,
        2048,
        { type: 'json_object' }
      );

      const parsed = JSON.parse(response);
      return (parsed.hypotheses || parsed.ideas || []).slice(0, count);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logError('provider', 'Hypothesis Generator failed, falling back to direct generation', undefined, msg);
      // Fallback: return empty array so translateHypothesesToExpressions can handle
      return [];
    }
  }

  /**
   * Gap 1: System prompt for Hypothesis Generator agent
   * Produces plain-text investment theses, NOT code
   */
  private getHypothesisGeneratorPrompt(style: string, styleConfig: { datasets: string[]; operators: string[]; description: string }): string {
    return `You are a senior quantitative investment strategist with deep expertise in financial markets. You generate investment hypotheses — clear, testable ideas about market behavior.

## Style Focus: ${style.toUpperCase()}
${styleConfig.description}

## Available Data Domains: ${styleConfig.datasets.join(', ')}

## YOUR TASK:
Generate ${style} investment hypotheses as plain-text descriptions. These will be translated into alpha factor code by a specialist.

## GUIDELINES:
1. Each hypothesis should describe a specific market pattern, anomaly, or relationship
2. Be specific about what you expect to happen (e.g., "stocks with rising earnings surprises tend to outperform over 20 days")
3. Consider different time horizons (short-term reversal, medium-term momentum, long-term value)
4. Think about cross-sectional relationships (how stocks compare to each other)
5. Consider regime-dependent effects (high vol vs low vol, trending vs mean-reverting)
6. Avoid generic ideas like "stocks go up" — be specific and actionable
7. Reference concrete data concepts (volume patterns, price levels, fundamental ratios) without writing code

## OUTPUT FORMAT:
Return a JSON object: {"hypotheses": ["hypothesis 1 text", "hypothesis 2 text", ...]}
Each hypothesis should be 1-2 sentences of plain English.`;
  }

  private buildHypothesisPrompt(
    count: number,
    style: string,
    styleConfig: { datasets: string[]; operators: string[] },
    outerResult: OuterLoopResult,
  ): string {
    let prompt = `Generate ${count} unique, creative ${style} investment hypotheses.\n\n`;

     // Error avoidance context
     const recentErrors = this.state.errorLog
       .filter(e => e.level === 'error')
       .slice(-3);
     if (recentErrors.length > 0) {
       prompt += `## Avoid these failed approaches:\n`;
       prompt += recentErrors.map(e => `- ${e.message}${e.details ? ` (${e.details})` : ''}`).join('\n');
       prompt += '\n\n';
     }

     // Correlation feedback — show rejected operator/field patterns to avoid
     const correlationContext = this.diversityManager.getCorrelationSummary();
     if (correlationContext) {
       prompt += correlationContext;
       prompt += '\n';
       prompt += 'Note: These patterns were correlated with existing portfolio. Explore different data domains or operator combinations.\n\n';
     }

     prompt += `Strategy: ${outerResult.strategy} | Mutation rate: ${(outerResult.mutationRate * 100).toFixed(0)}%\n`;
     prompt += this.buildSourceGuidanceBlock(
      `hypothesis generation ${style} ${outerResult.strategy} ${styleConfig.datasets.join(' ')}`
     );
     prompt += `Generate ${count} diverse, testable investment hypotheses.`;
    return prompt;
  }

  /**
   * Gap 1: Code Specialist Agent
   * Receives hypotheses + FASTEXPR rules, translates each into a valid expression
   */
  private async translateHypothesesToExpressions(
    hypotheses: string[],
    style: string,
    styleConfig: { datasets: string[]; operators: string[]; description: string },
    outerResult: OuterLoopResult,
  ): Promise<AlphaCandidate[]> {
    // If no hypotheses (fallback from error), use legacy direct generation
    if (hypotheses.length === 0) {
      return this.legacyDirectGeneration(
        hypotheses.length || 5,
        outerResult,
        style,
        styleConfig,
      );
    }

    const config = this.state.config!;
    const provider = getProviderClient();

    try {
      const prompt = this.buildCodeSpecialistPrompt(hypotheses, style, styleConfig, outerResult);

      const response = await provider.chatCompletion(
        [
          { role: 'system', content: this.getSystemPrompt(style, styleConfig) },
          { role: 'user', content: prompt },
        ],
        config.modelId,
        0.4,
        4096,
        { type: 'json_object' }
      );

      const parsed = JSON.parse(response);
      const expressions: string[] = parsed.expressions || parsed.alphas || [];

      return expressions.slice(0, hypotheses.length).map((expr: string) => ({
        id: uuidv4(),
        expression: expr.trim(),
        generation: this.state.currentGeneration,
        strategy: outerResult.strategy,
        diversityScore: 0,
        fingerprint: this.validator.generateFingerprint(expr),
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logError('provider', 'Code Specialist failed', undefined, msg);
      return [];
    }
  }

  /**
   * Gap 1: Build prompt for Code Specialist that receives hypotheses
   */
  private buildCodeSpecialistPrompt(
    hypotheses: string[],
    style: string,
    styleConfig: { datasets: string[]; operators: string[] },
    outerResult: OuterLoopResult,
  ): string {
    let prompt = `Translate the following ${style} investment hypotheses into valid FASTEXPR alpha expressions.\n\n`;
    prompt += `## Hypotheses to implement:\n`;
    hypotheses.forEach((h, i) => {
      prompt += `${i + 1}. "${h}"\n`;
    });
    prompt += '\n';

    // Context from experience buffer
    if (this.state.experienceBuffer.length > 0) {
      const topExperiences = this.state.experienceBuffer
        .sort((a, b) => b.improvement - a.improvement)
        .slice(0, 5);
      prompt += `## What works (from experience buffer):\n`;
      prompt += topExperiences.map(e =>
        `- Pattern ${this.diversityManager.extractPatternSignature(e.expression)} with strategy "${e.strategy}" improved metric by ${e.improvement.toFixed(3)}`
      ).join('\n');
      prompt += '\n\n';
    }

     // Error feedback
     const recentErrors = this.state.errorLog
       .filter(e => e.level === 'error')
       .slice(-5);
     if (recentErrors.length > 0) {
       prompt += `## Recent errors to AVOID:\n`;
       prompt += recentErrors.map(e => `- ${e.message}${e.details ? ` (${e.details})` : ''}`).join('\n');
       prompt += '\n\n';
     }

     // Correlation feedback — rolling summary
     const correlationContext = this.diversityManager.getCorrelationSummary();
     if (correlationContext) {
       prompt += correlationContext;
       prompt += '\n';
       prompt += 'Note: These operator+field patterns were rejected due to portfolio correlation. Diversify by using different operators, fields, or neutralization methods.\n\n';
     }

     prompt += `Translate each hypothesis into a complete FASTEXPR expression. Use ${styleConfig.datasets.join(', ')} data.\n`;
     prompt += `Strategy: ${outerResult.strategy} | Mutation rate: ${(outerResult.mutationRate * 100).toFixed(0)}%\n`;
     prompt += this.buildSourceGuidanceBlock(
      `code translation ${style} ${outerResult.strategy} ${styleConfig.operators.join(' ')} ${hypotheses.join(' ')}`
     );
     return prompt;
  }

  /**
   * Gap 1: Legacy fallback for direct generation (used when hypothesis generation fails)
   */
  private async legacyDirectGeneration(
    count: number,
    outerResult: OuterLoopResult,
    style: string,
    styleConfig: { datasets: string[]; operators: string[]; description: string },
  ): Promise<AlphaCandidate[]> {
    const config = this.state.config!;
    const provider = getProviderClient();

    const prompt = this.buildGenerationPrompt(count, outerResult, style, styleConfig);

    try {
      const response = await provider.chatCompletion(
        [
          { role: 'system', content: this.getSystemPrompt(style, styleConfig) },
          { role: 'user', content: prompt },
        ],
        config.modelId,
        0.8,
        4096,
        { type: 'json_object' }
      );

      const parsed = JSON.parse(response);
      const expressions: string[] = parsed.expressions || parsed.alphas || [];

      return expressions.slice(0, count).map((expr: string) => ({
        id: uuidv4(),
        expression: expr.trim(),
        generation: this.state.currentGeneration,
        strategy: outerResult.strategy,
        diversityScore: 0,
        fingerprint: this.validator.generateFingerprint(expr),
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logError('provider', 'Failed to generate alpha expressions', undefined, msg);
      return [];
    }
  }

  /**
   * Gap 1: Code Specialist system prompt (renamed from original getSystemPrompt)
   * Produces FASTEXPR code with strict syntax rules
   */
  private getSystemPrompt(style: string, styleConfig: { datasets: string[]; operators: string[]; description: string }): string {
    return `You are an expert quantitative researcher specializing in WorldQuant BRAIN alpha factor discovery. Your task is to generate valid FASTEXPR alpha expressions.

## Style Focus: ${style.toUpperCase()}
${styleConfig.description}

## Available Datasets for this style: ${styleConfig.datasets.join(', ')}

## Recommended Operators: ${styleConfig.operators.join(', ')}

## CRITICAL RULES (DO NOT VIOLATE):
1. Only use valid FASTEXPR syntax
2. Every time-series operator that requires a lookback window MUST have exactly 2 arguments: ts_operator(field_or_expr, window)
3. Example valid: rank(ts_delta(close, 5)) / rank(ts_std_dev(volume, 20))
4. Example multi-line: "signal = ts_mean(close, 10); result = rank(signal)"
5. Cross-sectional operators (rank, zscore) should NOT be nested inside time-series functions
6. Do NOT use operators you are uncertain about. Stick to well-known ones.
7. Lookback windows should be reasonable: 5-252 for daily data
8. For group operators, the second argument must be a grouping field like sector, industry, subindustry
9. Always end with a ranking or normalization function for the final signal
10. Do NOT make up data fields. Use only common fields like: close, open, high, low, volume, returns, cap, sharesout, assets, revenue, earnings, cashflow_op, debt_lt, sector, industry, subindustry, market

## FORBIDDEN PATTERNS:
- rank() inside ts_rank() or any ts_*() function
- zscore() inside any time-series function
- group operators nested inside ts operators
- Division by zero (e.g., x / 0)
- Lookback windows > 5000 or < 2

## OUTPUT FORMAT:
Return a JSON object: {"expressions": ["expr1", "expr2", ...]}
Each expression should be a complete, valid FASTEXPR alpha formula.`;
  }

  private buildGenerationPrompt(count: number, outerResult: OuterLoopResult, style: string, styleConfig: { datasets: string[]; operators: string[] }): string {
    let prompt = `Generate ${count} unique ${style} alpha expressions using FASTEXPR.\n\n`;
    // Use styleConfig datasets and operators for prompt context
    if (styleConfig.datasets.length > 0) {
      prompt += `Recommended datasets: ${styleConfig.datasets.join(', ')}\n`;
    }
    if (styleConfig.operators.length > 0) {
      prompt += `Recommended operators: ${styleConfig.operators.join(', ')}\n`;
    }
    prompt += '\n';

    // Intentionally do not include any prior alpha signatures in prompts.
    // This prevents the model from reconstructing submitted-alpha structures.

    // Include error feedback from recent failures
    const recentErrors = this.state.errorLog
      .filter(e => e.level === 'error')
      .slice(-5);
    if (recentErrors.length > 0) {
      prompt += `## Recent errors to AVOID:\n`;
      prompt += recentErrors.map(e => `- ${e.message}${e.details ? ` (${e.details})` : ''}`).join('\n');
      prompt += '\n\n';
    }

     // Include experience buffer insights
     if (this.state.experienceBuffer.length > 0) {
       const topExperiences = this.state.experienceBuffer
         .sort((a, b) => b.improvement - a.improvement)
         .slice(0, 5);
       prompt += `## What works (from experience buffer):\n`;
       prompt += topExperiences.map(e =>
         `- Pattern ${this.diversityManager.extractPatternSignature(e.expression)} improved metric by ${e.improvement.toFixed(3)}`
       ).join('\n');
       prompt += '\n\n';
     }

     // Include correlation feedback (rolling summary of recent rejections)
     const correlationContext = this.diversityManager.getCorrelationSummary();
     if (correlationContext) {
       prompt += correlationContext;
       prompt += '\n';
       prompt += 'Note: These patterns correlated with existing portfolio. Find alternative operators, data fields, or neutralization approaches.\n\n';
     }

     prompt += `## Strategy: ${outerResult.strategy} (mutation rate: ${(outerResult.mutationRate * 100).toFixed(0)}%)\n\n`;
     prompt += this.buildSourceGuidanceBlock(
      `expression generation ${style} ${outerResult.strategy} ${styleConfig.datasets.join(' ')} ${styleConfig.operators.join(' ')}`
     );
     prompt += `Generate ${count} NEW, DIVERSE expressions. Be creative but valid.`;

    return prompt;
  }

  private buildSourceGuidanceBlock(query: string): string {
    const { promptBlock, selectedIds, estimatedTokens } = formatSourceContextForPrompt(query, 5, 300);
    this.addRetrievalTrace('source_guidance', selectedIds, estimatedTokens);
    const sources = getConfiguredSourcePaths();
    return `\n\n${promptBlock}\nSource files: ${sources.join(' | ')}\n`;
  }

  // --- Candidate Quality Ranker (Generate many -> rank -> simulate few) ---

  private rankCandidatesForSimulation(
    candidates: AlphaCandidate[],
    outerResult: OuterLoopResult,
    simulationTarget: number
  ): AlphaCandidate[] {
    if (candidates.length <= simulationTarget) return candidates;

    const ranked = candidates
      .map(candidate => {
        const score = this.computeCandidateQualityScore(candidate, outerResult);
        return { candidate, score };
      })
      .sort((a, b) => b.score - a.score);

    // Keep a buffer above target to survive validation/diversity rejections.
    const shortlistSize = Math.min(
      ranked.length,
      Math.max(simulationTarget * 3, simulationTarget + 4)
    );
    return ranked.slice(0, shortlistSize).map(r => r.candidate);
  }

  private computeCandidateQualityScore(candidate: AlphaCandidate, outerResult: OuterLoopResult): number {
    const expr = candidate.expression || '';
    const lower = expr.toLowerCase();
    const opMatches = expr.match(/\b([a-z_][a-z0-9_]*)\s*\(/g) || [];
    const opCount = opMatches.length;
    const uniqueOps = new Set(opMatches.map(o => o.replace(/\s*\($/, '').trim()));

    // Structural quality priors
    const terminalRankBonus = /(rank|zscore|normalize)\s*\([^)]*\)\s*$/.test(lower) ? 0.25 : 0;
    const tsPresenceBonus = /ts_[a-z_]+\s*\(/.test(lower) ? 0.2 : 0;
    const groupPresenceBonus = /group_[a-z_]+\s*\(/.test(lower) ? 0.15 : 0;
    const balancedComplexity =
      opCount < 2 ? -0.4 :
      opCount > 14 ? -0.35 :
      opCount >= 4 && opCount <= 10 ? 0.3 : 0.1;
    const diversityOpsBonus = Math.min(0.25, uniqueOps.size * 0.03);

    // Penalize obviously generic/overused simple motifs
    const genericPenalty =
      /^rank\s*\(\s*ts_delta\s*\(\s*(close|returns)\s*,\s*\d+\s*\)\s*\)\s*$/i.test(expr) ? 0.45 :
      /^rank\s*\(\s*(close|returns|volume)\s*\)\s*$/i.test(expr) ? 0.55 :
      0;

    // Reward priors from historical outcomes (pattern-level, not raw expression reuse)
    const rewardPrior = this.computePatternRewardPrior(expr);

    // Style coherence bonus
    const style = outerResult.datasetRotation[0] || 'momentum';
    const styleLower = style.toLowerCase();
    const styleCoherence =
      styleLower === 'momentum' && /ts_delta|ts_returns|ts_rank|trend/.test(lower) ? 0.2 :
      styleLower === 'value' && /book|earnings|cashflow|debt|assets|revenue/.test(lower) ? 0.2 :
      styleLower === 'quality' && /earnings|accrual|roic|margin|cashflow/.test(lower) ? 0.2 :
      styleLower === 'volatility' && /std_dev|kurtosis|skew|volatility/.test(lower) ? 0.2 :
      0;

    return (
      terminalRankBonus
      + tsPresenceBonus
      + groupPresenceBonus
      + balancedComplexity
      + diversityOpsBonus
      + rewardPrior
      + styleCoherence
      - genericPenalty
    );
  }

  private computePatternRewardPrior(expression: string): number {
    if (this.rewardHistory.length === 0) return 0;
    const signature = this.diversityManager.extractPatternSignature(expression);
    if (!signature) return 0;

    const related = this.rewardHistory
      .filter(r => {
        const candidate = this.state.candidateQueue.find(c => c.id === r.candidateId);
        if (!candidate) return false;
        return this.diversityManager.extractPatternSignature(candidate.expression) === signature;
      })
      .slice(-20);
    if (related.length === 0) return 0;

    const avgReward = related.reduce((s, r) => s + r.reward.totalReward, 0) / related.length;
    return Math.max(-0.5, Math.min(0.5, avgReward * 0.2));
  }

  // --- Simulation Management ---

  private async submitSimulation(candidate: AlphaCandidate): Promise<WQSimulationResult | null> {
    const config = this.state.config!;
    const wqClient = getWQClient();

    // Track current expression for UI display
    this.state.currentExpression = candidate.expression;

    const simulationData = {
      type: 'REGULAR' as const,
      settings: {
        instrumentType: 'EQUITY' as const,
        region: config.region,
        universe: config.universe,
        delay: config.delay,
        decay: 0,
        neutralization: config.neutralization,
        truncation: 0.08,
        pasteurization: 'ON' as const,
        unitHandling: 'VERIFY' as const,
        nanHandling: 'OFF' as const,
        maxTrade: 'OFF' as const,
        language: 'FASTEXPR' as const,
        visualization: false,
        testPeriod: 'P5Y0M0D',
      },
      regular: candidate.expression,
    };

    candidate.status = 'simulating';

    const simId = uuidv4();
    const simRecord: SimulationRecord = {
      id: simId,
      alphaExpression: candidate.expression,
      candidateId: candidate.id,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    this.state.simulationHistory.push(simRecord);
    this.state.totalSimulations++;

    // Persist simulation log to SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().logSimulation({
          candidate_id: candidate.id,
          expression: candidate.expression,
          fingerprint: candidate.fingerprint,
          status: 'pending',
          sharpe: null, fitness: null, turnover: null, margin: null,
          drawdown: null, long_count: null, short_count: null, pnl: null, volatility: null,
          checks: null, error: null,
          submitted_at: new Date().toISOString(),
          completed_at: null, duration_ms: null,
          generation: candidate.generation,
        });
      } catch { /* non-fatal */ }
    }

    try {
      const { progressUrl, simulationId } = await wqClient.submitSimulation(simulationData);
      simRecord.status = 'running';
      simRecord.progressUrl = progressUrl;

      this.emit({
        type: 'simulation_submitted',
        data: { candidateId: candidate.id, simulationId, expression: candidate.expression },
      });

      // Poll for result
      const result = await wqClient.pollSimulation(progressUrl, 300000, (status) => {
        this.emit({
          type: 'status',
          data: { message: `Simulation ${simulationId}: ${status}` },
        });
      });

      simRecord.completedAt = new Date().toISOString();
      simRecord.duration = Date.now() - new Date(simRecord.submittedAt).getTime();

      if (result.status === 'COMPLETE' && result.alpha) {
        simRecord.status = 'complete';
        simRecord.sharpe = result.alpha.sharpe;
        simRecord.fitness = result.alpha.fitness;
        simRecord.turnover = result.alpha.turnover;
        simRecord.margin = result.alpha.margin;
        simRecord.checks = result.alpha.checks;

        // Update simulation log in SQLite with results
        if (this.dbInitialized) {
          try {
            getDatabase().updateSimulationResult(simRecord.id, {
              status: 'complete',
              sharpe: result.alpha.sharpe,
              fitness: result.alpha.fitness,
              turnover: result.alpha.turnover,
              margin: result.alpha.margin,
              checks: JSON.stringify(result.alpha.checks),
              completed_at: new Date().toISOString(),
              duration_ms: Date.now() - new Date(simRecord.submittedAt).getTime(),
            });
          } catch { /* non-fatal */ }
        }

        this.emit({
          type: 'simulation_complete',
          data: { candidateId: candidate.id, alpha: result.alpha },
        });
      } else {
        simRecord.status = 'failed';
        simRecord.error = result.error;

        // Update simulation log in SQLite with failure
        if (this.dbInitialized) {
          try {
            getDatabase().updateSimulationResult(simRecord.id, {
              status: 'failed',
              error: result.error,
              completed_at: new Date().toISOString(),
              duration_ms: Date.now() - new Date(simRecord.submittedAt).getTime(),
            });
          } catch { /* non-fatal */ }
        }

        this.emit({
          type: 'alpha_rejected',
          data: { candidateId: candidate.id, error: result.error },
        });
      }

      // Clear current expression after simulation completes
      this.state.currentExpression = null;

      return result;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      simRecord.status = 'failed';
      simRecord.error = msg;

      // Check for inaccessible operator errors
      const inaccesibleMatch = msg.match(/unknown (?:function|operator) ["'](\w+)["']/i);
      if (inaccesibleMatch) {
        this.validator.addInaccessibleOp(inaccesibleMatch[1]);
      }

      this.logError('simulator', 'Simulation submission failed', candidate.expression, msg);
      this.state.currentExpression = null;
      return null;
    }
  }

  // --- Auto-Correction via LLM ---

  private async autoCorrectExpression(candidate: AlphaCandidate, errors: string[]): Promise<void> {
    const config = this.state.config!;
    const provider = getProviderClient();

    if (!provider.isConnected()) return;

    try {
      const prompt = `The following FASTEXPR alpha expression has validation errors. Fix them.\n\nExpression: "${candidate.expression}"\n\nErrors:\n${errors.map(e => `- ${e}`).join('\n')}\n\nReturn JSON: {"corrected_expression": "fixed expression here", "explanation": "what was fixed"}`;

      const response = await provider.chatCompletion(
        [
          { role: 'system', content: 'You are a FASTEXPR expert. Fix the given expression based on the error messages. Return valid JSON.' },
          { role: 'user', content: prompt },
        ],
        config.modelId,
        0.3,
        1024,
        { type: 'json_object' }
      );

      const parsed = JSON.parse(response);
      if (parsed.corrected_expression && parsed.corrected_expression !== candidate.expression) {
        this.addFeedback('inner', candidate.id, `Auto-corrected: ${errors.join(', ')}`, 'correction', parsed.explanation || '');

        this.emit({
          type: 'correction',
          data: {
            original: candidate.expression,
            corrected: parsed.corrected_expression,
            explanation: parsed.explanation,
          },
        });

        // Gap 4: Add corrected expression to polish queue for re-simulation
        this.state.polishQueue.push({
          id: uuidv4(),
          expression: parsed.corrected_expression,
          parentId: candidate.id,
          generation: this.state.currentGeneration,
          strategy: candidate.strategy,
          diversityScore: 0,
          fingerprint: this.validator.generateFingerprint(parsed.corrected_expression),
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      // Silently fail correction attempt
    }
  }

  private async attemptPolish(candidate: AlphaCandidate, alpha: WQAlpha, modifications: string[]): Promise<void> {
    const config = this.state.config!;
    const provider = getProviderClient();

    if (!provider.isConnected()) return;

    try {
      const prompt = `Polish this alpha to improve its metrics:\n\nExpression: "${candidate.expression}"\nCurrent metrics: Sharpe=${alpha.sharpe.toFixed(3)}, Fitness=${alpha.fitness.toFixed(3)}, Turnover=${(alpha.turnover * 100).toFixed(1)}%\n\nIssues:\n${modifications.map(m => `- ${m}`).join('\n')}\n\nReturn JSON: {"polished_expression": "improved expression", "expected_improvement": "brief description"}`;

      const response = await provider.chatCompletion(
        [
          { role: 'system', content: 'You are a FASTEXPR alpha optimization expert. Improve the expression to meet quality thresholds. Return valid JSON.' },
          { role: 'user', content: prompt },
        ],
        config.modelId,
        0.5,
        2048,
        { type: 'json_object' }
      );

      const parsed = JSON.parse(response);
      if (parsed.polished_expression && parsed.polished_expression !== candidate.expression) {
        this.addFeedback('middle', candidate.id, `Polished: ${modifications.join(', ')}`, 'polish', parsed.expected_improvement || '');

        this.emit({
          type: 'correction',
          data: {
            original: candidate.expression,
            corrected: parsed.polished_expression,
            explanation: `Middle loop polish: ${parsed.expected_improvement}`,
          },
        });

        // Gap 4: Add polished expression to polish queue for re-simulation
        this.state.polishQueue.push({
          id: uuidv4(),
          expression: parsed.polished_expression,
          parentId: candidate.id,
          generation: this.state.currentGeneration,
          strategy: candidate.strategy,
          diversityScore: 0,
          fingerprint: this.validator.generateFingerprint(parsed.polished_expression),
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      // Silently fail polish attempt
    }
  }

  // --- Reward System ---

  private recordReward(candidateId: string, reward: RewardBreakdown): void {
    this.rewardHistory.push({
      generation: this.state.currentGeneration,
      candidateId,
      reward,
    });
    if (this.rewardHistory.length > 5000) {
      this.rewardHistory = this.rewardHistory.slice(-2000);
    }
  }

  private computeRewardFromFailure(
    candidate: AlphaCandidate,
    reason: 'syntax_failure' | 'diversity_rejection' | 'simulation_failure'
  ): RewardBreakdown {
    const base: RewardBreakdown = {
      noveltyReward: 0,
      qualityReward: 0,
      robustnessReward: 0,
      syntaxPenalty: 0,
      diversityPenalty: 0,
      turnoverPenalty: 0,
      checkFailurePenalty: 0,
      totalReward: 0,
    };
    if (reason === 'syntax_failure') base.syntaxPenalty = 0.8;
    if (reason === 'diversity_rejection') base.diversityPenalty = 0.6;
    if (reason === 'simulation_failure') base.checkFailurePenalty = 0.7;
    base.totalReward =
      base.noveltyReward + base.qualityReward + base.robustnessReward
      - base.syntaxPenalty - base.diversityPenalty - base.turnoverPenalty - base.checkFailurePenalty;
    this.recordReward(candidate.id, base);
    return base;
  }

  private computeRewardFromAlpha(candidate: AlphaCandidate, alpha: WQAlpha): RewardBreakdown {
    const thresholds = ALPHA_QUALITY_THRESHOLDS;
    const enrichment = alpha.enrichment;
    const noveltyReward = Math.max(0, 1 - (candidate.diversityScore || 0.5));
    const qualityReward =
      Math.max(0, alpha.sharpe / Math.max(0.1, thresholds.targetSharpe))
      + Math.max(0, alpha.fitness / Math.max(0.1, thresholds.minFitness));
    const robustnessReward = enrichment?.robustnessScore || 0;
    const turnoverPenalty = Math.max(0, alpha.turnover - thresholds.maxTurnover);
    const failedChecks = alpha.checks.filter(c => c.result === 'FAIL').length;
    const checkFailurePenalty = failedChecks * 0.15;
    const syntaxPenalty = 0;
    const diversityPenalty = 0;
    const totalReward =
      noveltyReward + qualityReward + robustnessReward
      - turnoverPenalty - checkFailurePenalty;
    const reward: RewardBreakdown = {
      noveltyReward,
      qualityReward,
      robustnessReward,
      syntaxPenalty,
      diversityPenalty,
      turnoverPenalty,
      checkFailurePenalty,
      totalReward,
    };
    this.recordReward(candidate.id, reward);
    return reward;
  }

  // --- Loss Function ---

  computeLoss(
    sharpe: number,
    fitness: number,
    turnover: number,
    correlation: number = 0,
    weights?: { sharpe: number; fitness: number; turnover: number; correlation: number },
  ): LossComponents {
    // Gap 3: Use provided weights or fall back to base architecture weights
    const wS = weights?.sharpe ?? 2.0;
    const wF = weights?.fitness ?? 1.5;
    const wT = weights?.turnover ?? 1.0;
    const wC = weights?.correlation ?? 0.8;

    const turnoverPenalty = turnover > 0.7 ? 1 : 0;
    const corrPenalty = correlation > 0.7 ? 1 : 0;

    // Gap 6: Compute risk-adjusted Value Added
    const valueAdded = this.computeValueAdded(sharpe);

    return {
      sharpeInSample: sharpe,
      fitness,
      turnoverPenalty,
      correlationPenalty: corrPenalty,
      valueAdded,
      totalLoss: -(wS * sharpe + wF * fitness - wT * turnoverPenalty - wC * corrPenalty),
      weights: { sharpe: wS, fitness: wF, turnover: wT, correlation: wC },
    };
  }

  // --- Gap 6: Risk-Adjusted Value Added ---

  /**
   * Compute Value Added = α_p - λ_R * ω_p²
   * @param sharpe Portfolio Sharpe ratio (proxy for alpha)
   * @param lambdaR Risk aversion parameter (default 0.5)
   * @returns Value Added score
   */
  computeValueAdded(sharpe: number, lambdaR: number = 0.5): number {
    // Simplified residual risk proxy: 1 - |sharpe| / max(|sharpe|, 2.0)
    const residualRisk = 1 - Math.abs(sharpe) / Math.max(Math.abs(sharpe), 2.0);
    return sharpe - lambdaR * residualRisk * residualRisk;
  }

  // --- Experience Buffer & Lineage ---

  private addToExperienceBuffer(candidate: AlphaCandidate, alpha: WQAlpha): void {
    // Use previous experience if there was a modification
    const recentCorrection = this.state.feedbackHistory.find(
      f => f.candidateId === candidate.id && f.loop === 'inner' && f.action === 'correction'
    );

    const improvement = alpha.sharpe;
    const tuple: ExperienceTuple = {
      expression: candidate.expression,
      modification: recentCorrection?.result || 'none',
      oldMetric: 0, // Would need prior simulation data
      newMetric: alpha.sharpe,
      strategy: candidate.strategy,
      timestamp: new Date().toISOString(),
      improvement,
    };

    this.state.experienceBuffer.push(tuple);

    // Persist to SQLite experience replay buffer (TD-error prioritized)
    if (this.dbInitialized) {
      try {
        getDatabase().addToReplay({
          expression: candidate.expression,
          modification: recentCorrection?.result || 'none',
          old_metric: 0,
          new_metric: alpha.sharpe,
          strategy: candidate.strategy,
          improvement,
        });
      } catch { /* non-fatal */ }
    }

    // Keep in-memory buffer manageable
    if (this.state.experienceBuffer.length > 1000) {
      this.state.experienceBuffer = this.state.experienceBuffer.slice(-500);
    }
  }

  private trackLineage(candidate: AlphaCandidate, alpha: WQAlpha): void {
    const node: LineageNode = {
      id: candidate.id,
      expression: candidate.expression,
      sharpe: alpha.sharpe,
      fitness: alpha.fitness,
      parentIds: candidate.parentId ? [candidate.parentId] : [],
      childrenIds: [],
      generation: candidate.generation,
      strategy: candidate.strategy,
      createdAt: new Date().toISOString(),
      isExtinct: false,
    };

    if (!this.state.lineageTree) {
      this.state.lineageTree = node;
    }

    // Persist lineage to SQLite
    if (this.dbInitialized) {
      try {
        const db = getDatabase();
        db.addLineageNode({
          id: candidate.id,
          expression: candidate.expression,
          fingerprint: candidate.fingerprint,
          parent_ids: candidate.parentId ? JSON.stringify([candidate.parentId]) : null,
          children_ids: null,
          generation: candidate.generation,
          strategy: candidate.strategy,
          sharpe: alpha.sharpe,
          fitness: alpha.fitness,
          is_extinct: false,
        });
        // Update parent's children list
        if (candidate.parentId) {
          db.updateLineageChildren(candidate.parentId, candidate.id);
        }
      } catch { /* non-fatal */ }
    }
  }

  // --- Gap 4: Polish Queue Processing (Backpropagation of Critique) ---

  /**
   * Process the polishQueue: re-simulate polished/corrected expressions
   * through the full pipeline (inner loop → diversity check → simulation → middle loop)
   * Capped at 3 per generation to avoid runaway simulation usage
   */
  private async processPolishQueue(config: ResearchConfig): Promise<void> {
    if (this.state.polishQueue.length === 0) return;
    if (this.abortController?.signal.aborted || this.state.status !== 'running') return;

    // Cap at 3 per generation
    const toProcess = this.state.polishQueue.splice(0, 3);

    for (const candidate of toProcess) {
      if (this.abortController?.signal.aborted || this.state.status !== 'running') break;
      if (!this.checkSimulationBudget(config.maxDailySimulations)) break;

      this.emit({
        type: 'critique_resubmit',
        data: {
          candidateId: candidate.id,
          parentId: candidate.parentId,
          expression: candidate.expression,
        },
      });

      // Inner Loop: Validate expression
      const validationResult = this.executeInnerLoop(candidate);
      if (!validationResult.isValid) {
        this.handleValidationFailure(candidate, validationResult);
        continue;
      }

      // Diversity Check — Layer 1: basic
      const basicDiversity = this.diversityManager.evaluateCandidate(candidate);
      if (!basicDiversity.accepted) {
        this.emit({
          type: 'diversity_check',
          data: { candidateId: candidate.id, accepted: false, reasons: basicDiversity.reasons },
        });
        this.state.candidateQueue.push({ ...candidate, status: 'discarded' });
        continue;
      }

      // Diversity Check — Layer 2: correlation
      let correlationResult: {
        accepted: boolean;
        reasons: string[];
        pcaCoverage: number;
        pcaRecommendation: string;
        topMatches: Array<{ clusterId: string; similarity: number }>;
      } | null = null;
      try {
        correlationResult = await this.diversityManager.evaluateCandidateWithPCA(candidate);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logError('diversity', 'Correlation check failed (polish)', candidate.expression, msg);
        correlationResult = {
          accepted: true,
          reasons: [],
          pcaCoverage: 0,
          pcaRecommendation: 'Correlation check unavailable',
          topMatches: [],
        };
      }

      if (correlationResult && !correlationResult.accepted) {
        this.emit({
          type: 'diversity_check',
          data: {
            candidateId: candidate.id,
            accepted: false,
            reasons: [...basicDiversity.reasons, ...correlationResult.reasons],
            correlation: correlationResult.pcaCoverage,
            recommendation: correlationResult.pcaRecommendation,
          },
        });
        this.state.candidateQueue.push({ ...candidate, status: 'discarded' });
        this.diversityManager.recordCorrelationRejection(candidate, correlationResult);
        continue;
      }

      // Submit simulation
      const simResult = await this.submitSimulation(candidate);
      if (!simResult || simResult.status === 'FAILED' || simResult.status === 'ERROR') {
        this.handleSimulationFailure(candidate, simResult);
        continue;
      }

      // Middle Loop: Analyze results
      if (simResult.alpha) {
        this.executeMiddleLoop(candidate, simResult.alpha);
        this.addToExperienceBuffer(candidate, simResult.alpha);
        this.trackLineage(candidate, simResult.alpha);
      }

      // Rate limiting
      await this.rateLimit(2000);
    }

    // Keep remaining polish queue items for next generation
    // (already spliced above, remaining items stay in polishQueue)
  }

  // --- Anti-Deadlock Logic ---

  /**
   * Gap 2: Genetic crossover — swap sub-expressions between two parent expressions
   */
  private crossoverExpressions(parent1: string, parent2: string): string[] {
    try {
      // Parse both expressions into top-level function calls
      // Simple regex-based parsing: identify top-level function_name(...) patterns
      const parseTopLevel = (expr: string): string[] => {
        const parts: string[] = [];
        let depth = 0;
        let start = 0;
        for (let i = 0; i < expr.length; i++) {
          if (expr[i] === '(') depth++;
          else if (expr[i] === ')') depth--;
          // Detect top-level separator: , at depth 0 or arithmetic operators at depth 0
          if (depth === 0 && i > 0) {
            if (expr[i] === '/' || expr[i] === '+' || expr[i] === '-') {
              // Don't split on first char of negative number
              if (parts.length > 0 || start < i) {
                parts.push(expr.substring(start, i).trim());
                start = i;
              }
            }
          }
        }
        if (start < expr.length) {
          parts.push(expr.substring(start).trim());
        }
        return parts.filter(p => p.length > 0);
      };

      const parts1 = parseTopLevel(parent1);
      const parts2 = parseTopLevel(parent2);

      if (parts1.length < 1 || parts2.length < 1) return [];

      // Pick a random sub-expression from each parent and swap
      const idx1 = Math.floor(Math.random() * parts1.length);
      const idx2 = Math.floor(Math.random() * parts2.length);

      // Create child 1: parent1 with part[idx1] replaced by parent2's part[idx2]
      const child1Parts = [...parts1];
      child1Parts[idx1] = parts2[idx2];
      const child1 = child1Parts.join(' / ');

      // Create child 2: parent2 with part[idx2] replaced by parent1's part[idx1]
      const child2Parts = [...parts2];
      child2Parts[idx2] = parts1[idx1];
      const child2 = child2Parts.join(' / ');

      return [child1, child2].filter(c => c !== parent1 && c !== parent2 && c.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Gap 2: Mutate an expression with a given mutation rate
   */
  private mutateExpression(expression: string, mutationRate: number): string {
    let mutated = expression;

    if (Math.random() > mutationRate) return mutated;

    const mutationType = Math.random();

    if (mutationType < 0.3) {
      // Replace a numeric lookback window (e.g., 20 → random(5,252))
      mutated = mutated.replace(/,\s*(\d+)\s*\)/g, (match) => {
        if (Math.random() < 0.5) {
          const newWindow = Math.floor(Math.random() * 247) + 5; // 5-252
          return `, ${newWindow})`;
        }
        return match;
      });
    } else if (mutationType < 0.5) {
      // Swap a time-series operator
      const tsOps = ['ts_delta', 'ts_rank', 'ts_mean', 'ts_std_dev', 'ts_returns', 'ts_ir', 'ts_zscore', 'ts_sum', 'ts_min', 'ts_max', 'ts_skewness', 'ts_kurtosis'];
      const op = tsOps[Math.floor(Math.random() * tsOps.length)];
      const existingTsOp = tsOps.find(o => mutated.includes(o));
      if (existingTsOp) {
        mutated = mutated.replace(existingTsOp, op);
      }
    } else if (mutationType < 0.7) {
      // Add/remove a wrapping function (e.g., wrap with rank() or zscore())
      const wrappers = ['rank', 'zscore', 'signed_power', 'sigmoid', 'log', 'abs'];
      if (Math.random() < 0.6 && !mutated.startsWith('rank(') && !mutated.startsWith('zscore(')) {
        const wrapper = wrappers[Math.floor(Math.random() * wrappers.length)];
        if (wrapper === 'signed_power') {
          mutated = `signed_power(${mutated}, 0.5)`;
        } else {
          mutated = `${wrapper}(${mutated})`;
        }
      } else {
        // Remove outer wrapping if present
        mutated = mutated.replace(/^(rank|zscore|sigmoid|log|abs)\((.+)\)$/, '$2');
      }
    } else if (mutationType < 0.85) {
      // Replace a data field
      const fields = ['close', 'open', 'high', 'low', 'volume', 'returns', 'vwap', 'cap'];
      const field = fields[Math.floor(Math.random() * fields.length)];
      const existingField = fields.find(f => mutated.includes(f));
      if (existingField && existingField !== field) {
        // Only replace if it's a standalone field reference (not part of another word)
        const regex = new RegExp(`\\b${existingField}\\b`, 'g');
        mutated = mutated.replace(regex, field);
      }
    } else {
      // Replace a numeric constant (coefficients, powers, etc.)
      mutated = mutated.replace(/\b(\d+\.\d+)\b/g, (match) => {
        if (Math.random() < 0.5) {
          return (parseFloat(match) * (0.5 + Math.random())).toFixed(2);
        }
        return match;
      });
    }

    return mutated;
  }

  /**
   * Gap 2: Generate candidates via crossover and mutation from living alphas
   */
  private generateEvolutionaryCandidates(
    count: number,
    outerResult: OuterLoopResult,
    _style: string,
    _styleConfig: { datasets: string[]; operators: string[]; description: string },
  ): AlphaCandidate[] {
    const alphas = this.state.livingAlphas;
    if (alphas.length < 2) return [];

    const candidates: AlphaCandidate[] = [];
    const mutationRate = outerResult.mutationRate || 0.3;

    // Shuffle and pick pairs for crossover
    const shuffled = [...alphas].sort(() => Math.random() - 0.5);

    for (let i = 0; i < count && candidates.length < count; i++) {
      const idx1 = i % shuffled.length;
      const idx2 = (i + 1) % shuffled.length;

      if (Math.random() < 0.5) {
        // Crossover
        const children = this.crossoverExpressions(shuffled[idx1].code, shuffled[idx2].code);
        for (const child of children) {
          if (candidates.length >= count) break;
          // Apply mutation to crossover children as well
          const finalExpr = this.mutateExpression(child, mutationRate * 0.5);
          candidates.push({
            id: uuidv4(),
            expression: finalExpr,
            parentId: shuffled[idx1].id,
            generation: this.state.currentGeneration,
            strategy: 'evolutionary',
            diversityScore: 0,
            fingerprint: this.validator.generateFingerprint(finalExpr),
            status: 'pending' as const,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        // Pure mutation of a single parent
        const parent = shuffled[idx1];
        const mutated = this.mutateExpression(parent.code, mutationRate);
        if (mutated !== parent.code) {
          candidates.push({
            id: uuidv4(),
            expression: mutated,
            parentId: parent.id,
            generation: this.state.currentGeneration,
            strategy: 'evolutionary',
            diversityScore: 0,
            fingerprint: this.validator.generateFingerprint(mutated),
            status: 'pending' as const,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    return candidates;
  }

  // --- Anti-Deadlock Logic ---

  /**
   * Gap 6: Shared helper to accept an alpha and persist its metrics.
   * Extracted from executeMiddleLoop to avoid duplication with Value Added auto-accept.
   */
  private acceptAlpha(candidate: AlphaCandidate, alpha: WQAlpha): void {
    candidate.status = 'success';
    candidate.result = alpha;
    this.state.successfulAlphas++;
    this.state.livingAlphas.push(alpha);

    // Gap 7: Store acceptance metrics for longitudinal health monitoring
    this.acceptanceMetrics.set(alpha.id, { sharpe: alpha.sharpe, fitness: alpha.fitness });

    this.diversityManager.addFingerprint(
      candidate.fingerprint,
      candidate.expression,
      this.classifyCategory(candidate.expression),
      this.classifyStyle(candidate.expression)
    );

    // Persist accepted fingerprint to SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().saveFingerprint({
          id: candidate.id,
          fingerprint: candidate.fingerprint,
          expression: candidate.expression,
          normalized_expression: candidate.expression,
          category: this.classifyCategory(candidate.expression),
          style: this.classifyStyle(candidate.expression),
          sharpe: alpha.sharpe,
          fitness: alpha.fitness,
          turnover: alpha.turnover,
          margin: alpha.margin,
          status: 'accepted',
          generation: candidate.generation,
          strategy: candidate.strategy,
          parent_ids: candidate.parentId ? JSON.stringify([candidate.parentId]) : null,
          alpha_id: alpha.id,
        });
      } catch { /* non-fatal */ }
    }

    this.emit({
      type: 'alpha_accepted',
      data: { candidateId: candidate.id, alpha, expression: candidate.expression },
    });

    // Auto-submit if configured
    if (this.state.config?.autoSubmit) {
      this.submitAlphaToWQ(alpha.id).catch(() => {});
    }
  }

  /**
   * Gap 7: Longitudinal Correlation Monitoring
   * Iterates livingAlphas and checks if performance metrics have degraded > 20%
   * compared to their acceptance metrics. Marks degraded alphas for removal.
   */
  private monitorAlphaHealth(): void {
    if (this.state.livingAlphas.length === 0) return;

    const degradedIds: string[] = [];

    for (const alpha of this.state.livingAlphas) {
      const accepted = this.acceptanceMetrics.get(alpha.id);
      if (!accepted) continue;

      // Check Sharpe degradation > 20%
      const sharpeDegraded = accepted.sharpe > 0 && alpha.sharpe < accepted.sharpe * 0.8;
      // Check Fitness degradation > 20%
      const fitnessDegraded = accepted.fitness > 0 && alpha.fitness < accepted.fitness * 0.8;

      if (sharpeDegraded || fitnessDegraded) {
        degradedIds.push(alpha.id);
        this.logError('outer_loop',
          `Alpha ${alpha.id} degraded: Sharpe ${accepted.sharpe.toFixed(3)}→${alpha.sharpe.toFixed(3)}, Fitness ${accepted.fitness.toFixed(3)}→${alpha.fitness.toFixed(3)}`,
          alpha.code,
          'Performance degraded by >20% from acceptance metrics — flagged for removal'
        );
      }
    }

    // Remove degraded alphas from living library
    if (degradedIds.length > 0) {
      const degradedSet = new Set(degradedIds);
      this.state.livingAlphas = this.state.livingAlphas.filter(a => !degradedSet.has(a.id));
      this.state.degradedAlphas += degradedIds.length;

      // Clean up acceptance metrics for removed alphas
      for (const id of degradedIds) {
        this.acceptanceMetrics.delete(id);
      }

      this.addFeedback('outer', '',
        `Removed ${degradedIds.length} degraded alpha(s) from living library (total degraded: ${this.state.degradedAlphas})`,
        'alpha_health', 'degraded');
    }
  }

  /**
   * Gap 8: Macro Sensitivity for Style Timing
   * Infers macro regime from observed alpha performance patterns and updates
   * the macro regime state. Called every 10 generations.
   *
   * Heuristics:
   *  - If volatility alphas performing well → likely high-vol regime
   *  - If momentum alphas performing well → likely trending regime
   *  - If defensive alphas underperforming → likely normal/good regime
   *  Default is 'normal' for all dimensions.
   */
  private updateMacroRegime(): void {
    const stats = this.state.generationStats;
    if (stats.length < 5) return;

    // Examine recent generation stats for style performance clues
    // We use the dominant category as a proxy for which styles are performing well
    const recentDominants = stats.slice(-5).map(g => g.dominantCategory);
    const volDominant = recentDominants.filter(d => d === 'Risk-Volatility').length;
    const momentumDominant = recentDominants.filter(d => d === 'Price-Volume').length;
    const sentimentDominant = recentDominants.filter(d => d === 'Sentiment-News').length;

    const regime: MacroRegime = { inflation: 'normal', growth: 'normal', volatility: 'normal' };

    // Volatility-focused styles dominating → likely high-vol regime
    if (volDominant >= 3) {
      regime.volatility = 'high';
      regime.growth = 'low'; // high vol often coincides with low growth expectations
    }

    // Momentum/Price-Volume dominating → likely trending regime (good growth)
    if (momentumDominant >= 3) {
      regime.growth = 'high';
    }

    // Sentiment-focused styles dominating → could signal inflationary pressures
    if (sentimentDominant >= 3) {
      regime.inflation = 'high';
    }

    // If recent average sharpe is very low across all styles → likely stressed regime
    const recentAvgSharpe = stats.slice(-5).reduce((s, g) => s + g.bestSharpe, 0) / 5;
    if (recentAvgSharpe < 0.8) {
      regime.growth = 'low';
      regime.volatility = 'high';
    }

    // If everything looks healthy → default normal (already set)

    this.state.macroRegime = regime;

    if (regime.volatility !== 'normal' || regime.growth !== 'normal' || regime.inflation !== 'normal') {
      this.addFeedback('outer', '',
        `Macro regime inferred: inflation=${regime.inflation}, growth=${regime.growth}, volatility=${regime.volatility}`,
        'macro_regime', JSON.stringify(regime));
    }
  }

  private checkAntiDeadlock(): void {
    const stats = this.state.generationStats;
    if (stats.length < 5) return;

    // Gap 5: Compute comprehensive health score as weighted average of discovery_rate,
    // average_sharpe, and diversity_score over recent generations
    const computeHealthScore = (genStatsSlice: GenerationStats[]): number => {
      if (genStatsSlice.length === 0) return 0;
      const avgDiscovery = genStatsSlice.reduce((s, g) => s + g.discoveryRate, 0) / genStatsSlice.length;
      const avgSharpe = genStatsSlice.reduce((s, g) => s + g.averageSharpe, 0) / genStatsSlice.length;
      const avgDiversity = genStatsSlice.reduce((s, g) => s + g.diversityScore, 0) / genStatsSlice.length;
      // Normalize: discovery [0,1], sharpe [0,3], diversity [0,1]
      const normalizedSharpe = Math.min(avgSharpe / 3.0, 1.0);
      return 0.4 * avgDiscovery + 0.4 * normalizedSharpe + 0.2 * (1.0 - avgDiversity);
    };

    const windowSize = Math.min(10, stats.length);
    const recentSlice = stats.slice(-windowSize);
    const lookbackSlice = stats.slice(-windowSize * 2, -windowSize);

    const currentHealth = computeHealthScore(recentSlice);

    // Track health history
    this.state.healthHistory.push({
      generation: this.state.currentGeneration,
      healthScore: currentHealth,
    });

    // Keep health history manageable
    if (this.state.healthHistory.length > 200) {
      this.state.healthHistory = this.state.healthHistory.slice(-100);
    }

    // Compare to health N generations ago
    if (lookbackSlice.length >= windowSize) {
      const previousHealth = computeHealthScore(lookbackSlice);

      if (previousHealth > 0 && currentHealth < previousHealth * 0.8) {
        // Health dropped > 20% — trigger mutation spike (5 generations)
        if (this.state.mutationSpikeRemaining <= 0) {
          this.state.mutationSpikeRemaining = 5;
          this.addFeedback('outer', '', `Health dropped ${(100 * (1 - currentHealth / previousHealth)).toFixed(1)}% (score ${currentHealth.toFixed(3)} vs ${previousHealth.toFixed(3)}) — triggering 5-generation mutation spike`, 'mutation_spike', 'increased');
          this.diversityManager.reset(); // Reset diversity constraints

          this.emit({
            type: 'mutation_spike',
            data: {
              generation: this.state.currentGeneration,
              previousHealth: previousHealth.toFixed(3),
              currentHealth: currentHealth.toFixed(3),
              dropPercent: (100 * (1 - currentHealth / previousHealth)).toFixed(1),
              remainingGenerations: 5,
            },
          });
        }
      }
    }

    // Original simpler check as additional safeguard
    const recentRate = stats.slice(-5).reduce((s, g) => s + g.discoveryRate, 0) / 5;
    const earlierRate = stats.slice(-10, -5).reduce((s, g) => s + g.discoveryRate, 0) / Math.max(1, Math.min(5, stats.length - 5));

    if (earlierRate > 0 && recentRate < earlierRate * 0.8) {
      // Trigger mutation spike
      this.addFeedback('outer', '', `Deadlock detected: discovery rate dropped 20%+ - triggering mutation spike`, 'mutation_spike', 'increased');
      if (this.state.mutationSpikeRemaining <= 0) {
        this.state.mutationSpikeRemaining = 3;
      }
      this.diversityManager.reset(); // Reset diversity constraints
    }
  }

   // --- Utility Methods ---

   /**
    * Refresh correlation baseline from WQ API.
    * Reloads user's ACTIVE submitted alphas into DiversityManager
    * to keep the correlation reference up-to-date.
    * Called every 100 generations.
    */
   private async refreshCorrelationBaseline(): Promise<void> {
     try {
       const wqClient = getWQClient();
       const submittedResult = await wqClient.listUserAlphas({
         limit: 100,
         status: 'ACTIVE',
       });
       if (submittedResult.results.length > 0) {
         await this.diversityManager.loadSubmittedAlphaCorrelations(submittedResult.results);
       }
     } catch {
       // Non-fatal: if refresh fails, continue with existing baseline
     }
   }

   private async loadExistingAlphas(): Promise<void> {
    try {
      const wqClient = getWQClient();
      // Keep in-session living library separate from user submitted alphas to avoid
      // prompt/evolution leakage from production portfolio formulas.
      this.state.livingAlphas = [];

      // Gap 3: Also load submitted alphas specifically for correlation baseline
      const submittedResult = await wqClient.listUserAlphas({
        limit: 100,
        status: 'ACTIVE',
      });
      if (submittedResult.results.length > 0) {
        await this.diversityManager.loadSubmittedAlphaCorrelations(submittedResult.results);
      }

      this.state.diversityMetrics = this.diversityManager.getMetrics();
    } catch {
      // Leave baseline empty; caller enforces fail-closed behavior.
    }
  }

  private async submitAlphaToWQ(alphaId: string): Promise<void> {
    try {
      const wqClient = getWQClient();
      const result = await wqClient.submitAlpha(alphaId);
      this.addFeedback('outer', alphaId, `Alpha submission: ${result.message}`, 'submit', result.success ? 'success' : 'failed');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logError('outer_loop', 'Failed to submit alpha', alphaId, msg);
    }
  }

  private checkSimulationBudget(maxDaily: number): boolean {
    const today = new Date().toISOString().split('T')[0];
    if (this.simulationCounter.date !== today) {
      this.simulationCounter = { count: 0, date: today };
    }
    return this.simulationCounter.count < maxDaily;
  }

  private rateLimit(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private logError(source: ResearchError['source'], message: string, expression?: string, details?: string): void {
    const error: ResearchError = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level: 'error',
      source,
      message,
      expression,
      details,
    };
    this.state.errorLog.push(error);

    // Persist error to SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().logError({
          level: 'error',
          source,
          message,
          expression: expression || null,
          details: details || null,
          candidate_id: null,
        });
      } catch { /* non-fatal */ }
    }

    // Keep in-memory log manageable
    if (this.state.errorLog.length > 500) {
      this.state.errorLog = this.state.errorLog.slice(-200);
    }
  }

  private addFeedback(loop: FeedbackRecord['loop'], candidateId: string, feedback: string, action: string, result: string): void {
    this.state.feedbackHistory.push({
      id: uuidv4(),
      candidateId,
      loop,
      feedback,
      action,
      result,
      timestamp: new Date().toISOString(),
    });

    // Persist feedback to SQLite
    if (this.dbInitialized) {
      try {
        getDatabase().logFeedback({
          candidate_id: candidateId,
          loop,
          feedback,
          action,
          result,
        });
      } catch { /* non-fatal */ }
    }

    // Keep in-memory history manageable
    if (this.state.feedbackHistory.length > 500) {
      this.state.feedbackHistory = this.state.feedbackHistory.slice(-200);
    }
  }

  private classifyCategory(expression: string): string {
    const lower = expression.toLowerCase();
    if (/fundamental|cashflow|revenue|earnings|debt|assets/i.test(lower)) return 'Fundamental';
    if (/price|close|open|high|low|volume|returns/i.test(lower)) return 'Price-Volume';
    if (/news|sentiment|analyst|estimate/i.test(lower)) return 'Sentiment-News';
    if (/model|score|rating/i.test(lower)) return 'Model-Based';
    if (/volatility|std_dev|skew/i.test(lower)) return 'Risk-Volatility';
    return 'Other';
  }

  private classifyStyle(expression: string): StylePremia {
    const lower = expression.toLowerCase();
    if (/value|book|pe_ratio|pb_ratio/i.test(lower)) return 'value';
    if (/momentum|ts_delta|ts_returns|trend/i.test(lower)) return 'momentum';
    if (/yield|dividend|carry/i.test(lower)) return 'carry';
    if (/defensive|low_vol/i.test(lower)) return 'defensive';
    if (/sentiment|news|analyst/i.test(lower)) return 'sentiment';
    if (/volatility|std_dev|kurtosis/i.test(lower)) return 'volatility';
    if (/quality|earnings|accrual|roic/i.test(lower)) return 'quality';
    return 'momentum';
  }

  private getDominantCategory(): string {
    const dist = this.diversityManager.getCategoryCounts();
    let max = 0;
    let dominant = 'Unknown';
    for (const [cat, count] of Object.entries(dist)) {
      if (count > max) { max = count; dominant = cat; }
    }
    return dominant;
  }

  private ensureProviderConnected(): void {
    const client = getProviderClient();
    if (client.isConnected()) return;

    const providerId = this.state.config?.providerId;
    const selectedProvider = providerId ? getProvider(providerId) : undefined;
    const activeProvider = getAllProviders().find(p => p.isActive);
    const fallbackProvider = selectedProvider || activeProvider || getAllProviders()[0];

    if (!fallbackProvider) return;
    try {
      client.connect(fallbackProvider);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logError('provider', 'Failed to reconnect provider', undefined, msg);
    }
  }
}

// Singleton instance
let engineInstance: ResearchEngine | null = null;

export function getResearchEngine(): ResearchEngine {
  if (!engineInstance) {
    engineInstance = new ResearchEngine();
  }
  return engineInstance;
}
