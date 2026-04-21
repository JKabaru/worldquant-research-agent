// ============================================================
// Diversity Manager - Portfolio-aware correlation and fingerprinting
// Hybrid Persistence: PCA via DuckDB + Parquet data warehouse
// ============================================================

import { AlphaCandidate, DiversityMetrics, StylePremia, WQAlpha } from './types';
import { getDataWarehouse } from './persistence/data-warehouse';

interface AlphaFingerprint {
  fingerprint: string;
  expression: string;
  semanticEmbedding?: number[];
  category: string;
  style: StylePremia;
}

export class DiversityManager {
  private fingerprints: Map<string, AlphaFingerprint> = new Map();
  private alphaReturns: Map<string, number[]> = new Map(); // proxy returns
  private categoryCounts: Map<string, number> = new Map();
  private styleCounts: Map<string, number> = new Map();
  private maxCorrelation: number;
  private maxPerCategory: number;
  private maxPerStyle: number;
  // Correlation feedback rolling queue (last 10 rejections, show last 3)
  private correlationFeedbackQueue: Array<{
    expression: string;
    similarTo: string[];
    similarity: number;
    patternSignature: string;
    timestamp: number;
  }> = [];
  // Track WQ baseline alpha IDs for refresh replacement
  private wqBaselineAlphaIds: Set<string> = new Set();

  constructor(config: {
    maxCorrelation?: number;
    maxPerCategory?: number;
    maxPerStyle?: number;
  } = {}) {
    this.maxCorrelation = config.maxCorrelation || 0.7;
    this.maxPerCategory = config.maxPerCategory || 50;
    this.maxPerStyle = config.maxPerStyle || 30;
  }

  // --- Alpha Fingerprinting ---

  addFingerprint(fingerprint: string, expression: string, category: string, style: StylePremia): void {
    this.fingerprints.set(fingerprint, {
      fingerprint,
      expression,
      category,
      style,
    });

    // Update counts
    this.categoryCounts.set(category, (this.categoryCounts.get(category) || 0) + 1);
    this.styleCounts.set(style, (this.styleCounts.get(style) || 0) + 1);
  }

  isDuplicate(fingerprint: string): boolean {
    return this.fingerprints.has(fingerprint);
  }

  // --- Semantic Similarity ---

