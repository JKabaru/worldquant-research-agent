// ============================================================
// Provider Presets - Configured model provider templates
// ============================================================

import { ProviderPreset } from './types';

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    type: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: 'GPT-4o, GPT-4, GPT-3.5 Turbo and other OpenAI models',
  },
  {
    type: 'opencode',
    name: 'OpenCode (Zen)',
    baseUrl: 'https://opencode.ai/zen/v1',
    description: 'Free and premium models via OpenCode Zen API',
  },
  {
    type: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    description: 'Claude 4, Claude 3.5, Claude 3 Opus and other Anthropic models',
  },
  {
    type: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    description: 'NVIDIA NIM inference API - Llama, Mixtral, and more',
  },
  {
    type: 'google',
    name: 'Google AI (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    description: 'Gemini Pro, Gemini Ultra and other Google AI models',
  },
  {
    type: 'custom',
    name: 'Custom / OpenAI-Compatible',
    baseUrl: '',
    description: 'Any OpenAI-compatible API endpoint (Ollama, vLLM, LiteLLM, etc.)',
  },
];

export const WQ_REGIONS = [
  { value: 'USA', label: 'USA', universes: ['TOP3000', 'TOP1000', 'TOP500', 'TOP200'] },
  { value: 'GLB', label: 'Global', universes: ['TOP3000', 'MINVOL1M', 'TOPDIV3000'] },
  { value: 'EUR', label: 'Europe', universes: ['TOP2500', 'TOP1200', 'TOP800', 'TOP400'] },
  { value: 'ASI', label: 'Asia', universes: ['MINVOL1M'] },
  { value: 'CHN', label: 'China', universes: ['TOP2000U'] },
  { value: 'IND', label: 'India', universes: ['TOP500'] },
];

export const WQ_NEUTRALIZATIONS = [
  'MARKET', 'SECTOR', 'INDUSTRY', 'SUBINDUSTRY',
  'COUNTRY', 'REVERSION_AND_MOMENTUM', 'STATISTICAL',
  'CROWDING', 'FAST', 'SLOW', 'SLOW_AND_FAST',
];

export const DEFAULT_SIMULATION_SETTINGS = {
  instrumentType: 'EQUITY' as const,
  region: 'USA',
  universe: 'TOP3000',
  delay: 1,
  decay: 0,
  neutralization: 'INDUSTRY',
  truncation: 0.08,
  pasteurization: 'ON' as const,
  unitHandling: 'VERIFY' as const,
  nanHandling: 'OFF' as const,
  maxTrade: 'OFF' as const,
  language: 'FASTEXPR' as const,
  visualization: false,
  testPeriod: 'P5Y0M0D',
};

export const ALPHA_QUALITY_THRESHOLDS = {
  minSharpe: 1.25,
  targetSharpe: 1.5,
  minFitness: 1.0,
  maxTurnover: 0.7,
  minTurnover: 0.01,
  minPositions: 100,
  minMargin: -1.6,
};

export const STYLE_PREMIA_CONFIG = {
  value: {
    label: 'Value',
    datasets: ['fundamental6', 'fundamental2'],
    operators: ['rank', 'zscore', 'ts_mean', 'ts_delta'],
    description: 'Cash-flow efficiency, earnings quality, balance sheet strength',
  },
  momentum: {
    label: 'Momentum',
    datasets: ['pv13', 'news12'],
    operators: ['ts_rank', 'ts_delta', 'ts_returns', 'ts_ir'],
    description: 'Price momentum, earnings momentum, trend persistence',
  },
  carry: {
    label: 'Carry',
    datasets: ['fundamental6', 'analyst4'],
    operators: ['group_rank', 'group_mean', 'ts_zscore'],
    description: 'Dividend yield, earnings yield, funding differentials',
  },
  defensive: {
    label: 'Defensive',
    datasets: ['fundamental6', 'model16'],
    operators: ['ts_std_dev', 'ts_skewness', 'ts_min', 'rank'],
    description: 'Low volatility, high quality, downside protection',
  },
  sentiment: {
    label: 'Sentiment',
    datasets: ['news12', 'analyst4'],
    operators: ['ts_rank', 'ts_delta', 'signed_power', 'sigmoid'],
    description: 'News sentiment, analyst revisions, social signals',
  },
  volatility: {
    label: 'Volatility',
    datasets: ['pv13', 'model16'],
    operators: ['ts_std_dev', 'ts_kurtosis', 'ts_entropy', 'ts_moment'],
    description: 'Volatility regime, dispersion, tail risk signals',
  },
  quality: {
    label: 'Quality',
    datasets: ['fundamental6', 'model51'],
    operators: ['ts_mean', 'ts_rank', 'rank', 'group_rank'],
    description: 'Earnings quality, accruals, capital allocation efficiency',
  },
};

// Gap 8: Macro regime → style weight overrides for style timing
// Each entry maps a macro condition to style weights that should be boosted.
// Weights are additive multipliers on top of the default equal rotation.
export const MACRO_STYLE_OVERRIDES: Record<string, Record<string, number>> = {
  high_inflation: { defensive: 1.5, quality: 1.3 },
  low_growth:    { defensive: 1.5, carry: 1.3 },
  high_volatility: { defensive: 1.6, volatility: 1.2 },
  // "normal" regime uses the default equal rotation (no overrides needed)
};

export const RESEARCH_STRATEGIES = {
  bfs: {
    label: 'Breadth-First Search',
    description: 'Systematically explores operators and data fields level by level',
  },
  dfs: {
    label: 'Depth-First Search',
    description: 'Deeply explores promising expression trees before backtracking',
  },
  random: {
    label: 'Random Walk',
    description: 'Randomly generates and mutates expressions for broad exploration',
  },
  evolutionary: {
    label: 'Evolutionary / Genetic',
    description: 'Uses tournament selection, crossover, and mutation to evolve alpha population',
  },
};
