export type SourceSnippet = {
  id: string;
  sourceId: string;
  sourcePath: string;
  topic: string;
  text: string;
  tags: string[];
  // Knowledge enhancement fields
  importanceScore?: number; // 0-1 scale, higher = more important
  relevanceCategories?: string[]; // Categories this snippet is relevant to
  addedTimestamp?: number; // Unix timestamp when added
  lastUsedTimestamp?: number; // Unix timestamp when last used in context
  usageCount?: number; // How many times this snippet has been used
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
  computationalParadigms:
    'C:\\Users\\joseph\\Downloads\\Computational Paradigms in Systemat world quant.txt',
} as const;

const DISTILLED_SNIPPETS: SourceSnippet[] = [
  {
    id: 'wq_1',
    sourceId: 'world_quant_brief',
    sourcePath: SOURCE_PATHS.worldQuantBrief,
    topic: 'Fast Expression language',
    text: 'BRAIN simulations use Fast Expression language with data fields and operators, not Python/R syntax for alpha submission.',
    tags: ['fastexpr', 'language', 'operators', 'data_fields'],
    importanceScore: 0.9,
    relevanceCategories: ['syntax', 'language'],
    addedTimestamp: Date.now(),
    lastUsedTimestamp: 0,
    usageCount: 0,
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
  // ============================================================
  // Computational Paradigms in Systematic Alpha Discovery
  // ============================================================
  {
    id: 'cp_1',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Information Ratio definition',
    text: 'Information Ratio is the ratio of annualized residual return to annualized residual risk; it serves as the primary metric of opportunity and achievement in active management, acting as a budget constraint that limits ability to add value.',
    tags: ['information_ratio', 'performance', 'metrics', 'value_added'],
  },
  {
    id: 'cp_2',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'IR performance benchmarks',
    text: 'Top-quartile managers achieve IR of approximately 0.5; an alpha with Sharpe greater than 2.0 and Fitness above 1.0 is considered the gold standard for submission; IR typically grows with square root of time.',
    tags: ['sharpe', 'fitness', 'benchmark', 'target'],
  },
  {
    id: 'cp_3',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Fundamental Law of Active Management',
    text: 'The Fundamental Law states IR equals IC times square root of Breadth, where IC is Information Coefficient (correlation of forecast with realized returns) and Breadth is number of independent investment decisions per year; increasing breadth is often more effective than marginally increasing skill.',
    tags: ['fundamental_law', 'ic', 'breadth', 'skill'],
  },
  {
    id: 'cp_4',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Breadth importance for high-breadth strategies',
    text: 'Following 500 stocks with quarterly forecasts provides 2,000 independent bets per year, requiring IC of only 0.02 to achieve highly competitive IR of 0.89; research should prioritize cross-sectional anomalies applied to large universes like USA TOP3000.',
    tags: ['breadth', 'universe', 'cross_sectional', 'diversity'],
  },
  {
    id: 'cp_5',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Additivity of alphas',
    text: 'The additivity principle of the Fundamental Law suggests a portfolio of lowly correlated alphas each with modest IR can achieve much higher aggregate IR, reinforcing the need for a diversity manager within the research loop.',
    tags: ['portfolio', 'alpha_combine', 'diversity', 'correlation'],
  },
  {
    id: 'cp_6',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Value Added definition',
    text: 'Value Added is the risk-adjusted exceptional return achieved through either stock selection or benchmark timing; it should be judged net of costs and implementation frictions.',
    tags: ['value_added', 'risk_adjusted', 'returns', 'costs'],
  },
  {
    id: 'cp_7',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'trade_when operator for turnover control',
    text: 'trade_when(volume > adv20, rank(-ts_delta(close, 5)), -1) activates the alpha only when specific events such as high liquidity or extreme price movements occur, dramatically reducing turnover while maintaining high-conviction exposure.',
    tags: ['trade_when', 'turnover', 'liquidity', 'timing'],
  },
  {
    id: 'cp_8',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'ts_arg_max and ts_arg_min for timing',
    text: 'Using ts_arg_max or ts_argmin can further optimize timing by identifying turning points in valuation or price, allowing the alpha to capture extreme moments before reversal.',
    tags: ['ts_arg_max', 'ts_arg_min', 'timing', 'turning_points'],
  },
  {
    id: 'cp_9',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'decay_linear for smoothing',
    text: 'decay_linear(x, n) applies a weighted memory to recent data points, smoothing the signal and reducing the frequency of trades; high turnover is the alpha killer in Stage 1 simulation as it erodes profits through transaction costs.',
    tags: ['decay_linear', 'smoothing', 'turnover', 'trade_reduction'],
  },
  {
    id: 'cp_10',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'ts_av_diff for momentum stability',
    text: 'ts_av_diff(x, n) comparing current values to their rolling average provides a stable measure of momentum or reversal, identifying when price deviates meaningfully from its recent average.',
    tags: ['ts_av_diff', 'momentum', 'mean_reversion', 'stability'],
  },
  {
    id: 'cp_11',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'ts_regression for trend extraction',
    text: 'ts_regression(y, x, window, lag, retval) is powerful for extracting the true trend of a signal by filtering out idiosyncratic daily volatility; for instance regressing returns against lagged news buzz allows cleaner identification of sentiment impact.',
    tags: ['ts_regression', 'trend', 'filtering', 'noise_reduction'],
  },
  {
    id: 'cp_12',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'rank operator for robustness',
    text: 'rank(x) cross-sectional operator is essential for making alphas robust and reducing noise from fat-tailed financial distributions; raw financial data is rarely ready for simulation without normalization.',
    tags: ['rank', 'normalization', 'robustness', 'cross_sectional'],
  },
  {
    id: 'cp_13',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'ts_zscore for mean-reversion',
    text: 'ts_zscore(x, n) standardizing a signal over a rolling window n is critical for mean-reversion strategies as it identifies statistical extremes relative to a stock own history.',
    tags: ['ts_zscore', 'mean_reversion', 'normalization', 'extremes'],
  },
  {
    id: 'cp_14',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'signed_power for distribution shaping',
    text: 'signed_power(x, y) adjusts the distribution shape and can enhance signal strength for high-conviction bets while compressing noise, allowing asymmetric responses to positive versus negative signals.',
    tags: ['signed_power', 'distribution', 'signal_strength', 'asymmetric'],
  },
  {
    id: 'cp_15',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'vector_neut for orthogonalization',
    text: 'vector_neut(alpha, returns_250) removes unintended exposure to momentum, ensuring the signal provides unique value that WorldQuant internal models like model77 or pv1 do not already capture.',
    tags: ['vector_neut', 'orthogonal', 'factor_exposure', 'hedging'],
  },
  {
    id: 'cp_16',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'group_neutralize for industry control',
    text: 'group_neutralize with industry or subindustry is mandatory for fundamental signals to ensure identifying best companies within a sector rather than just betting on sector performance relative to another.',
    tags: ['group_neutralize', 'industry', 'sector', 'fundamental'],
  },
  {
    id: 'cp_17',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'ts_backfill for continuity',
    text: 'ts_backfill fills missing values to prevent signal gaps and maintain continuity in time-series operations, important for avoiding NaN-related simulation failures.',
    tags: ['ts_backfill', 'continuity', 'missing_data', 'nan_handling'],
  },
  {
    id: 'cp_18',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'densify for efficiency',
    text: 'densify compresses sparse categorical fields for simulation, improving computational efficiency when working with group operations on sparse data.',
    tags: ['densify', 'sparse', 'efficiency', 'categorical'],
  },
  {
    id: 'cp_19',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Retained earnings dynamics signal',
    text: 'Tracking change in retained earnings per share (rank(ts_delta(retained_earnings / sharesout, 64))) captures shifts in company internal reinvestment capabilities, a strong predictor of long-term outperformance; fundamental signals offer lower turnover and higher stability.',
    tags: ['retained_earnings', 'fundamental', 'long_term', 'capital_allocation'],
  },
  {
    id: 'cp_20',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Accrual management signal',
    text: 'High total accruals relative to assets are a frequent signal of poor earnings quality and potential aggressive accounting; a signal that shorts firms with rising discretionary accruals can capture overvaluation before market corrects.',
    tags: ['accruals', 'earnings_quality', 'fundamental', 'shorting'],
  },
  {
    id: 'cp_21',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Operating efficiency signal',
    text: 'Ratios such as operating income to price or enterprise value to EBITDA identify firms generating superior cash flow relative to their market valuation, highlighting efficiency advantages.',
    tags: ['operating_efficiency', 'ebitda', 'cashflow', 'valuation'],
  },
  {
    id: 'cp_22',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Long-term investment trend signal',
    text: 'Regressing yearly long-term investment measures (fnd6_newqv1300_ivltq) against a time variable can identify firms with accelerating business momentum that simple price trends miss.',
    tags: ['investment_trend', 'momentum', 'fundamental', 'business_momentum'],
  },
  {
    id: 'cp_23',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Volatility skew and sentiment',
    text: 'Difference between call and put implied volatility relative to at-the-money mean indicates direction of traders focus; high call IV relative to put IV suggests options traders positioning for upside breakout.',
    tags: ['volatility_skew', 'options', 'sentiment', 'implied_volatility'],
  },
  {
    id: 'cp_24',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Put/Call Open Interest Ratios',
    text: 'Using trade_when operator to trigger trades only when put/call ratio deviates significantly from its 270-day mean can identify periods of extreme fear or greed; options market acts as sophisticated barometer for institutional expectations.',
    tags: ['put_call_ratio', 'options', 'sentiment', 'fear_greed'],
  },
  {
    id: 'cp_25',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Implied Volatility Change signal',
    text: 'Large increases in call IV over the past month are often precursors to high returns, reflecting leakage of positive information into options market before equity price fully reacts.',
    tags: ['implied_volatility', 'options', 'leading_indicator', 'information_leakage'],
  },
  {
    id: 'cp_26',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Sentiment-Momentum Hybrid',
    text: 'Buying stocks with high relative news sentiment while applying reversion filter to those with low news buzz captures newsworthy winners while avoiding simple noise; textual data acts as entropy injector that breaks predictable patterns.',
    tags: ['sentiment', 'momentum', 'hybrid', 'news'],
  },
  {
    id: 'cp_27',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Negative Sentiment Reversal',
    text: 'Stocks experiencing extreme spike in news buzz often mean-revert as market overreacts to short-term headlines; successful contrarian alpha involves signal like -scl12_buzz.',
    tags: ['sentiment_reversal', 'contrarian', 'news', 'mean_reversion'],
  },
  {
    id: 'cp_28',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'News Reaction Slope',
    text: 'Calculating 5-day slope of first-minute reactions to news headlines can identify bull traps where price gains occur despite deteriorating sentiment trend.',
    tags: ['news_reaction', 'sentiment_trend', 'timing', 'bull_trap'],
  },
  {
    id: 'cp_29',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Earnings Call AI Sentiment',
    text: 'Using LLMs to extract sentiment from earnings call transcripts, specifically weighting speaker roles like CFO at 30% or Analysts at 49%, can generate monthly long-short alphas that standard risk factors cannot explain.',
    tags: ['earnings_call', 'ai_sentiment', 'transcript', 'alternative_data'],
  },
  {
    id: 'cp_30',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Supply Chain Bullwhip Effect',
    text: 'Isolating cross-industry supply chain signals using asymmetric information frameworks predicts inventory cycles and industrial demand shifts; downstream firms experience delayed but extreme price reactions to upstream supply shocks.',
    tags: ['supply_chain', 'bullwhip', 'alternative_data', 'industrial'],
  },
  {
    id: 'cp_31',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Retail Trading Alignment',
    text: 'Tracking retail flows through social media sentiment vs short-selling alignment reveals segments where retail investors benefit from AI-assisted information processing, creating opportunities for liquidity providers.',
    tags: ['retail_flows', 'social_sentiment', 'liquidity', 'alternative_data'],
  },
  {
    id: 'cp_32',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Information horizon and delay',
    text: 'Information has a shelf life; value of signal decays as market participants trade on underlying data; Delay 1 is conservative standard assuming trade occurs day after data available; define half-life of strategy.',
    tags: ['information_horizon', 'delay', 'signal_decay', 'timing'],
  },
  {
    id: 'cp_33',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Rebalance Timing Luck',
    text: 'Rebalance timing luck is a structural source of dispersion where identical strategies can diverge by as much as 350 basis points simply by rebalancing on different days of month; implement tranching to average weights across multiple rebalance dates.',
    tags: ['rebalance_timing', 'rtl', 'robustness', 'dispersion'],
  },
  {
    id: 'cp_34',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Market neutrality requirement',
    text: 'Simulation setting Neutralization equals Market ensures sum of long and short positions results in zero net market exposure, isolating pure stock-picking skill.',
    tags: ['market_neutral', 'neutralization', 'long_short', 'risk_control'],
  },
  {
    id: 'cp_35',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Out-of-sample testing',
    text: 'Common pitfall is producing alphas excellent in-sample but failing out-of-sample; rigorous approach to information analysis and validation is required; require OS sanity checks.',
    tags: ['out_of_sample', 'validation', 'overfitting', 'robustness'],
  },
  {
    id: 'cp_36',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Sentiment-Microstructure Hybrid formula',
    text: 'rank(ts_sum(vec_avg(news_buzz), 60)) > 0.5 ? 1 : rank(-ts_delta(close, 2)) logic buys stocks hot in news sentiment but reverts to price-reversion when news is quiet, switching between momentum and mean-reversion regimes dynamically.',
    tags: ['sentiment_microstructure', 'hybrid', 'regime_switch', 'dynamic'],
  },
  {
    id: 'cp_37',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Fundamental Value with Volatility Anchoring',
    text: '-ts_zscore(enterprise_value / ebitda, 63) * ts_rank(vwap / close, 10) shorts firms overpriced relative to cash flow but anchors signal by price trend relative to liquidity-weighted average, ensuring bet only when valuation extreme coincides with price breakout.',
    tags: ['fundamental_value', 'volatility_anchoring', 'vwap', 'valuation'],
  },
  {
    id: 'cp_38',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Volatility Skew Arbitrage',
    text: 'ts_decay_linear(ts_delta(implied_volatility_call_60, 25), 10) / ts_std_dev(returns, 20) tracks rapid rise in call option demand normalized by stock historical volatility, identifying where smart money anticipates upside event.',
    tags: ['volatility_arbitrage', 'options', 'skew', 'smart_money'],
  },
  {
    id: 'cp_39',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'R-Quant workflow concept',
    text: 'Role of quantitative researcher is evolving from coder to Workflow Orchestrator or R-Quant who builds AI agents that think in mathematics and interpret unstructured textual data at depth previously only possible for human analysts.',
    tags: ['r_quant', 'workflow', 'agent', 'llm'],
  },
  {
    id: 'cp_40',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Semantic Alpha concept',
    text: 'Semantic information inflow acts as entropy injector allowing systems to predict price jumps that purely numerical models miss; semantic complexity changes in earnings calls often precede volatility.',
    tags: ['semantic_alpha', 'entropy', 'earnings', 'predictability'],
  },
  {
    id: 'cp_41',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Alpha scaling for investability',
    text: 'Alpha scaling is mandatory preprocessing for excellent alphas; alphas should be scaled to be consistent with realistic Information Ratio like 0.75 and target residual risk like 5% to prevent outliers from overwhelming portfolio construction.',
    tags: ['alpha_scaling', 'investability', 'risk_scaling', 'preprocessing'],
  },
  {
    id: 'cp_42',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Bayesian Shrinkage on IC',
    text: 'Experience buffer should perform Bayesian Shrinkage on Information Coefficients; when alpha discovered with high in-sample IC, shrink expected performance toward zero based on number of months of observations and degree of uncertainty.',
    tags: ['bayesian_shrinkage', 'ic', 'uncertainty', 'expectation'],
  },
  {
    id: 'cp_43',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Counter-cyclical opportunities',
    text: 'As retail traders increasingly align with AI-generated sentiment, profitability of standard sentiment alphas may decline; future high-performing alphas will focus on counter-cyclical opportunities identifying other side of trades made by pro-cyclical asset managers.',
    tags: ['counter_cyclical', 'sentiment', 'market_microstructure', 'liquidity'],
  },
  {
    id: 'cp_44',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Turnover amortization concept',
    text: 'Compare transactions costs to annual rate of gain from alpha; establish no-trade region around target weights and rebalance only when portfolio drifts outside boundaries, cutting turnover roughly in half with negligible impact on risk.',
    tags: ['turnover', 'amortization', 'rebalancing', 'transaction_costs'],
  },
  {
    id: 'cp_45',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Options-Sentiment Divergence signal',
    text: 'Buying stocks where equity sentiment is highly positive but call IV skew is deteriorating identifies overextended rallies ready for correction; divergence between equity and options sentiment provides unique edge.',
    tags: ['options_sentiment', 'divergence', 'overextension', 'correction'],
  },
  {
    id: 'cp_46',
    sourceId: 'computational_paradigms',
    sourcePath: SOURCE_PATHS.computationalParadigms,
    topic: 'Accrual-Microstructure Synergy',
    text: 'High discretionary accruals coupled with sudden decline in order book depth signals institutional investors exiting ahead of negative earnings revision, combining fundamental and microstructure for predictive edge.',
    tags: ['accruals', 'microstructure', 'order_book', 'earnings'],
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

function scoreSnippet(snippet: SourceSnippet, queryTerms: Set<string>, context?: { currentStyle?: string; recentTopics?: string[] }): number {
  if (queryTerms.size === 0) return 0;
  
  // Basic term matching score
  const snippetTerms = tokenize(`${snippet.topic} ${snippet.text} ${snippet.tags.join(' ')}`);
  let overlap = 0;
  for (const term of queryTerms) {
    if (snippetTerms.has(term)) overlap += 1;
  }
  
  // Normalize overlap score (0-1 range)
  const normalizedOverlap = queryTerms.size > 0 ? overlap / queryTerms.size : 0;
  
  // Reward explicit WQ operator mentions to prioritize implementation-relevant guidance.
  const operatorBoost = /(ts_|group_|rank|zscore|trade_when|neutralize|decay|turnover)/i.test(snippet.text) ? 0.5 : 0;
  
  // Importance score boost (0-0.3 range)
  const importanceBoost = (snippet.importanceScore ?? 0.5) * 0.3;
  
  // Recency boost - snippets used recently get a small boost
  const recencyBoost = snippet.usageCount > 0 ? Math.min(0.2, Math.log(snippet.usageCount) * 0.05) : 0;
  
  // Category relevance boost
  const categoryBoost = context?.recentTopics && snippet.relevanceCategories ? 
    (snippet.relevanceCategories.some(cat => context.recentTopics.includes(cat)) ? 0.2 : 0) : 0;
  
  // Style relevance boost
  const styleBoost = context?.currentStyle && snippet.relevanceCategories ?
    (snippet.relevanceCategories.includes(context.currentStyle) ? 0.15 : 0) : 0;
  
  return normalizedOverlap + operatorBoost + importanceBoost + recencyBoost + categoryBoost + styleBoost;
}

export function retrieveSourceContext(
  query: string,
  maxSnippets: number = 6,
  maxTokens: number = 380,
  context?: { currentStyle?: string; recentTopics?: string[] }
): RetrievalResult {
  const terms = tokenize(query);
  const ranked = DISTILLED_SNIPPETS
    .map(snippet => ({ snippet, score: scoreSnippet(snippet, terms, context) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected: SourceSnippet[] = [];
  let tokenCount = 0;

  // Dynamic snippet count based on score distribution
  const adaptiveMaxSnippets = Math.min(
    maxSnippets,
    Math.max(3, Math.floor(ranked.length * 0.3)) // At least 3, up to maxSnippets based on score distribution
  );

  for (const item of ranked) {
    if (selected.length >= adaptiveMaxSnippets) break;
    const snippetTokens = estimateTokens(item.snippet.text);
    if (tokenCount + snippetTokens > maxTokens) continue;
    selected.push(item.snippet);
    
    // Update usage statistics
    item.snippet.usageCount = (item.snippet.usageCount || 0) + 1;
    item.snippet.lastUsedTimestamp = Date.now();
    
    tokenCount += snippetTokens;
  }

  // Always provide at least one short anchor snippet for provenance/context.
  if (selected.length === 0 && DISTILLED_SNIPPETS.length > 0) {
    const fallback = DISTILLED_SNIPPETS[0];
    selected.push(fallback);
    fallback.usageCount = (fallback.usageCount || 0) + 1;
    fallback.lastUsedTimestamp = Date.now();
    tokenCount = estimateTokens(fallback.text);
  }

  return { selected, estimatedTokens: tokenCount };
}

export function formatSourceContextForPrompt(
  query: string,
  maxSnippets: number = 6,
  maxTokens: number = 380,
  context?: { currentStyle?: string; recentTopics?: string[] }
): { promptBlock: string; selectedIds: string[]; estimatedTokens: number } {
  const retrieval = retrieveSourceContext(query, maxSnippets, maxTokens, context);
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
    SOURCE_PATHS.computationalParadigms,
  ];
}

export function previewSourceContext(
  query: string,
  maxSnippets: number = 6,
  maxTokens: number = 380,
  context?: { currentStyle?: string; recentTopics?: string[] }
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
  const { selected, estimatedTokens } = retrieveSourceContext(query, maxSnippets, maxTokens, context);
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
