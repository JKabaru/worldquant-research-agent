// ============================================================
// Regime-Aware Validation Utilities for Alpha Research
// Adjusts alpha evaluation based on inferred market regime
// ============================================================

import { MacroRegime, WQAlpha } from './types';

/**
 * Regime-adjusted threshold configuration
 */
interface RegimeThresholds {
  minSharpe: { base: number; adjustment: number };
  maxTurnover: { base: number; adjustment: number };
  minFitness: { base: number; adjustment: number };
}

/**
 * Compute regime-adjusted quality thresholds
 * Different market regimes require different alpha characteristics
 */
export function computeRegimeAdjustedThresholds(
  macroRegime: MacroRegime,
  baseThresholds: {
    minSharpe: number;
    maxTurnover: number;
    minFitness: number;
  }
): RegimeThresholds {
  let sharpeAdj = 0, turnoverAdj = 0, fitnessAdj = 0;
  
  // High volatility regime: favor lower turnover, higher robustness
  if (macroRegime.volatility === 'high') {
    turnoverAdj = -0.1; // Stricter turnover control
    fitnessAdj = 0.05; // Higher fitness threshold for robustness
  }
  
  // Low growth regime: favor defensive strategies
  if (macroRegime.growth === 'low') {
    sharpeAdj = 0.1; // Higher Sharpe requirement (harder to find alpha)
  }
  
  // High inflation regime: favor different signal characteristics
  if (macroRegime.inflation === 'high') {
    fitnessAdj = 0.05; // Higher fitness for inflation-resilient signals
  }
  
  return {
    minSharpe: {
      base: baseThresholds.minSharpe,
      adjustment: sharpeAdj,
    },
    maxTurnover: {
      base: baseThresholds.maxTurnover,
      adjustment: turnoverAdj,
    },
    minFitness: {
      base: baseThresholds.minFitness,
      adjustment: fitnessAdj,
    },
  };
}

/**
 * Regime-aware alpha validation
 * Returns adjusted accept/reject decision based on macro regime
 */
export function validateAlphaRegimeAware(
  alpha: WQAlpha,
  macroRegime: MacroRegime,
  baseThresholds: {
    minSharpe: number;
    maxTurnover: number;
    minFitness: number;
  }
): {
  accepted: boolean;
  reasons: string[];
  adjustedThresholds: RegimeThresholds;
  regimePenalty?: number;
} {
  const adjustedThresholds = computeRegimeAdjustedThresholds(macroRegime, baseThresholds);
  const reasons: string[] = [];
  let regimePenalty = 0;
  
  // Apply regime-adjusted thresholds
  const sharpeThreshold = adjustedThresholds.minSharpe.base + adjustedThresholds.minSharpe.adjustment;
  const turnoverThreshold = adjustedThresholds.maxTurnover.base + adjustedThresholds.maxTurnover.adjustment;
  const fitnessThreshold = adjustedThresholds.minFitness.base + adjustedThresholds.minFitness.adjustment;
  
  // Check Sharpe
  if (alpha.sharpe < sharpeThreshold) {
    reasons.push(`Sharpe ${alpha.sharpe.toFixed(3)} below regime-adjusted threshold ${sharpeThreshold.toFixed(3)}`);
  }
  
  // Check Turnover
  if (alpha.turnover > turnoverThreshold) {
    reasons.push(`Turnover ${(alpha.turnover * 100).toFixed(1)}% exceeds regime-adjusted threshold ${(turnoverThreshold * 100).toFixed(1)}%`);
    regimePenalty += 0.1;
  }
  
  // Check Fitness
  if (alpha.fitness < fitnessThreshold) {
    reasons.push(`Fitness ${alpha.fitness.toFixed(3)} below regime-adjusted threshold ${fitnessThreshold.toFixed(3)}`);
  }
  
  // Regime-specific penalties
  if (macroRegime.volatility === 'high' && alpha.turnover > baseThresholds.maxTurnover * 1.2) {
    reasons.push('High turnover penalized in high-volatility regime');
    regimePenalty += 0.15;
  }
  
  if (macroRegime.growth === 'low' && alpha.sharpe < 1.0) {
    reasons.push('Alpha underperforms in low-growth regime');
    regimePenalty += 0.1;
  }
  
  const accepted = reasons.length === 0;
  
  return {
    accepted,
    reasons,
    adjustedThresholds,
    regimePenalty: regimePenalty > 0 ? regimePenalty : undefined,
  };
}

/**
 * Compute regime suitability score for an alpha
 * Higher score = better fit for current regime
 */
