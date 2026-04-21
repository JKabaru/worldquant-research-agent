// ============================================================
// Alpha Expression Validator (Inner Loop) - AST-Lite validation
// ============================================================

import { InnerLoopResult, WQOperator } from './types';

interface OperatorDef {
  name: string;
  minArgs: number;
  maxArgs: number;
  category: string;
  requiresEventInput?: boolean;
}

// Known operators with their arity requirements
const OPERATOR_REGISTRY: Record<string, OperatorDef> = {
  // Cross-Sectional
  'rank': { name: 'rank', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'zscore': { name: 'zscore', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'normalize': { name: 'normalize', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'scale_down': { name: 'scale_down', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'quantile': { name: 'quantile', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'reverse': { name: 'reverse', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'inverse': { name: 'inverse', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'log': { name: 'log', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'sqrt': { name: 'sqrt', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'sigmoid': { name: 'sigmoid', minArgs: 1, maxArgs: 1, category: 'Cross Sectional' },
  'signed_power': { name: 'signed_power', minArgs: 2, maxArgs: 2, category: 'Cross Sectional' },
  // Time Series
  'ts_rank': { name: 'ts_rank', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_zscore': { name: 'ts_zscore', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_delta': { name: 'ts_delta', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_sum': { name: 'ts_sum', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_mean': { name: 'ts_mean', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_std_dev': { name: 'ts_std_dev', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_ir': { name: 'ts_ir', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_min': { name: 'ts_min', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_max': { name: 'ts_max', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_arg_min': { name: 'ts_arg_min', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_arg_max': { name: 'ts_arg_max', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_min_diff': { name: 'ts_min_diff', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_max_diff': { name: 'ts_max_diff', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_returns': { name: 'ts_returns', minArgs: 1, maxArgs: 1, category: 'Time Series' },
  'ts_scale': { name: 'ts_scale', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_skewness': { name: 'ts_skewness', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_kurtosis': { name: 'ts_kurtosis', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_quantile': { name: 'ts_quantile', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_moment': { name: 'ts_moment', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_entropy': { name: 'ts_entropy', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_product': { name: 'ts_product', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_decay_linear': { name: 'ts_decay_linear', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_decay_exp_window': { name: 'ts_decay_exp_window', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_percentage': { name: 'ts_percentage', minArgs: 2, maxArgs: 2, category: 'Time Series' },
  'ts_corr': { name: 'ts_corr', minArgs: 3, maxArgs: 3, category: 'Time Series' },
  'ts_covariance': { name: 'ts_covariance', minArgs: 3, maxArgs: 3, category: 'Time Series' },
  'ts_co_kurtosis': { name: 'ts_co_kurtosis', minArgs: 3, maxArgs: 3, category: 'Time Series' },
  'ts_co_skewness': { name: 'ts_co_skewness', minArgs: 3, maxArgs: 3, category: 'Time Series' },
  'ts_theilsen': { name: 'ts_theilsen', minArgs: 3, maxArgs: 3, category: 'Time Series' },
  // Group
  'group_rank': { name: 'group_rank', minArgs: 2, maxArgs: 2, category: 'Group' },
  'group_mean': { name: 'group_mean', minArgs: 2, maxArgs: 2, category: 'Group' },
  'group_sum': { name: 'group_sum', minArgs: 2, maxArgs: 2, category: 'Group' },
  'group_max': { name: 'group_max', minArgs: 2, maxArgs: 2, category: 'Group' },
  'group_min': { name: 'group_min', minArgs: 2, maxArgs: 2, category: 'Group' },
  'group_median': { name: 'group_median', minArgs: 2, maxArgs: 2, category: 'Group' },
  'group_std_dev': { name: 'group_std_dev', minArgs: 2, maxArgs: 2, category: 'Group' },
  // Arithmetic
  'add': { name: 'add', minArgs: 2, maxArgs: -1, category: 'Arithmetic' },
  'multiply': { name: 'multiply', minArgs: 2, maxArgs: -1, category: 'Arithmetic' },
  'subtract': { name: 'subtract', minArgs: 2, maxArgs: 2, category: 'Arithmetic' },
  'divide': { name: 'divide', minArgs: 2, maxArgs: 2, category: 'Arithmetic' },
  'power': { name: 'power', minArgs: 2, maxArgs: 2, category: 'Arithmetic' },
  'abs': { name: 'abs', minArgs: 1, maxArgs: 1, category: 'Arithmetic' },
  'max': { name: 'max', minArgs: 2, maxArgs: -1, category: 'Arithmetic' },
  'min': { name: 'min', minArgs: 2, maxArgs: -1, category: 'Arithmetic' },
  // Vector
  'vector_neut': { name: 'vector_neut', minArgs: 2, maxArgs: 2, category: 'Vector' },
  'vector_proj': { name: 'vector_proj', minArgs: 2, maxArgs: 2, category: 'Vector' },
  // Transformational
  'inst_tvr': { name: 'inst_tvr', minArgs: 1, maxArgs: 1, category: 'Transformational' },
  'humpdecay': { name: 'humpdecay', minArgs: 2, maxArgs: 2, category: 'Transformational' },
  'bucket': { name: 'bucket', minArgs: 2, maxArgs: 3, category: 'Transformational' },
};

// Forbidden nesting patterns
const FORBIDDEN_NESTINGS: Array<{ outer: string; inner: string; reason: string }> = [
  { outer: 'ts_', inner: 'rank', reason: 'Cross-sectional operators should not be nested inside time-series functions' },
  { outer: 'ts_', inner: 'zscore', reason: 'Cross-sectional zscore should not be nested inside time-series functions' },
  { outer: 'ts_', inner: 'group_', reason: 'Group operators should not be nested inside time-series functions' },
  { outer: 'group_', inner: 'ts_', reason: 'Time-series operators should not be nested directly inside group operators' },
];

export class AlphaValidator {
  private knownOperators: Map<string, OperatorDef>;
  private inaccessibleOps: Set<string> = new Set();
  private learnedCompatibilityRules: Array<{ pattern: string; rule: string }> = [];

  constructor(operators?: WQOperator[]) {
    this.knownOperators = new Map();

    // Register built-in operators
    for (const [name, def] of Object.entries(OPERATOR_REGISTRY)) {
      this.knownOperators.set(name, def);
    }

    // Register operators from WQ API if provided
    if (operators) {
      for (const op of operators) {
        if (!this.knownOperators.has(op.name)) {
          this.knownOperators.set(op.name, {
            name: op.name,
            minArgs: op.minArgs || 1,
            maxArgs: op.maxArgs || 5,
            category: op.category || 'Unknown',
          });
        }
      }
    }
  }

  addInaccessibleOp(opName: string): void {
    this.inaccessibleOps.add(opName);
  }

  addCompatibilityRule(pattern: string, rule: string): void {
    this.learnedCompatibilityRules.push({ pattern, rule });
  }

  validate(expression: string): InnerLoopResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!expression || expression.trim().length === 0) {
      return { isValid: false, errors: ['Empty expression'], warnings: [] };
    }

    // Step 1: Basic syntax checks
    const cleaned = this.cleanExpression(expression);

    // Check balanced parentheses
    const parenCheck = this.checkBalancedParentheses(cleaned);
    if (!parenCheck.balanced) {
      errors.push(`Unbalanced parentheses: ${parenCheck.message}`);
    }

    // Step 2: Parse and validate operators
    const operatorsUsed = this.extractOperators(cleaned);
    
    for (const op of operatorsUsed) {
      // Check if operator is inaccessible
      if (this.inaccessibleOps.has(op.name)) {
        errors.push(`Inaccessible operator: ${op.name} is not available at current permission level`);
        continue;
      }

      // Check arity
      const def = this.knownOperators.get(op.name);
      if (def) {
        if (op.args < def.minArgs) {
          errors.push(`Arity error: ${op.name} requires at least ${def.minArgs} arguments, received ${op.args}`);
        }
        if (def.maxArgs > 0 && op.args > def.maxArgs) {
          errors.push(`Arity error: ${op.name} accepts at most ${def.maxArgs} arguments, received ${op.args}`);
        }
      } else {
        warnings.push(`Unknown operator: ${op.name} - not in local registry`);
      }
    }

    // Step 3: Check forbidden nesting patterns
    for (const forbidden of FORBIDDEN_NESTINGS) {
      if (this.hasForbiddenNesting(cleaned, forbidden.outer, forbidden.inner)) {
        errors.push(forbidden.reason);
      }
    }

    // Step 4: Check for common anti-patterns
    const antiPatternChecks = this.checkAntiPatterns(cleaned);
    errors.push(...antiPatternChecks.errors);
    warnings.push(...antiPatternChecks.warnings);

    // Step 5: Check learned compatibility rules
    for (const rule of this.learnedCompatibilityRules) {
      if (cleaned.includes(rule.pattern)) {
        warnings.push(`Learned rule: ${rule.rule}`);
      }
    }

    // Step 6: Generate fingerprint
    const fingerprint = this.generateFingerprint(cleaned);

    // Step 7: Normalize expression
    const normalized = this.normalizeExpression(cleaned);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      normalizedExpression: normalized,
      fingerprint,
    };
  }

  private cleanExpression(expr: string): string {
    // Remove region prefixes (USA.field -> field)
    let cleaned = expr.replace(/([A-Z]{3,})\.(\w+)/g, '$2');

    // Remove leading + signs
    cleaned = cleaned.replace(/^\s*\+/, '');

    // Remove leading * 
    cleaned = cleaned.replace(/^\s*\*/, '');

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  private checkBalancedParentheses(expr: string): { balanced: boolean; message: string } {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      if (expr[i] === ')') depth--;
      if (depth < 0) {
        return { balanced: false, message: `Unexpected ')' at position ${i}` };
      }
    }
    if (depth > 0) {
      return { balanced: false, message: `Missing ${depth} closing parenthesis(es)` };
    }
    return { balanced: true, message: '' };
  }

  private extractOperators(expr: string): Array<{ name: string; args: number }> {
    const results: Array<{ name: string; args: number }> = [];
    const regex = /(\w+)\s*\(/g;
    let match;

    while ((match = regex.exec(expr)) !== null) {
      const name = match[1];
      // Count arguments by parsing until matching close paren
      const start = match.index + match[0].length;
      let depth = 1;
      let args = 1;
      let i = start;

      while (i < expr.length && depth > 0) {
        if (expr[i] === '(') depth++;
        if (expr[i] === ')') depth--;
        if (expr[i] === ',' && depth === 1) args++;
        i++;
      }

      results.push({ name, args });
    }

    return results;
  }

  private hasForbiddenNesting(expr: string, outerPattern: string, innerPattern: string): boolean {
    // Find all outer functions
    const outerRegex = new RegExp(`(\\w*${outerPattern}\\w*)\\s*\\(`, 'g');
    let match;
    const outerPositions: Array<{ start: number; end: number }> = [];

    while ((match = outerRegex.exec(expr)) !== null) {
      const start = match.index;
      const funcStart = match.index + match[0].length;
      let depth = 1;
      let i = funcStart;
      while (i < expr.length && depth > 0) {
        if (expr[i] === '(') depth++;
        if (expr[i] === ')') depth--;
        i++;
      }
      outerPositions.push({ start, end: i });
    }

    // Check if any inner function is nested within outer
    const innerRegex = new RegExp(`(\\w*${innerPattern}\\w*)\\s*\\(`, 'g');
    while ((match = innerRegex.exec(expr)) !== null) {
      const innerStart = match.index;
      for (const outer of outerPositions) {
        if (innerStart > outer.start && innerStart < outer.end) {
          return true;
        }
      }
    }

    return false;
  }

  private checkAntiPatterns(expr: string): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for division by literal zero
    if (/\/\s*0(?!\d)/.test(expr) && !/\/\s*0\.\d+/.test(expr)) {
      warnings.push('Potential division by zero detected');
    }

    // Check for deeply nested expressions (max depth 8)
    let maxDepth = 0;
    let depth = 0;
    for (const ch of expr) {
      if (ch === '(') { depth++; maxDepth = Math.max(maxDepth, depth); }
      if (ch === ')') depth--;
    }
    if (maxDepth > 8) {
      warnings.push(`Expression nesting depth (${maxDepth}) exceeds recommended maximum of 8`);
    }

    // Check for very long expressions
    if (expr.length > 2000) {
      warnings.push('Expression exceeds 2000 characters - may hit platform limits');
    }

    // Check for hardcoded numeric lookback windows outside reasonable range
    const lookbackRegex = /(\w+)\s*\(\s*[^,]+,\s*(\d+)\s*\)/g;
    let lookbackMatch;
    while ((lookbackMatch = lookbackRegex.exec(expr)) !== null) {
      const window = parseInt(lookbackMatch[2]);
      if (window > 5000) {
        errors.push(`Lookback window of ${window} is likely too large (max ~2520 for 10 years of daily data)`);
      }
      if (window < 2) {
        errors.push(`Lookback window of ${window} is too small (minimum 2)`);
      }
    }

    // Check for unbalanced semicolons in multi-statement expressions
    if (expr.includes(';')) {
      const statements = expr.split(';').filter(s => s.trim());
      if (statements.length > 10) {
        errors.push('Too many statements in expression (max 10 recommended)');
      }
    }

    return { errors, warnings };
  }

  generateFingerprint(expression: string): string {
    // Create a structural fingerprint by normalizing the expression AST
    const normalized = this.normalizeExpression(expression);

    // Simple hash based on structural features
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }

    // Extract structural features for a richer fingerprint
    const ops = this.extractOperators(normalized);
    const opNames = ops.map(o => o.name).sort();
    const structuralKey = opNames.join('+');

    return `${structuralKey}_${Math.abs(hash).toString(36)}`;
  }

  private normalizeExpression(expr: string): string {
    let normalized = expr.trim();

    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ');

    // Normalize commutative operations (sort arguments for add, multiply)
    normalized = this.sortCommutativeArgs(normalized);

    return normalized;
  }

  private sortCommutativeArgs(expr: string): string {
    // For commutative operators (add, multiply, max, min), sort their arguments
    const commutativeOps = ['add', 'multiply', 'max', 'min'];
    let result = expr;

    for (const op of commutativeOps) {
      const regex = new RegExp(`\\b${op}\\s*\\(([^()]*(?:\\([^()]*\\)[^()]*)*)\\)`, 'g');
      result = result.replace(regex, (_match, argsStr: string) => {
        // Split by comma at depth 0
        const args = this.splitArgs(argsStr.trim());
        args.sort();
        return `${op}(${args.join(', ')})`;
      });
    }

    return result;
  }

  private splitArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of argsStr) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(current.trim());

    return args;
  }

  updateFromWQOperators(operators: WQOperator[]): void {
    for (const op of operators) {
      this.knownOperators.set(op.name, {
        name: op.name,
        minArgs: op.minArgs || 1,
        maxArgs: op.maxArgs || 5,
        category: op.category || 'Unknown',
        requiresEventInput: op.inputs?.some(i => i.toLowerCase().includes('event')),
      });
    }
  }

  getOperatorRegistry(): Map<string, OperatorDef> {
    return new Map(this.knownOperators);
  }

  getInaccessibleOps(): string[] {
    return Array.from(this.inaccessibleOps);
  }
}