  computeSemanticSimilarity(expr1: string, expr2: string): number {
    // Simple Jaccard similarity on operator/field tokens
    const tokens1 = new Set(this.tokenize(expr1));
    const tokens2 = new Set(this.tokenize(expr2));

    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  isSemanticallyRedundant(expression: string, threshold: number = 0.85): boolean {
    const newTokens = new Set(this.tokenize(expression));

    for (const fp of this.fingerprints.values()) {
      const existingTokens = new Set(this.tokenize(fp.expression));
      const intersection = new Set([...newTokens].filter(t => existingTokens.has(t)));
      const union = new Set([...newTokens, ...existingTokens]);
      const similarity = union.size > 0 ? intersection.size / union.size : 0;

      if (similarity >= threshold) return true;
    }

    return false;
  }

  private tokenize(expr: string): string[] {
    // Extract operators and data fields as tokens
    const tokens: string[] = [];

    // Extract operators
    const opRegex = /\b([a-z_]+)\s*\(/g;
    let match;
    while ((match = opRegex.exec(expr)) !== null) {
      tokens.push(match[1]);
    }

    // Extract data fields (capitalized words not inside function calls)
    const fieldRegex = /\b([A-Z][a-zA-Z0-9_]+)\b/g;
    while ((match = fieldRegex.exec(expr)) !== null) {
      if (!match[1].match(/^[A-Z]+$/) || match[1].length > 3) { // Skip USA, GLB, etc
        tokens.push(match[1].toLowerCase());
      }
    }

    // Extract numeric patterns (lookback windows)
    const numRegex = /,\s*(\d+)\s*[),]/g;
    while ((match = numRegex.exec(expr)) !== null) {
      tokens.push(`n${match[1]}`);
    }

    return tokens;
  }

  // --- PCA-based Pre-Simulation Diversity ---

  addProxyReturns(fingerprint: string, returns: number[]): void {
    this.alphaReturns.set(fingerprint, returns);
  }

  computePCACoverage(newReturns: number[]): number {
    // Simple PCA coverage: check how much of new returns are explained by existing principal components
    const existingReturnArrays = Array.from(this.alphaReturns.values());
    if (existingReturnArrays.length < 3) return 1.0; // Not enough data, accept

    // Compute correlation with existing alphas
    const correlations = existingReturnArrays.map(existing => {
      return this.computeCorrelation(newReturns, existing);
    });

    // If top 3 correlations are too high, reject
    const sortedCorrs = correlations.sort((a, b) => Math.abs(b) - Math.abs(a));
    const top3AvgCorr = sortedCorrs.slice(0, 3).reduce((s, c) => s + Math.abs(c), 0) / Math.min(3, sortedCorrs.length);

    // Higher coverage = more explained by existing = less diverse
    return Math.min(1.0, top3AvgCorr);
  }

  isCorrelatedWithPortfolio(newReturns: number[], threshold?: number): boolean {
    const coverage = this.computePCACoverage(newReturns);
    return coverage >= (threshold || this.maxCorrelation);
  }

  private computeCorrelation(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    const n = a.length;
    const meanA = a.reduce((s, v) => s + v, 0) / n;
    const meanB = b.reduce((s, v) => s + v, 0) / n;

    let covAB = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      covAB += da * db;
      varA += da * da;
      varB += db * db;
    }

    const denom = Math.sqrt(varA * varB);
    return denom > 0 ? covAB / denom : 0;
  }

  /**
   * PCA-based Pre-Simulation Correlation Prediction.
   * Now uses in-memory Jaccard similarity against submitted WQ alphas
   * instead of DuckDB (which required static proxy data never populated).
   */
   async evaluateCandidateWithPCA(candidate: AlphaCandidate): Promise<{
     accepted: boolean;
     reasons: string[];
     diversityScore: number;
     pcaCoverage: number;
     pcaRecommendation: string;
     topMatches: Array<{ alphaId: string; similarity: number }>; // for feedback
   }> {
     // First run the in-memory diversity check
     const baseResult = this.evaluateCandidate(candidate);

     if (baseResult.accepted) {
       // Now run submitted-alpha correlation check
       const submittedResult = this.evaluateCandidateWithSubmittedAlphas(candidate);
       if (!submittedResult.accepted) {
         return {
           ...baseResult,
           accepted: false,
           reasons: [
             ...baseResult.reasons,
             `Correlated with submitted alphas (avg similarity: ${(submittedResult.averageSimilarity * 100).toFixed(1)}%)`,
           ],
           diversityScore: Math.max(0, 1 - submittedResult.averageSimilarity),
           pcaCoverage: submittedResult.averageSimilarity,
           pcaRecommendation: `Top matches: ${submittedResult.topMatches.map(m => `${m.alphaId.slice(0, 8)} (${(m.similarity * 100).toFixed(0)}%)`).join(', ')}`,
           topMatches: submittedResult.topMatches,
         };
       }

       return {
         ...baseResult,
         pcaCoverage: submittedResult.averageSimilarity,
         pcaRecommendation: `Low correlation with submitted alphas (avg: ${(submittedResult.averageSimilarity * 100).toFixed(1)}%)`,
         topMatches: submittedResult.topMatches,
       };
     }

     return {
       ...baseResult,
       pcaCoverage: 0,
       pcaRecommendation: 'PCA analysis not available',
       topMatches: [],
     };
   }