export function computeRegimeSuitability(
  alpha: WQAlpha,
  macroRegime: MacroRegime,
  expression: string
): {
  suitability: number;
  regimeMatch: string;
  suggestedAdjustment?: string;
} {
  const lowerExpr = expression.toLowerCase();
  let suitability = 0.5; // Base score
  let regimeMatch = 'neutral';
  
  // High volatility regime preferences
  if (macroRegime.volatility === 'high') {
    // Volatility-focused alphas get bonus
    if (/volatility|std_dev|kurtosis|skew/i.test(lowerExpr)) {
      suitability += 0.2;
      regimeMatch = 'volatility_matched';
    }
    // Defensive strategies get bonus
    if (/defensive|low_vol|low_volatility/i.test(lowerExpr)) {
      suitability += 0.15;
      regimeMatch = 'defensive_matched';
    }
    // Mean-reversion strategies penalized
    if (/mean_reversion|zscore|ts_mean|ts_std_dev/i.test(lowerExpr) && 
        /ts_delta|ts_rank|trend/i.test(lowerExpr)) {
      suitability -= 0.1;
    }
  }
  
  // Low growth regime preferences
  if (macroRegime.growth === 'low') {
    // Value strategies get bonus
    if (/value|book|pe_ratio|pb_ratio|cashflow|dividend/i.test(lowerExpr)) {
      suitability += 0.15;
      regimeMatch = 'value_matched';
    }
    // Carry strategies get bonus
    if (/yield|carry/i.test(lowerExpr)) {
      suitability += 0.1;
      regimeMatch = 'carry_matched';
    }
    // Momentum strategies penalized
    if (/momentum|ts_delta|ts_returns|trend/i.test(lowerExpr)) {
      suitability -= 0.15;
    }
  }
  
  // High inflation regime preferences
  if (macroRegime.inflation === 'high') {
    // Quality metrics get bonus
    if (/quality|roic|margin|accrual|earnings/i.test(lowerExpr)) {
      suitability += 0.15;
      regimeMatch = 'quality_matched';
    }
    // Real assets would get bonus (but we don't have commodity fields in most alphas)
  }
  
  // Performance-based adjustment
  const performanceAdjustment = (alpha.sharpe - 1.0) / 10; // Normalize
  suitability += performanceAdjustment;
  
  const suggestedAdjustment = suitability < 0.6 
    ? getRegimeAdjustmentSuggestion(macroRegime, lowerExpr)
    : undefined;
  
  return {
    suitability: Math.max(0, Math.min(1, suitability)),
    regimeMatch,
    suggestedAdjustment,
  };
}

/**
 * Get suggested adjustment based on regime mismatch
 */
function getRegimeAdjustmentSuggestion(regime: MacroRegime, expression: string): string | undefined {
  if (regime.volatility === 'high' && /momentum|ts_delta|trend/i.test(expression)) {
    return 'Consider volatility control: wrap with decay_linear() or add hump() to reduce turnover';
  }
  if (regime.growth === 'low' && /momentum|ts_delta/i.test(expression)) {
    return 'Consider value/carry signals instead of momentum in low-growth environment';
  }
  if (regime.inflation === 'high' && /momentum/i.test(expression)) {
    return 'Consider quality fundamentals for inflation-resilient signals';
  }
  return undefined;
}

/**
 * Enhanced uniqueness check using correlation penalty
 * Integrates with diversity scoring mechanism
 */
export function computeUniquenessPenalty(
  correlationScore: number,
  baseThreshold: number = 0.35
): {
  penalty: number;
  shouldReject: boolean;
  adjustedThreshold: number;
} {
  // Non-linear penalty: higher correlation = higher penalty
  const overThreshold = Math.max(0, correlationScore - baseThreshold);
  const penalty = Math.min(0.5, overThreshold * 2);
  
  // Dynamic threshold: increase stringency as correlation approaches 1
  const adjustedThreshold = baseThreshold + (correlationScore > baseThreshold ? overThreshold * 0.5 : 0);
  
  return {
    penalty,
    shouldReject: correlationScore >= baseThreshold * 1.2, // 20% buffer before hard reject
    adjustedThreshold: Math.min(0.7, adjustedThreshold),
  };
}

/**
 * Build regime-aware context string for LLM prompts
 */
export function buildRegimeContext(
  macroRegime: MacroRegime,
  suitabilityScores: Array<{ alphaId: string; suitability: number }> | null
): string {
  const regimeLabels: Record<string, string> = {
    high: 'HIGH',
    normal: 'NORMAL',
    low: 'LOW',
  };
  
  let context = `## Current Market Regime Context:\n`;
  context += `- Volatility: ${regimeLabels[macroRegime.volatility]}\n`;
  context += `- Growth: ${regimeLabels[macroRegime.growth]}\n`;
  context += `- Inflation: ${regimeLabels[macroRegime.inflation]}\n\n`;
  
  // Style recommendations based on regime
  const recommendations: string[] = [];
  if (macroRegime.volatility === 'high') {
    recommendations.push('- Prioritize: defensive, volatility, quality signals');
    recommendations.push('- Avoid: high-turnover momentum strategies');
  }
  if (macroRegime.growth === 'low') {
    recommendations.push('- Prioritize: value, carry, quality fundamentals');
  }
  if (macroRegime.inflation === 'high') {
    recommendations.push('- Prioritize: quality metrics, real assets, inflation-resilient sectors');
  }
  
  if (recommendations.length > 0) {
    context += `## Style Recommendations:\n${recommendations.join('\n')}\n`;
  }
  
  return context;
}