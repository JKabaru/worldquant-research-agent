export type SourceSnippet = {
  id: string;
  sourceId: string;
  sourcePath: string;
  topic: string;
  text: string;
  tags: string[];
};

export type RetrievalResult = {
  selected: SourceSnippet[];
  estimatedTokens: number;
};

const SOURCE_PATHS = {
  worldQuantBrief: 'C:\\Users\\joseph\\Downloads\\world_quant_brief _documentation.txt',
  activePortfolioManagement:
    'C:\\Users\\joseph\\Downloads\\Richard Grinold, Ronald Kahn-Active Portfolio Management_ A Quantitative Approach for Producing Superior Returns and Controlling Risk-McGraw-Hill (1999).pdf',
  expectedReturns: 'C:\\Users\\joseph\\Downloads\\Expected Returns PDF.pdf',
} as const;

const DISTILLED_SNIPPETS: SourceSnippet[] = [
  {
    id: 'wq_1',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Fast Expression language',
    text: 'BRAIN simulations use Fast Expression language with data fields and operators, not Python/R syntax for alpha submission.',
    tags: ['fastexpr', 'language', 'operators', 'data_fields'],
  },
  {
    id: 'wq_2',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Delay setting meaning',
    text: 'Delay 0 trades on same-day available information; Delay 1 trades the next day using prior-day data.',
    tags: ['delay', 'd0', 'd1', 'timing'],
  },
  {
    id: 'wq_3',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Decay and turnover',
    text: 'Decay can reduce turnover, but very large decay attenuates signal strength.',
    tags: ['decay', 'turnover', 'smoothing'],
  },
  {
    id: 'wq_4',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Truncation range',
    text: 'Truncation legal range is 0 to 1; practical defaults are often in the 0.05 to 0.10 range to control concentration.',
    tags: ['truncation', 'risk_control', 'weights'],
  },
  {
    id: 'wq_5',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Neutralization behavior',
    text: 'Neutralization removes common group effects by subtracting group means (market/industry/subindustry) and helps keep long-short balance.',
    tags: ['neutralization', 'market', 'industry', 'subindustry'],
  },
  {
    id: 'wq_6',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Pasteurization',
    text: 'Pasteurization restricts inputs to the selected universe; useful for cleaner cross-sectional/group operations.',
    tags: ['pasteurize', 'universe', 'cross_sectional'],
  },
  {
    id: 'wq_7',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'NaN handling tradeoff',
    text: 'NaN handling improves coverage but can introduce ambiguous values; manual handling with conditional logic can preserve semantics.',
    tags: ['nan', 'coverage', 'data_quality'],
  },
  {
    id: 'wq_8',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Vector fields',
    text: 'Vector data fields must be converted to matrix values with vec_ operators before combining with matrix operators.',
    tags: ['vector', 'matrix', 'vec_ops'],
  },
  {
    id: 'wq_9',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Custom groups',
    text: 'bucket(rank(x)) can define custom groups; densify(group) is recommended before group operations to remove empty buckets.',
    tags: ['bucket', 'densify', 'group_ops'],
  },
  {
    id: 'wq_10',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Turnover control',
    text: 'trade_when and hump can reduce unnecessary trading by updating positions only when signals are meaningful.',
    tags: ['trade_when', 'hump', 'turnover'],
  },
  {
    id: 'apm_1',
    sourceId: 'active_portfolio_management',
    sourcePath: SOURCE_PATHS.activePortfolioManagement,
    topic: 'Core framing',
    text: 'Active management should be treated as a structured forecasting process rather than ad hoc intuition.',
    tags: ['forecasting', 'process', 'discipline'],
  },
  {
    id: 'apm_2',
    sourceId: 'active_portfolio_management',
    sourcePath: SOURCE_PATHS.activePortfolioManagement,
    topic: 'Information ratio priority',
    text: 'Information Ratio is central for value-added evaluation and should be improved through skill, breadth, and implementation quality.',
    tags: ['information_ratio', 'value_added', 'skill'],
  },
  {
    id: 'apm_3',
    sourceId: 'active_portfolio_management',
    sourcePath: SOURCE_PATHS.activePortfolioManagement,
    topic: 'Fundamental law',
    text: 'The Fundamental Law links expected performance to forecasting skill and independent breadth; weak forecasts require diversification and discipline.',
    tags: ['fundamental_law', 'breadth', 'ic'],
  },
  {
    id: 'apm_4',
    sourceId: 'active_portfolio_management',
    sourcePath: SOURCE_PATHS.activePortfolioManagement,
    topic: 'Implementation drag',
    text: 'Implementation should lose as little value as possible through turnover control, transaction-cost awareness, and robust construction.',
    tags: ['implementation', 'transaction_costs', 'turnover'],
  },
  {
    id: 'apm_5',
    sourceId: 'active_portfolio_management',
    sourcePath: SOURCE_PATHS.activePortfolioManagement,
    topic: 'Data-mining caution',
    text: 'Data-mining risk is high in strategy research; require out-of-sample sanity checks and avoid overfitting fragile patterns.',
    tags: ['overfitting', 'robustness', 'validation'],
  },
  {
    id: 'er_1',
    sourceId: 'expected_returns',
    sourcePath: SOURCE_PATHS.expectedReturns,
    topic: 'Low expected return regime',
    text: 'Low yields and rich valuations can imply lower forward returns; strategy design must adapt assumptions to regime reality.',
    tags: ['regime', 'valuation', 'expected_returns'],
  },
  {
    id: 'er_2',
    sourceId: 'expected_returns',
    sourcePath: SOURCE_PATHS.expectedReturns,
    topic: 'Diversification principle',
    text: 'Diversification across independent return sources is typically more reliable than concentration in single narratives.',
    tags: ['diversification', 'portfolio', 'risk'],
  },
  {
    id: 'er_3',
    sourceId: 'expected_returns',
    sourcePath: SOURCE_PATHS.expectedReturns,
    topic: 'Style premia',
    text: 'Style premia can be persistent long-run sources of return when combined with patience, conviction, and risk controls.',
    tags: ['style_premia', 'long_horizon', 'risk_control'],
  },
  {
    id: 'er_4',
    sourceId: 'expected_returns',
    sourcePath: SOURCE_PATHS.expectedReturns,
    topic: 'Process over outcomes',
    text: 'Good process matters more than short-term outcomes; avoid outcome bias and keep disciplined evaluation horizons.',
    tags: ['process', 'outcome_bias', 'discipline'],
  },
  {
    id: 'er_5',
    sourceId: 'expected_returns',
    sourcePath: SOURCE_PATHS.expectedReturns,
    topic: 'Cost and risk management',
    text: 'Expected returns should be judged net of costs and implementation frictions; portfolio construction and risk management are first-order.',
    tags: ['costs', 'risk_management', 'construction'],
  },
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_ ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3)
  );
}