  /**
   * Load submitted alpha correlations from WQ BRAIN API.
   * Uses the user's active submitted alphas as the correlation baseline
   * instead of static DuckDB proxy data.
   *
   * On refresh calls (when wqBaselineAlphaIds is non-empty), replaces
   * the old baseline to avoid stale entries.
   */
  async loadSubmittedAlphaCorrelations(alphas: WQAlpha[]): Promise<void> {
    // If this is a refresh (baseline already loaded), clear old WQ baseline entries
    if (this.wqBaselineAlphaIds.size > 0) {
      for (const id of this.wqBaselineAlphaIds) {
        this.fingerprints.delete(id);
      }
      this.wqBaselineAlphaIds.clear();
    }

    // Add fresh baseline
    for (const alpha of alphas) {
      this.fingerprints.set(alpha.id, {
        fingerprint: alpha.id,
        expression: alpha.code,
        category: this.classifyCategory(alpha.code),
        style: this.classifyStyle(alpha.code),
      });
      this.wqBaselineAlphaIds.add(alpha.id);
    }
  }

  /**
   * Evaluate a candidate against the loaded submitted alphas using in-memory
   * Jaccard similarity. Replaces the DuckDB PCA approach which required
   * static proxy return data that was never populated.
   */
   evaluateCandidateWithSubmittedAlphas(candidate: AlphaCandidate): {
     accepted: boolean;
     averageSimilarity: number;
     topMatches: Array<{ alphaId: string; similarity: number }>;
   } {
     const similarities: Array<{ alphaId: string; similarity: number }> = [];

     for (const [alphaId, fp] of this.fingerprints) {
       // Skip self-matches (candidate fingerprint vs alpha fingerprint)
       if (alphaId === candidate.fingerprint) continue;

       const similarity = this.computeSemanticSimilarity(candidate.expression, fp.expression);
       similarities.push({ alphaId, similarity });
     }

     // Sort by similarity descending
     similarities.sort((a, b) => b.similarity - a.similarity);

     // Take top-3 matches for reporting
     const top3 = similarities.slice(0, 3);

     // Use MAX similarity (top match) for acceptance decision.
     // Average of top-3 can dilute a single high correlation and let it pass.
     const maxSimilarity = similarities.length > 0 ? similarities[0].similarity : 0;
     const accepted = maxSimilarity < this.maxCorrelation;

     return {
       accepted,
       // averageSimilarity field now holds max value (kept for compatibility)
       averageSimilarity: maxSimilarity,
       topMatches: top3.slice(0, 5),
     };
   }

  /**
   * Compute auto-correlation matrix for all tickers (via DuckDB).
   * Used for momentum signal quality assessment.
   */
  async computeAutoCorrelations(lag: number = 1): Promise<Array<{ ticker: string; auto_corr: number }>> {
    try {
      const warehouse = await getDataWarehouse();
      if (warehouse.isConnectedToWarehouse()) {
        const results = await warehouse.computeAutoCorrelations(lag);
        return results.map(r => ({ ticker: r.ticker, auto_corr: r.auto_corr_1d }));
      }
    } catch {
      // DuckDB not available
    }
    return [];
  }

  // --- Category and Style Budgets ---

  canAcceptCategory(category: string): boolean {
    const count = this.categoryCounts.get(category) || 0;
    return count < this.maxPerCategory;
  }

  canAcceptStyle(style: StylePremia): boolean {
    const count = this.styleCounts.get(style) || 0;
    return count < this.maxPerStyle;
  }

  // --- Overall Diversity Check ---

  evaluateCandidate(candidate: AlphaCandidate): {
    accepted: boolean;
    reasons: string[];
    diversityScore: number;
  } {
    const reasons: string[] = [];
    let score = 1.0;

    // Check fingerprint duplicate
    if (this.isDuplicate(candidate.fingerprint)) {
      reasons.push('Duplicate fingerprint detected');
      score -= 0.5;
    }

    // Check semantic redundancy
    if (this.isSemanticallyRedundant(candidate.expression)) {
      reasons.push('Semantically redundant with existing alpha');
      score -= 0.3;
    }

    // Categorize candidate
    const category = this.classifyCategory(candidate.expression);
    const style = this.classifyStyle(candidate.expression);

    // Check category budget
    if (!this.canAcceptCategory(category)) {
      reasons.push(`Category '${category}' budget exceeded (${this.maxPerCategory} max)`);
      score -= 0.2;
    }

    // Check style budget
    if (!this.canAcceptStyle(style)) {
      reasons.push(`Style '${style}' budget exceeded (${this.maxPerStyle} max)`);
      score -= 0.2;
    }

    return {
      accepted: reasons.length === 0,
      reasons,
      diversityScore: Math.max(0, score),
    };
  }

