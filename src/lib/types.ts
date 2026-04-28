// ============================================================
// WorldQuant BRAIN Research Agent - Type Definitions
// ============================================================

// --- Model Provider Types ---

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerId: string;
  contextWindow?: number;
  description?: string;
}

export type ProviderType = 'openai' | 'anthropic' | 'nvidia' | 'google' | 'opencode' | 'custom';

export interface ProviderPreset {
  type: ProviderType;
  name: string;
  baseUrl: string;
  description: string;
}

// --- WorldQuant BRAIN Types ---

export interface WQCredentials {
  email: string;
  password: string;
}

export interface WQSession {
  isAuthenticated: boolean;
  cookies?: string;
  expiresAt?: string;
  userId?: string;
  accountLevel?: string;
}

export interface WQSimulationSettings {
  instrumentType: 'EQUITY';
  region: string;
  universe: string;
  delay: number;
  decay: number;
  neutralization: string;
  truncation: number;
  pasteurization: 'ON' | 'OFF';
  unitHandling: 'VERIFY';
  nanHandling: 'ON' | 'OFF';
  maxTrade: 'ON' | 'OFF';
  language: 'FASTEXPR';
  visualization: boolean;
  testPeriod?: string;
}

export interface WQSimulationRequest {
  type: 'REGULAR';
  settings: WQSimulationSettings;
  regular: string;
}

export interface WQSimulationResult {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'ERROR';
  alphaId?: string;
  error?: string;
  alpha?: WQAlpha;
  retryAfter?: number;
  enrichment?: WQSimulationEnrichment;
}

export interface WQAlpha {
  id: string;
  code: string;
  dateCreated: string;
  sharpe: number;
  fitness: number;
  turnover: number;
  margin: number;
  returns: number;
  drawdown: number;
  longCount: number;
  shortCount: number;
  pnl: number;
  volatility: number;
  maxDrawdown: number;
  winRate: number;
  avgReturn: number;
  checks: WQCheck[];
  correlations: WQCorrelations;
  performanceComparison?: WQPerformanceComparison;
  enrichment?: WQSimulationEnrichment;
  settings: WQSimulationSettings;
  isSubmitted: boolean;
  status: string;
}

export interface WQPerformanceComparison {
  sharpeDiff?: number;
  fitnessDiff?: number;
  returnsDiff?: number;
  marginDiff?: number;
  drawdownDiff?: number;
  turnoverDiff?: number;
  benchmark?: string;
}

export interface WQSimulationEnrichment {
  performanceComparison: WQPerformanceComparison;
  robustnessScore: number;
  qualitySignals: {
    checksPassRate: number;
    turnoverPenalty: number;
    drawdownPenalty: number;
    marginBonus: number;
  };
}

export interface WQCheck {
  result: 'PASS' | 'FAIL';
  name: string;
  description?: string;
}

export interface WQCorrelations {
  powerPool: Record<string, number>;
  prod: Record<string, number>;
}

export interface WQDataField {
  id: string;
  description: string;
  datasetId: string;
  datasetName: string;
  category: string;
  type: string;
  delay: number;
}

export interface WQOperator {
  name: string;
  type: string;
  category: string;
  definition: string;
  description: string;
  minArgs: number;
  maxArgs: number;
  inputs: string[];
}

// --- Research Engine Types ---

export interface ResearchConfig {
  providerId: string;
  modelId: string;
  region: string;
  universe: string;
  delay: number;
  neutralization: string;
  maxConcurrentSimulations: number;
  maxDailySimulations: number;
  targetSharpe: number;
  targetFitness: number;
  maxTurnover: number;
  diversityThreshold: number;
  autoSubmit: boolean;
  researchStrategy: 'bfs' | 'dfs' | 'random' | 'evolutionary';
  maxGenerations: number;
  populationSize: number;
  enableAutoCorrection: boolean;
  enableDiversityManagement: boolean;
  stylePremiaRotation: boolean;
  freeTierMode?: boolean;
  strictCorrelationThreshold?: number;
  generationMultiplier?: number;
}