function scoreSnippet(snippet: SourceSnippet, queryTerms: Set<string>): number {
  if (queryTerms.size === 0) return 0;
  const snippetTerms = tokenize(`${snippet.topic} ${snippet.text} ${snippet.tags.join(' ')}`);
  let overlap = 0;
  for (const term of queryTerms) {
    if (snippetTerms.has(term)) overlap += 1;
  }
  // Reward explicit WQ operator mentions to prioritize implementation-relevant guidance.
  const operatorBoost = /(ts_|group_|rank|zscore|trade_when|neutralize|decay|turnover)/i.test(snippet.text) ? 0.5 : 0;
  return overlap + operatorBoost;
}

export function retrieveSourceContext(
  query: string,
  maxSnippets: number = 6,
  maxTokens: number = 380
): RetrievalResult {
  const terms = tokenize(query);
  const ranked = DISTILLED_SNIPPETS
    .map(snippet => ({ snippet, score: scoreSnippet(snippet, terms) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected: SourceSnippet[] = [];
  let tokenCount = 0;

  for (const item of ranked) {
    if (selected.length >= maxSnippets) break;
    const snippetTokens = estimateTokens(item.snippet.text);
    if (tokenCount + snippetTokens > maxTokens) continue;
    selected.push(item.snippet);
    tokenCount += snippetTokens;
  }

  // Always provide at least one short anchor snippet for provenance/context.
  if (selected.length === 0 && DISTILLED_SNIPPETS.length > 0) {
    const fallback = DISTILLED_SNIPPETS[0];
    selected.push(fallback);
    tokenCount = estimateTokens(fallback.text);
  }

  return { selected, estimatedTokens: tokenCount };
}

export function formatSourceContextForPrompt(
  query: string,
  maxSnippets: number = 6,
  maxTokens: number = 380
): { promptBlock: string; selectedIds: string[]; estimatedTokens: number } {
  const retrieval = retrieveSourceContext(query, maxSnippets, maxTokens);
  const lines: string[] = [];
  lines.push('## Distilled source guidance (budget-limited):');
  for (const snippet of retrieval.selected) {
    lines.push(
      `- [${snippet.sourceId}:${snippet.topic}] ${snippet.text}`
    );
  }
  lines.push('Use these as guidance, not verbatim copies.');

  return {
    promptBlock: lines.join('\n'),
    selectedIds: retrieval.selected.map(s => s.id),
    estimatedTokens: retrieval.estimatedTokens,
  };
}

export function getConfiguredSourcePaths(): string[] {
  return [
    SOURCE_PATHS.worldQuantBrief,
    SOURCE_PATHS.activePortfolioManagement,
    SOURCE_PATHS.expectedReturns,
  ];
}

export function previewSourceContext(
  query: string,
  maxSnippets: number = 6,
  maxTokens: number = 380
): {
  query: string;
  maxSnippets: number;
  maxTokens: number;
  estimatedTokens: number;
  selected: Array<{
    id: string;
    sourceId: string;
    sourcePath: string;
    topic: string;
    text: string;
    tags: string[];
  }>;
} {
  const { selected, estimatedTokens } = retrieveSourceContext(query, maxSnippets, maxTokens);
  return {
    query,
    maxSnippets,
    maxTokens,
    estimatedTokens,
    selected: selected.map(s => ({
      id: s.id,
      sourceId: s.sourceId,
      sourcePath: s.sourcePath,
      topic: s.topic,
      text: s.text,
      tags: s.tags,
    })),
  };
}