  private classifyCategory(expression: string): string {
    const lower = expression.toLowerCase();

    if (/fundamental|cashflow|revenue|earnings|debt|assets|equity/i.test(lower)) return 'Fundamental';
    if (/price|close|open|high|low|volume|returns/i.test(lower)) return 'Price-Volume';
    if (/news|sentiment|analyst|estimate|revision/i.test(lower)) return 'Sentiment-News';
    if (/model|score|rating/i.test(lower)) return 'Model-Based';
    if (/volatility|std_dev|skew|kurtosis/i.test(lower)) return 'Risk-Volatility';
    if (/sector|industry|group_|market/i.test(lower)) return 'Classification';

    return 'Other';
  }

  private classifyStyle(expression: string): StylePremia {
    const lower = expression.toLowerCase();

    if (/value|book|pe_ratio|pb_ratio|cashflow/i.test(lower)) return 'value';
    if (/momentum|ts_delta|ts_returns|ts_rank|trend/i.test(lower)) return 'momentum';
    if (/yield|dividend|carry/i.test(lower)) return 'carry';
    if (/defensive|low_vol|min|max_drawdown/i.test(lower)) return 'defensive';
    if (/sentiment|news|analyst/i.test(lower)) return 'sentiment';
    if (/volatility|std_dev|kurtosis|entropy/i.test(lower)) return 'volatility';
    if (/quality|earnings|accrual|roic/i.test(lower)) return 'quality';

    return 'momentum'; // default
  }

  // --- Metrics ---

  getMetrics(): DiversityMetrics {
    return {
      totalCandidates: this.fingerprints.size,
      acceptedCandidates: this.fingerprints.size,
      discardedDuplicates: 0, // tracked externally
      discardedCorrelated: 0, // tracked externally
      averagePairwiseCorrelation: this.computeAveragePairwiseCorrelation(),
      pcaCoverage: this.computeAggregateCoverage(),
      categoryDistribution: Object.fromEntries(this.categoryCounts),
      styleDistribution: Object.fromEntries(this.styleCounts),
    };
  }

  private computeAveragePairwiseCorrelation(): number {
    const returns = Array.from(this.alphaReturns.values());
    if (returns.length < 2) return 0;

    let totalCorr = 0;
    let count = 0;

    for (let i = 0; i < Math.min(returns.length, 50); i++) {
      for (let j = i + 1; j < Math.min(returns.length, 50); j++) {
        totalCorr += Math.abs(this.computeCorrelation(returns[i], returns[j]));
        count++;
      }
    }

    return count > 0 ? totalCorr / count : 0;
  }

  private computeAggregateCoverage(): number {
    const returns = Array.from(this.alphaReturns.values());
    if (returns.length < 3) return 1.0;
    return this.computeAveragePairwiseCorrelation();
  }

  getStyleCounts(): Record<string, number> {
    return Object.fromEntries(this.styleCounts);
  }

  getCategoryCounts(): Record<string, number> {
    return Object.fromEntries(this.categoryCounts);
  }

  // --- Correlation Feedback Loop (Rolling Summary) ---