export interface ResearchState {
  id: string;
  status: 'idle' | 'running' | 'paused' | 'stopping' | 'error';
  config: ResearchConfig | null;
  currentGeneration: number;
  totalSimulations: number;
  successfulAlphas: number;
  failedSimulations: number;
  startTime: string | null;
  lastActivity: string | null;
  livingAlphas: WQAlpha[];
  candidateQueue: AlphaCandidate[];
  simulationHistory: SimulationRecord[];
  errorLog: ResearchError[];
  diversityMetrics: DiversityMetrics | null;
  feedbackHistory: FeedbackRecord[];
  experienceBuffer: ExperienceTuple[];
  lineageTree: LineageNode | null;
  generationStats: GenerationStats[];
  // Gap 3: Dynamic loss weights adjusted by Outer Loop based on generation progress
  dynamicWeights: { sharpe: number; fitness: number; turnover: number; correlation: number };
  // Gap 4: Queue for polished/corrected expressions awaiting re-simulation
  polishQueue: AlphaCandidate[];
  // Gap 5: Health history for anti-deadlock tracking
  healthHistory: Array<{ generation: number; healthScore: number }>;
  // Gap 5: Mutation spike flag (decays over 5 generations)
  mutationSpikeRemaining: number;
  // Gap 7: Counter for degraded alphas removed from living library
  degradedAlphas: number;
  // Gap 8: Inferred macro regime for style timing adjustments
  macroRegime: MacroRegime;
  // Current processing state (exposed for UI display)
  currentHypothesis: string | null;
  currentExpression: string | null;
}

export interface AlphaCandidate {
  id: string;
  expression: string;
  parentId?: string;
  generation: number;
  strategy: string;
  diversityScore: number;
  fingerprint: string;
  status: 'pending' | 'validating' | 'simulating' | 'success' | 'failed' | 'discarded';
  simulationId?: string;
  result?: WQAlpha;
  error?: string;
  createdAt: string;
}

export interface SimulationRecord {
  id: string;
  alphaExpression: string;
  candidateId: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  progressUrl?: string;
  sharpe?: number;
  fitness?: number;
  turnover?: number;
  margin?: number;
  error?: string;
  submittedAt: string;
  completedAt?: string;
  duration?: number;
  checks?: WQCheck[];
}

export interface ResearchError {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  source: 'inner_loop' | 'middle_loop' | 'outer_loop' | 'simulator' | 'provider' | 'diversity';
  message: string;
  expression?: string;
  details?: string;
}

export interface DiversityMetrics {
  totalCandidates: number;
  acceptedCandidates: number;
  discardedDuplicates: number;
  discardedCorrelated: number;
  averagePairwiseCorrelation: number;
  pcaCoverage: number;
  categoryDistribution: Record<string, number>;
  styleDistribution: Record<string, number>;
}

export interface FeedbackRecord {
  id: string;
  candidateId: string;
  loop: 'inner' | 'middle' | 'outer';
  feedback: string;
  action: string;
  result: string;
  timestamp: string;
}

export interface ExperienceTuple {
  expression: string;
  modification: string;
  oldMetric: number;
  newMetric: number;
  strategy: string;
  timestamp: string;
  improvement: number;
}

export interface LineageNode {
  id: string;
  expression: string;
  sharpe?: number;
  fitness?: number;
  parentIds: string[];
  childrenIds: string[];
  generation: number;
  strategy: string;
  createdAt: string;
  isExtinct: boolean;
}

export interface GenerationStats {
  generation: number;
  totalCandidates: number;
  successful: number;
  averageSharpe: number;
  averageFitness: number;
  bestSharpe: number;
  discoveryRate: number;
  diversityScore: number;
  averageReward?: number;
  bestReward?: number;
  dominantCategory: string;
  timestamp: string;
}

export interface RewardBreakdown {
  noveltyReward: number;
  qualityReward: number;
  robustnessReward: number;
  syntaxPenalty: number;
  diversityPenalty: number;
  turnoverPenalty: number;
  checkFailurePenalty: number;
  totalReward: number;
}

// --- Multi-Timescale Feedback Types ---

export interface InnerLoopResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalizedExpression?: string;
  fingerprint?: string;
}

export interface MiddleLoopResult {
  needsPolishing: boolean;
  suggestedModifications: string[];
  polishedExpression?: string;
  estimatedImprovement?: number;
}

export interface OuterLoopResult {
  strategy: string;
  datasetRotation: string[];
  mutationRate: number;
  selectedParents: string[];
  newCandidates: string[];
}

// --- Style Premia Types ---

export type StylePremia = 'value' | 'momentum' | 'carry' | 'defensive' | 'sentiment' | 'volatility' | 'quality';

export interface StyleAllocation {
  style: StylePremia;
  weight: number;
  currentAlphas: number;
  maxAlphas: number;
  datasets: string[];
  operators: string[];
  performance: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

// --- Macro Regime Type (Gap 8) ---

export interface MacroRegime {
  inflation: 'high' | 'normal' | 'low';
  growth: 'high' | 'normal' | 'low';
  volatility: 'high' | 'normal' | 'low';
}

// --- Loss Function Types ---

export interface LossComponents {
  sharpeInSample: number;
  fitness: number;
  turnoverPenalty: number;
  correlationPenalty: number;
  // Gap 6: Risk-adjusted value added (α_p - λ_R * ω_p²)
  valueAdded: number;
  totalLoss: number;
  weights: {
    sharpe: number;
    fitness: number;
    turnover: number;
    correlation: number;
  };
}
