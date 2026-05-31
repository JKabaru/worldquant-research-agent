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
  structuralFingerprint?: StructuralFingerprint;
  skeleton?: string;
}

interface StructuralFingerprint {
  pattern: string;
  operators: string[];
  fields: string[];
  arity: string;
  operatorSequence: string[];
  fieldTransforms: Record<string, string[]>;
  operatorCategories: Record<string, string>;
}

const OPERATOR_CATEGORIES: Record<string, string> = {
  rank: 'normalization',
  ts_rank: 'normalization',
  normalize: 'normalization',
  zscore: 'normalization',
  scale: 'normalization',
  quantile: 'normalization',
  ts_mean: 'aggregation',
  ts_std_dev: 'aggregation',
  ts_sum: 'aggregation',
  ts_product: 'aggregation',
  ts_delta: 'difference',
  ts_delay: 'delay',
  ts_decay_linear: 'decay',
  ts_decay_exp: 'decay',
  ts_zscore: 'normalization',
  ts_scale: 'normalization',
  ts_corr: 'correlation',
  ts_covariance: 'correlation',
  ts_arg_max: 'extreme',
  ts_arg_min: 'extreme',
  ts_backfill: 'fill',
  ts_regression: 'regression',
  group_neutralize: 'group',
  group_rank: 'group',
  group_zscore: 'group',
  group_mean: 'group',
  group_scale: 'group',
  group_backfill: 'group',
  signed_power: 'transform',
  power: 'transform',
  abs: 'transform',
  log: 'transform',
  sqrt: 'transform',
  trade_when: 'conditional',
  if_else: 'conditional',
  bucket: 'bucket',
  vec_avg: 'vector',
  vec_sum: 'vector',
  winsorize: 'normalization',
  ts_quantile: 'normalization',
};

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
    behavioralCategory: string;
    failureReason: string;
    similarity: number;
    timestamp: number;
  }> = [];
  private clusterCounter = 0;
  private alphaToCluster: Map<string, string> = new Map();
  // Track WQ baseline alpha IDs for refresh replacement
  private wqBaselineAlphaIds: Set<string> = new Set();
  private submittedBaselineIds: Set<string> = new Set();
  // Hard blacklist for expression signatures that slipped through and later proved too correlated.
  private blacklistedPatternSignatures: Set<string> = new Set();

  constructor(config: {
    maxCorrelation?: number;
    maxPerCategory?: number;
    maxPerStyle?: number;
  } = {}) {
    this.maxCorrelation = config.maxCorrelation || 0.35;
    this.maxPerCategory = config.maxPerCategory || 50;
    this.maxPerStyle = config.maxPerStyle || 30;
  }

  setMaxCorrelation(threshold: number): void {
    if (!Number.isFinite(threshold)) return;
    this.maxCorrelation = Math.min(0.8, Math.max(0.1, threshold));
  }

  // --- Alpha Fingerprinting ---

  addFingerprint(fingerprint: string, expression: string, category: string, style: StylePremia): void {
    const structuralFingerprint = this.extractStructuralFingerprint(expression);
    this.fingerprints.set(fingerprint, {
      fingerprint,
      expression,
      category,
      style,
      structuralFingerprint,
      skeleton: this.extractOperatorSkeleton(expression),
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
    // Extract operators, data fields and window constants as tokens.
    const tokens: string[] = [];
    const opNames = new Set<string>();

    // Extract operators
    const opRegex = /\b([a-z_]+)\s*\(/g;
    let match;
    while ((match = opRegex.exec(expr)) !== null) {
      const op = match[1].toLowerCase();
      opNames.add(op);
      tokens.push(`op:${op}`);
    }

    // Extract identifiers used as fields (mostly lowercase FASTEXPR fields).
    const fieldRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const skip = new Set(['true', 'false', 'nan', 'none', 'and', 'or', 'not']);
    while ((match = fieldRegex.exec(expr)) !== null) {
      const ident = match[1].toLowerCase();
      if (skip.has(ident)) continue;
      if (opNames.has(ident)) continue;
      if (/^\d+$/.test(ident)) continue;
      tokens.push(`field:${ident}`);
    }

    // Extract numeric patterns (lookback windows)
    const numRegex = /,\s*(\d+)\s*[),]/g;
    while ((match = numRegex.exec(expr)) !== null) {
      tokens.push(`win:${match[1]}`);
    }

    return tokens;
  }

  private jaccardSimilarity<T>(a: Iterable<T>, b: Iterable<T>): number {
    const setA = new Set(a);
    const setB = new Set(b);
    if (setA.size === 0 && setB.size === 0) return 0;
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
  }

  private normalizeExpressionForComparison(expression: string): string {
    return expression
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/\d+(\.\d+)?/g, 'N')
      .replace(/"[^"]*"/g, '"S"')
      .replace(/'[^']*'/g, "'S'");
  }

  /**
   * Extract a canonical operator skeleton from an expression by:
   * 1. Stripping all field names → F
   * 2. Replacing all numeric literals → N
   * 3. Sorting top-level * operands (commutative invariance)
   * This captures the strategy PATTERN without being fooled by different field names.
   */
  private extractOperatorSkeleton(expression: string): string {
    const lower = expression.toLowerCase().replace(/\s+/g, '');
    let skeleton = lower.replace(/\d+(\.\d+)?/g, 'N');

    // Identify all unique operator names (identifiers followed by '(')
    const opRegex = /\b([a-z_][a-z0-9_]*)\s*\(/g;
    const operatorNames = new Set<string>();
    let match;
    while ((match = opRegex.exec(skeleton)) !== null) {
      operatorNames.add(match[1]);
    }

    // Replace all non-operator identifiers with F
    const skip = new Set(['true', 'false', 'nan', 'none', 'and', 'or', 'not', 'inf']);
    const identRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    skeleton = skeleton.replace(identRegex, (ident) => {
      const lowerIdent = ident.toLowerCase();
      if (operatorNames.has(lowerIdent)) return ident;
      if (skip.has(lowerIdent)) return ident;
      if (/^\d+$/.test(lowerIdent)) return ident;
      return 'F';
    });

    // Sort top-level * terms for commutativity: A*B*C → A*B*C (same regardless of original order)
    const terms: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < skeleton.length; i++) {
      const ch = skeleton[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0 && ch === '*') {
        terms.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) terms.push(current);
    terms.sort();

    return terms.join('*');
  }

  private trigramDiceSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const grams = (s: string): string[] => {
      if (s.length < 3) return [s];
      const out: string[] = [];
      for (let i = 0; i <= s.length - 3; i++) out.push(s.slice(i, i + 3));
      return out;
    };
    const ga = grams(a);
    const gb = grams(b);
    const counts = new Map<string, number>();
    for (const g of ga) counts.set(g, (counts.get(g) || 0) + 1);
    let shared = 0;
    for (const g of gb) {
      const c = counts.get(g) || 0;
      if (c > 0) {
        shared += 1;
        counts.set(g, c - 1);
      }
    }
    return (2 * shared) / (ga.length + gb.length);
  }

  // --- Structural Fingerprint (Phase 1) ---

  extractStructuralFingerprint(expression: string): StructuralFingerprint {
    const operators: string[] = [];
    const fields: string[] = [];
    const operatorSequence: string[] = [];
    const fieldTransforms: Record<string, string[]> = {};
    const operatorCategories: Record<string, string> = {};

    const opRegex = /\b([a-z_][a-z0-9_]*)\s*\(/g;
    let match;
    const stack: string[] = [];
    while ((match = opRegex.exec(expression)) !== null) {
      const op = match[1];
      operators.push(op);
      operatorSequence.push(op);
      operatorCategories[op] = OPERATOR_CATEGORIES[op] || 'custom';
      stack.push(op);
    }

    const fieldRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const operatorSet = new Set(operators.map(o => o.toLowerCase()));
    while ((match = fieldRegex.exec(expression)) !== null) {
      const token = match[1].toLowerCase();
      if (operatorSet.has(token)) continue;
      if (/^\d+$/.test(token)) continue;
      if (['true', 'false', 'nan', 'none', 'and', 'or', 'not'].includes(token)) continue;
      const field = token;
      if (!fields.includes(field)) fields.push(field);
      const currentOp = stack[stack.length - 1];
      if (currentOp) {
        if (!fieldTransforms[currentOp]) fieldTransforms[currentOp] = [];
        if (!fieldTransforms[currentOp].includes(field)) {
          fieldTransforms[currentOp].push(field);
        }
      }
    }

    const arity = this.detectArityDynamic(operatorSequence);
    const pattern = this.generatePatternSignatureDynamic(expression, operators);

    return {
      pattern,
      operators: [...new Set(operators)],
      fields: [...new Set(fields)],
      arity,
      operatorSequence,
      fieldTransforms,
      operatorCategories,
    };
  }

  private detectArityDynamic(operatorSequence: string[]): string {
    const hasBinaryOp = (expr: string): boolean => {
      return /[*+/-]/.test(expr);
    };
    
    const hasMultipleRanks = operatorSequence.filter(op => 
      op === 'rank' || op === 'ts_rank'
    ).length >= 2;

    if (hasMultipleRanks || operatorSequence.length >= 2) {
      return 'binary_combine';
    }
    return 'unary_chain';
  }

  private generatePatternSignatureDynamic(expression: string, operators: string[]): string {
    let sig = expression;

    const uniqueOps = [...new Set(operators)];
    // Sort longest-first so nested operators are replaced inner-first
    uniqueOps.sort((a, b) => b.length - a.length);

    for (const op of uniqueOps) {
      const opLower = op.toLowerCase();
      const searchRegex = new RegExp(`${opLower}\\s*\\(`, 'gi');

      // Collect all match positions, process right-to-left to avoid index shifting
      const positions: number[] = [];
      let m;
      while ((m = searchRegex.exec(sig)) !== null) {
        positions.push(m.index);
      }
      positions.sort((a, b) => b - a);

      for (const startIdx of positions) {
        const parenIdx = sig.indexOf('(', startIdx);
        if (parenIdx === -1) continue;

        // Find matching close paren with depth tracking (handles nested calls)
        let depth = 1;
        let i = parenIdx + 1;
        while (i < sig.length && depth > 0) {
          if (sig[i] === '(') depth++;
          else if (sig[i] === ')') depth--;
          if (depth > 0) i++;
        }
        if (depth === 0) {
          sig = sig.slice(0, startIdx) + op.toUpperCase() + '(X)' + sig.slice(i + 1);
        }
      }
    }

    sig = sig.replace(/volume/gi, 'VOL');
    sig = sig.replace(/returns/gi, 'RET');
    sig = sig.replace(/price/gi, 'PRC');
    sig = sig.replace(/close/gi, 'CLOSE');
    sig = sig.replace(/open/gi, 'OPEN');
    sig = sig.replace(/high/gi, 'HIGH');
    sig = sig.replace(/low/gi, 'LOW');
    sig = sig.replace(/\b[A-Z][a-zA-Z0-9_]+\b/g, (m) => m.length <= 3 ? m : 'FIELD');
    sig = sig.replace(/\d+/g, 'N');
    sig = sig.replace(/\s+/g, ' ').trim();
    
    return sig;
  }

  computeStructuralSimilarity(fp1: StructuralFingerprint, fp2: StructuralFingerprint): number {
    const opSet1 = new Set(fp1.operators);
    const opSet2 = new Set(fp2.operators);
    const opIntersection = [...opSet1].filter(o => opSet2.has(o));
    const opUnion = new Set([...fp1.operators, ...fp2.operators]);
    const opScore = opUnion.size > 0 ? opIntersection.length / opUnion.size : 0;

    const categories1 = new Set(Object.values(fp1.operatorCategories));
    const categories2 = new Set(Object.values(fp2.operatorCategories));
    const catIntersection = [...categories1].filter(c => categories2.has(c));
    const catUnion = new Set([...categories1, ...categories2]);
    const catScore = catUnion.size > 0 ? catIntersection.length / catUnion.size : 0;

    const fieldSet1 = new Set(fp1.fields);
    const fieldSet2 = new Set(fp2.fields);
    const fieldIntersection = [...fieldSet1].filter(f => fieldSet2.has(f));
    const fieldUnion = new Set([...fp1.fields, ...fp2.fields]);
    const fieldScore = fieldUnion.size > 0 ? fieldIntersection.length / fieldUnion.size : 0;

    let patternBonus = 0;
    if (fp1.arity === fp2.arity && fp1.arity !== 'unary_chain') {
      patternBonus = 0.15;
    }

    if (opScore >= 0.6 && fieldScore >= 0.6) {
      return Math.min(1.0, opScore * 0.35 + catScore * 0.2 + fieldScore * 0.3 + patternBonus);
    }

    return opScore * 0.3 + catScore * 0.2 + fieldScore * 0.5;
  }

  // --- PCA-based Pre-Simulation Diversity ---

  addProxyReturns(fingerprint: string, returns: number[]): void {
    this.alphaReturns.set(fingerprint, returns);
  }

  computePCACoverage(newReturns: number[]): number {
    const existingReturnArrays = Array.from(this.alphaReturns.values());
    if (existingReturnArrays.length < 3) return 1.0;

    const multiMetrics = existingReturnArrays.map(existing => {
      return this.computeMultiMetricCorrelation(newReturns, existing);
    });

    const combinedScores = multiMetrics.map(m => {
      const combined = (Math.abs(m.pearson) * 0.3) +
        (Math.abs(m.spearman) * 0.3) +
        (m.maxRolling * 0.25) +
        (m.avgRolling * 0.15);
      return combined * (0.5 + m.stability * 0.5);
    });

    combinedScores.sort((a, b) => b - a);
    const top3Avg = combinedScores.slice(0, 3).reduce((s, c) => s + c, 0) / Math.min(3, combinedScores.length);

    return Math.min(1.0, top3Avg);
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

  private computeSpearmanCorrelation(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length < 4) return 0;

    const rank = (arr: number[]): number[] => {
      const sorted = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
      const ranks = new Array(arr.length);
      for (let i = 0; i < sorted.length; ) {
        let j = i;
        while (j < sorted.length && sorted[j].v === sorted[i].v) j++;
        const r = (i + j + 1) / 2;
        for (let k = i; k < j; k++) ranks[sorted[k].i] = r;
        i = j;
      }
      return ranks;
    };

    const rankA = rank(a);
    const rankB = rank(b);
    return this.computeCorrelation(rankA, rankB);
  }

  private computeRollingCorrelation(a: number[], b: number[], windowSize: number = 30): number[] {
    if (a.length !== b.length || a.length < windowSize * 2) return [0];

    const correlations: number[] = [];
    for (let i = 0; i <= a.length - windowSize; i++) {
      const sliceA = a.slice(i, i + windowSize);
      const sliceB = b.slice(i, i + windowSize);
      correlations.push(this.computeCorrelation(sliceA, sliceB));
    }
    return correlations;
  }

  private computeMultiMetricCorrelation(a: number[], b: number[]): {
    pearson: number;
    spearman: number;
    maxRolling: number;
    avgRolling: number;
    stability: number;
  } {
    const pearson = this.computeCorrelation(a, b);
    const spearman = this.computeSpearmanCorrelation(a, b);
    const rolling = this.computeRollingCorrelation(a, b, Math.min(30, Math.floor(a.length / 3)));

    const maxRolling = rolling.length > 0 ? Math.max(...rolling.map(r => Math.abs(r))) : 0;
    const avgRolling = rolling.length > 0 ? rolling.reduce((s, r) => s + Math.abs(r), 0) / rolling.length : 0;

    let stability = 1;
    if (rolling.length > 1) {
      const mean = avgRolling;
      const variance = rolling.reduce((s, r) => s + Math.pow(Math.abs(r) - mean, 2), 0) / rolling.length;
      const std = Math.sqrt(variance);
      stability = Math.max(0, Math.min(1, 1 - std / (Math.abs(mean) + 0.001)));
    }

    return { pearson, spearman, maxRolling, avgRolling, stability };
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
     topMatches: Array<{ clusterId: string; similarity: number }>;
   }> {
     const baseResult = this.evaluateCandidate(candidate);

     if (baseResult.accepted) {
       const submittedResult = this.evaluateCandidateWithSubmittedAlphas(candidate);
       if (!submittedResult.accepted) {
         return {
           ...baseResult,
           accepted: false,
           reasons: [
             ...baseResult.reasons,
             submittedResult.rejectionReason || 'Rejected by submitted-alpha similarity guard',
             `Correlated with existing portfolio patterns (avg: ${(submittedResult.averageSimilarity * 100).toFixed(1)}%)`,
           ],
           diversityScore: Math.max(0, 1 - submittedResult.averageSimilarity),
           pcaCoverage: submittedResult.averageSimilarity,
           pcaRecommendation: `Similar to ${submittedResult.topMatches.map(m => `${m.clusterId} (${(m.similarity * 100).toFixed(0)}%)`).join(', ')}`,
           topMatches: submittedResult.topMatches,
         };
       }

       return {
         ...baseResult,
         pcaCoverage: submittedResult.averageSimilarity,
         pcaRecommendation: `Low correlation with portfolio (avg: ${(submittedResult.averageSimilarity * 100).toFixed(1)}%)`,
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
    if (this.wqBaselineAlphaIds.size > 0) {
      for (const id of this.wqBaselineAlphaIds) {
        this.fingerprints.delete(id);
      }
      this.wqBaselineAlphaIds.clear();
    }
    this.submittedBaselineIds.clear();

    for (const alpha of alphas) {
      this.fingerprints.set(alpha.id, {
        fingerprint: alpha.id,
        expression: alpha.code,
        category: this.classifyCategory(alpha.code),
        style: this.classifyStyle(alpha.code),
        structuralFingerprint: this.extractStructuralFingerprint(alpha.code),
        skeleton: this.extractOperatorSkeleton(alpha.code),
      });
      this.wqBaselineAlphaIds.add(alpha.id);
      this.submittedBaselineIds.add(alpha.id);
    }
  }

/**
    * Evaluate a candidate against ALL known fingerprints (submitted + in-session) using a HARD,
    * FIXED correlation threshold. One-by-one check with TWO metrics:
    * 1) Raw composite similarity (operators + fields + structure)
    * 2) Operator-skeleton trigram similarity (field-stripped + commutative sort)
    * If EITHER metric exceeds the hard limit for ANY single fingerprint, reject immediately.
    */
   evaluateCandidateWithSubmittedAlphas(candidate: AlphaCandidate): {
     accepted: boolean;
     averageSimilarity: number;
     topMatches: Array<{ clusterId: string; similarity: number }>;
     rejectionReason?: string;
   } {
     const similarities: Array<{ alphaId: string; clusterId: string; similarity: number }> = [];
     const hardThreshold = this.maxCorrelation;

     if (this.submittedBaselineIds.size === 0) {
       return {
         accepted: false,
         averageSimilarity: 1,
         topMatches: [],
         rejectionReason: 'Submitted-alpha baseline unavailable; refusing to simulate without correlation reference set',
       };
     }

     const candidateSkeleton = this.extractOperatorSkeleton(candidate.expression);
     const candidateStructural = this.extractStructuralFingerprint(candidate.expression);
     const normalizedCandidate = this.normalizeExpressionForComparison(candidate.expression);

     // Check against ALL known fingerprints (submitted WQ alphas + in-session accepted alphas)
     for (const [fpKey, fp] of this.fingerprints) {
       if (!fp) continue;
       if (fp.fingerprint === candidate.fingerprint) continue;

       // --- Raw composite similarity (operator tokens + field tokens + structure) ---
       const semantic = this.computeSemanticSimilarity(candidate.expression, fp.expression);
       const structural = fp.structuralFingerprint
         ? this.computeStructuralSimilarity(candidateStructural, fp.structuralFingerprint)
         : 0;
       const candidateOps = candidateStructural.operators;
       const baselineOps = fp.structuralFingerprint?.operators || [];
       const candidateFields = candidateStructural.fields;
       const baselineFields = fp.structuralFingerprint?.fields || [];
       const operatorOverlap = this.jaccardSimilarity(candidateOps, baselineOps);
       const fieldOverlap = this.jaccardSimilarity(candidateFields, baselineFields);

       const similarity = Math.min(
         1,
         semantic * 0.4 +
         structural * 0.3 +
         operatorOverlap * 0.15 +
         fieldOverlap * 0.15
       );

       // --- Operator-skeleton similarity (field-stripped + commutative sort) ---
       // Catches same-strategy-different-fields patterns
       const fpSkeleton = fp.skeleton || this.extractOperatorSkeleton(fp.expression);
       const skeletonSimilarity = this.trigramDiceSimilarity(candidateSkeleton, fpSkeleton);

       // Use the maximum of raw and skeleton similarity — either one can flag correlation
       const maxSimilarity = Math.max(similarity, skeletonSimilarity);

       const clusterId = this.getOrCreateClusterId(fpKey);

       // ONE-BY-ONE hard check: if ANY single fingerprint exceeds the hard limit, reject immediately
       if (maxSimilarity >= hardThreshold) {
         const reasonMetric = skeletonSimilarity > similarity ? 'operator-skeleton' : 'raw-composite';
         return {
           accepted: false,
           averageSimilarity: maxSimilarity,
           topMatches: [{ clusterId, similarity: maxSimilarity }],
           rejectionReason:
             `Correlated with ${clusterId} (${(maxSimilarity * 100).toFixed(1)}% via ${reasonMetric}) — hard limit is ${(hardThreshold * 100).toFixed(1)}%`,
         };
       }

       similarities.push({ alphaId: fpKey, clusterId, similarity: maxSimilarity });
     }

     similarities.sort((a, b) => b.similarity - a.similarity);

     return {
       accepted: true,
       averageSimilarity: similarities.length > 0 ? similarities[0].similarity : 0,
       topMatches: similarities.slice(0, 3).map(s => ({ clusterId: s.clusterId, similarity: s.similarity })),
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

    // Hard blacklist check for previously rejected near-duplicate signatures.
    const patternSignature = this.extractPatternSignature(candidate.expression);
    if (this.blacklistedPatternSignatures.has(patternSignature)) {
      reasons.push('Pattern signature is blacklisted due to prior high-correlation rejection');
      score -= 0.8;
    }

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

    // Check operator-skeleton redundancy against all fingerprints using hard threshold
    const candidateSkeleton = this.extractOperatorSkeleton(candidate.expression);
    for (const [, fp] of this.fingerprints) {
      if (!fp || fp.fingerprint === candidate.fingerprint) continue;
      const fpSkeleton = fp.skeleton || this.extractOperatorSkeleton(fp.expression);
      const skelSim = this.trigramDiceSimilarity(candidateSkeleton, fpSkeleton);
      if (skelSim >= this.maxCorrelation) {
        reasons.push(`Operator-skeleton correlated (${(skelSim * 100).toFixed(1)}%) — hard limit ${(this.maxCorrelation * 100).toFixed(1)}%`);
        score -= 0.3;
        break;
      }
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
   * Uses behavioral categories instead of alpha IDs to prevent leaking.
   */
  recordCorrelationRejection(
    candidate: AlphaCandidate,
    result: {
      pcaCoverage: number;
      topMatches: Array<{ clusterId: string; similarity: number }>;
    }
  ): void {
    const behavioralCategory = this.determineBehavioralCategory(candidate.expression);
    const failureReason = this.determineFailureReason(candidate);

    this.correlationFeedbackQueue.push({
      behavioralCategory,
      failureReason,
      similarity: result.pcaCoverage,
      timestamp: Date.now(),
    });

    if (this.correlationFeedbackQueue.length > 10) {
      this.correlationFeedbackQueue.shift();
    }
  }

  private determineBehavioralCategory(expression: string): string {
    const lower = expression.toLowerCase();
    const structural = this.extractStructuralFingerprint(expression);
    const ops = new Set(structural.operators.map(o => o.toLowerCase()));

    if (ops.has('ts_rank') || ops.has('rank') || ops.has('quantile')) {
      return 'rank_based';
    }
    if (ops.has('ts_delta') || ops.has('ts_returns')) {
      return 'momentum_timing';
    }
    if (ops.has('ts_mean') || ops.has('ts_std_dev') || ops.has('ts_sum')) {
      return 'aggregation';
    }
    if (ops.has('group_neutralize') || ops.has('group_zscore')) {
      return 'group_normalized';
    }
    if (ops.has('ts_corr') || ops.has('ts_covariance')) {
      return 'cross_correlation';
    }
    if (/volume|close|price|returns/i.test(lower)) {
      return 'price_volume_driven';
    }
    if (/sentiment|news|analyst/i.test(lower)) {
      return 'sentiment_driven';
    }

    return 'structural';
  }

  private determineFailureReason(candidate: AlphaCandidate): string {
    const structural = this.extractStructuralFingerprint(candidate.expression);
    const candidateOps = new Set(structural.operators.map(o => o.toLowerCase()));
    const candidateFields = new Set(structural.fields.map(f => f.toLowerCase()));

    if (candidateOps.size <= 1) {
      return 'single_operator_repetition';
    }
    if (candidateFields.size === 1) {
      return 'same_data_field_dependency';
    }
    if (candidateOps.has('rank') && candidateOps.has('ts_rank')) {
      return 'redundant_normalization';
    }
    if (candidateOps.has('ts_mean') && candidateOps.has('ts_delta')) {
      return 'mean_reversion_timing';
    }

    return 'operator_field_pattern_match';
  }

  getOrCreateClusterId(alphaId: string): string {
    if (!this.alphaToCluster.has(alphaId)) {
      this.clusterCounter++;
      const clusterLetter = String.fromCharCode(65 + (this.clusterCounter - 1) % 26);
      this.alphaToCluster.set(alphaId, `Cluster-${clusterLetter}`);
    }
    return this.alphaToCluster.get(alphaId)!;
  }

  /**
   * Extract a categorized structural signature from an expression.
   * Format: "S{2ts+2cs}×D{fundamental+price/vol}"
   * Purpose: Guide LLM toward successful operator-category × data-domain combinations
   * without exposing the exact expression.
   *
   * Extraction strategy:
   * - Operators are classified into categories (time-series, cross-sectional, group, control flow, vector)
   * - Data fields are classified into domains (fundamental, price/vol, analyst, news/sentiment, options, universe)
   * - Output is a count of unique operators per category × detected data domains
   */
  extractPatternSignature(expression: string): string {
    const timeSeriesOps = new Set(['ts_delta','ts_mean','ts_decay_linear','ts_rank','ts_zscore','ts_regression','ts_delay','ts_backfill','ts_std_dev','ts_skewness','ts_kurtosis','ts_entropy','ts_moment','ts_av_diff','ts_ir','ts_returns','ts_min','ts_arg_max','ts_arg_min','ts_sum','ts_corr']);
    const crossSectionalOps = new Set(['rank','zscore','normalize','winsorize','scale']);
    const groupOps = new Set(['group_rank','group_neutralize','group_zscore','group_backfill','group_mean']);
    const controlFlowOps = new Set(['trade_when','if_else','bucket','hump','signed_power','sigmoid','power']);
    const vectorOps = new Set(['vec_avg','vec_count','vec_sum']);

    const opRegex = /\b([a-z_][a-z0-9_]*)\s*\(/g;
    const operators: string[] = [];
    let match;
    while ((match = opRegex.exec(expression)) !== null) {
      operators.push(match[1]);
    }

    const uniqueOps = [...new Set(operators)];
    let tsCount = 0, csCount = 0, gCount = 0, cfCount = 0;
    for (const op of uniqueOps) {
      if (timeSeriesOps.has(op)) tsCount++;
      else if (crossSectionalOps.has(op)) csCount++;
      else if (groupOps.has(op)) gCount++;
      else if (controlFlowOps.has(op)) cfCount++;
    }

    const parts: string[] = [];
    if (tsCount > 0) parts.push(`${tsCount}ts`);
    if (csCount > 0) parts.push(`${csCount}cs`);
    if (gCount > 0) parts.push(`${gCount}grp`);
    if (cfCount > 0) parts.push(`${cfCount}cf`);

    // Detect data domains
    const fieldDomains: string[] = [];
    const lower = expression.toLowerCase();
    if (/\b(cashflow_op|assets|debt_lt|ebit|capex|sharesout|sales_growth|revenue|earnings|book_value|roe|gross_margin|enterprise_value|operating_income|accruals|retained_earnings|interest_expense|ebitda|pe_ratio|pb_ratio)\b/.test(lower))
      fieldDomains.push('fundamental');
    if (/\b(close|open|high|low|volume|returns|vwap|adv20)\b/.test(lower))
      fieldDomains.push('price/vol');
    if (/\b(cap|market|sector|industry|subindustry)\b/.test(lower))
      fieldDomains.push('universe');
    if (/\b(est_eps|etz_eps|est_cashflow_op|est_capex)\b/.test(lower))
      fieldDomains.push('analyst');
    if (/\b(news_pct|news_max|nws12|scl15|scl12)\b/.test(lower))
      fieldDomains.push('news/sentiment');
    if (/\b(implied_volatility|pcr_oi)\b/.test(lower))
      fieldDomains.push('options');

    const opDesc = parts.join('+') || `${uniqueOps.slice(0, 2).join('+')}`;
    const fieldDesc = fieldDomains.join('+') || 'mixed';

    return `S{${opDesc}}×D{${fieldDesc}}`;
  }

/**
    * Return a compact summary of recent correlation rejections for LLM prompts.
    * Uses behavioral categories only - no alpha IDs or operator details exposed.
    */
  getCorrelationSummary(): string {
    if (this.correlationFeedbackQueue.length === 0) return '';

    const recent = this.correlationFeedbackQueue.slice(-3);
    const lines = recent.map(r => {
      const categoryLabel = this.getBehavioralCategoryLabel(r.behavioralCategory);
      const reasonLabel = this.getFailureReasonLabel(r.failureReason);
      return `${categoryLabel} pattern (${reasonLabel}) — ${(r.similarity * 100).toFixed(0)}% similarity`;
    });

    return `\n## Recent Correlation Rejections:\n${lines.join('\n')}\nTry different behavioral patterns.`;
  }

  private getBehavioralCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      rank_based: 'Rank-based',
      momentum_timing: 'Momentum timing',
      aggregation: 'Time-series aggregation',
      group_normalized: 'Group-normalized',
      cross_correlation: 'Cross-correlation',
      price_volume_driven: 'Price/volume-driven',
      sentiment_driven: 'Sentiment-driven',
      structural: 'Structural',
    };
    return labels[category] || 'Mixed';
  }

  private getFailureReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      single_operator_repetition: 'repeated operator',
      same_data_field_dependency: 'same data field',
      redundant_normalization: 'redundant normalization',
      mean_reversion_timing: 'mean-reversion timing',
      operator_field_pattern_match: 'similar operator-field pattern',
    };
    return labels[reason] || 'pattern match';
  }

  blacklistExpressionPattern(expression: string): string {
    const signature = this.extractPatternSignature(expression);
    if (signature) {
      this.blacklistedPatternSignatures.add(signature);
    }
    return signature;
  }

  hasSubmittedBaseline(): boolean {
    return this.submittedBaselineIds.size > 0;
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
    this.blacklistedPatternSignatures.clear();
  }
}