  /**
   * Record a correlation rejection for use as LLM feedback.
   * Stores a distilled pattern signature (operators + data fields) without the full expression.
   */
  recordCorrelationRejection(
    candidate: AlphaCandidate,
    result: {
      pcaCoverage: number;
      topMatches: Array<{ alphaId: string; similarity: number }>;
    }
  ): void {
    const patternSignature = this.extractPatternSignature(candidate.expression);

    this.correlationFeedbackQueue.push({
      expression: candidate.expression,
      similarTo: result.topMatches.map(m => m.alphaId),
      similarity: result.pcaCoverage,
      patternSignature,
      timestamp: Date.now(),
    });

    // Keep last 10
    if (this.correlationFeedbackQueue.length > 10) {
      this.correlationFeedbackQueue.shift();
    }
  }

  /**
   * Extract a compact pattern signature from an expression.
   * Format: "op1+op2+op3 × field1+field2"
   * Purpose: Guide LLM away from correlated operator/field combinations without showing the exact expression.
   *
   * Extraction strategy:
   * - Operators: lowercase identifiers followed by '(' (e.g., rank, ts_delta)
   * - Data fields: other identifiers (e.g., close, volume, sector) that are not operators and not numbers.
   */
  extractPatternSignature(expression: string): string {
    // Extract operators (function names)
    const opRegex = /\b([a-z_][a-z0-9_]*)\s*\(/g;
    const operators: string[] = [];
    let match;
    while ((match = opRegex.exec(expression)) !== null) {
      operators.push(match[1]);
    }

    // Extract all word tokens
    const allWords = expression.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g) || [];
    const fieldsSet = new Set<string>();
    for (const word of allWords) {
      // Skip if it's an operator
      if (operators.includes(word)) continue;
      // Skip numeric literals
      if (/^\d+$/.test(word)) continue;
      // Accept as data field (lowercase for consistency)
      fieldsSet.add(word.toLowerCase());
    }
    const fields = Array.from(fieldsSet).slice(0, 3);

    const opPart = operators.slice(0, 3).join('+');
    const fieldPart = fields.slice(0, 3).join('+');

    if (opPart && fieldPart) {
      return `${opPart} × ${fieldPart}`;
    }
    return opPart || fieldPart;
  }

  /**
   * Return a compact summary of recent correlation rejections for LLM prompts.
   * Example output:
   *   ## Recent Correlation Rejections (avoid these operator+field patterns):
   *   Pattern: [rank+ts_std_dev × volume+sector] → 87% correlation
   *   Pattern: [ts_mean+ts_rank × close+industry] → 82% correlation
   */
  getCorrelationSummary(): string {
    if (this.correlationFeedbackQueue.length === 0) return '';

    const recent = this.correlationFeedbackQueue.slice(-3); // last 3
    const lines = recent.map(r =>
      `Pattern: [${r.patternSignature}] → ${(r.similarity * 100).toFixed(0)}% correlation`
    );

    return `\n## Recent Correlation Rejections (avoid these operator+field patterns):\n${lines.join('\n')}`;
  }

  // --- Pairwise Correlation Matrix for Living Alphas ---

  computePairwiseCorrelations(alphas: WQAlpha[]): Map<string, Map<string, number>> {
    const matrix = new Map<string, Map<string, number>>();

    for (let i = 0; i < alphas.length; i++) {
      matrix.set(alphas[i].id, new Map());
      for (let j = 0; j < alphas.length; j++) {
        if (i === j) {
          matrix.get(alphas[i].id)!.set(alphas[j].id, 1.0);
        } else {
          // Use sharpe-based correlation as proxy (actual would need return data)
          const corr = Math.abs(alphas[i].sharpe * alphas[j].sharpe) / 
                       (Math.abs(alphas[i].sharpe) + Math.abs(alphas[j].sharpe) + 0.001);
          matrix.get(alphas[i].id)!.set(alphas[j].id, corr);
        }
      }
    }

    return matrix;
  }

  reset(): void {
    this.fingerprints.clear();
    this.alphaReturns.clear();
    this.categoryCounts.clear();
    this.styleCounts.clear();
    this.correlationFeedbackQueue = [];
    this.wqBaselineAlphaIds.clear();
  }
}
