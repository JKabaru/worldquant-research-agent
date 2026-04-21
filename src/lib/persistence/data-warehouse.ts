// ============================================================
// Analytical Data Warehouse - DuckDB + Parquet
// ============================================================
// Stores: 1-year local "proxy" price/volume data, fundamental data
// (fnd6, pv13), auto-correlation matrices.
//
// DuckDB runs SQL directly on Parquet files without loading into memory.
// Used by: Pre-Simulation Correlation Prediction via PCA
// ============================================================

import path from 'path';
import fs from 'fs';

// DuckDB is dynamically imported to avoid issues in environments where
// the native module might not be available (client-side, build time, etc.)
// Uses require() for fully lazy loading - avoids Turbopack/Webpack resolution

interface DuckDBConn {
  execute: (sql: string) => void;
  query: (sql: string) => { toArray: () => Record<string, unknown>[] };
  close: () => void;
}

// --- Types ---

export interface ProxyPriceRow {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  returns: number;
  market_cap: number;
  sector: string;
  industry: string;
  subindustry: string;
}

export interface FundamentalRow {
  ticker: string;
  date: string;
  assets: number;
  revenue: number;
  earnings: number;
  cashflow_op: number;
  debt_lt: number;
  sharesout: number;
  book_value: number;
  pe_ratio: number | null;
  pb_ratio: number | null;
  roe: number | null;
  gross_margin: number | null;
}

export interface ProxyReturnSeries {
  fingerprint: string;
  expression: string;
  ticker: string;
  date: string;
  proxy_return: number;
  signal_value: number;
}

export interface CorrelationResult {
  fingerprint1: string;
  fingerprint2: string;
  correlation: number;
}

export interface AutoCorrelationResult {
  ticker: string;
  auto_corr_1d: number;
  auto_corr_5d: number;
  auto_corr_10d: number;
  auto_corr_21d: number;
}

export interface WarehouseStats {
  parquetFiles: number;
  totalSizeBytes: number;
  tickersCount: number;
  dateRange: { start: string; end: string } | null;
  tables: string[];
}

// --- Data Warehouse Class ---

export class DataWarehouse {
  private db: DuckDBConn | null = null;
  private dataDir: string;
  private isConnected = false;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(process.cwd(), 'data', 'warehouse');

    // Ensure warehouse directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  // --- Connection Management ---

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      // Use Function() constructor to completely hide the require() from
      // Turbopack/Webpack static analysis. This prevents the bundler from
      // tracing DuckDB's native module dependencies at build time.
      const loadDuckDB = new Function('module', 'return require(module)') as unknown as (mod: string) => {
        connect: (opts?: { database?: string }) => DuckDBConn;
      };
      const duckdbModule = loadDuckDB('duckdb');
      this.db = duckdbModule.connect({ database: ':memory:' });

      // Register Parquet files for querying
      this.db.execute("INSTALL 'parquet'");
      this.db.execute("LOAD 'parquet'");

      // Create views over any existing Parquet files
      this.registerExistingParquetFiles();

      this.isConnected = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // DuckDB not available - run in degraded mode
      console.warn(`[DataWarehouse] DuckDB not available, running in degraded mode: ${msg}`);
      this.isConnected = false;
    }
  }

  private registerExistingParquetFiles(): void {
    if (!this.db) return;

    const parquetDir = path.join(this.dataDir, 'proxy_data');
    if (!fs.existsSync(parquetDir)) return;

    const files = fs.readdirSync(parquetDir).filter(f => f.endsWith('.parquet'));
    for (const file of files) {
      const table = file.replace('.parquet', '').replace(/[^a-zA-Z0-9_]/g, '_');
      try {
        this.db!.execute(`CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_parquet('${path.join(parquetDir, file)}')`);
      } catch {
        // Skip files that can't be read
      }
    }
  }

  isConnectedToWarehouse(): boolean {
    return this.isConnected;
  }

  // --- Data Ingestion ---

  async ingestProxyPrices(data: ProxyPriceRow[], partition: string = 'default'): Promise<void> {
    if (!this.isConnected) {
      // Fallback: save as JSONL for later processing
      this.saveAsJsonl('proxy_prices', data, partition);
      return;
    }

    const parquetDir = path.join(this.dataDir, 'proxy_data');
    if (!fs.existsSync(parquetDir)) {
      fs.mkdirSync(parquetDir, { recursive: true });
    }

    // Save as JSONL first, then convert to Parquet via DuckDB
    const jsonlPath = path.join(parquetDir, `_staging_${partition}.jsonl`);
    const parquetPath = path.join(parquetDir, `proxy_prices_${partition}.parquet`);

    // Write JSONL
    const jsonlLines = data.map(row => JSON.stringify(row));
    fs.writeFileSync(jsonlPath, jsonlLines.join('\n'));

    // Convert to Parquet via DuckDB
    try {
      this.db!.execute(`
        COPY (SELECT * FROM read_json_auto('${jsonlPath}'))
        TO '${parquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
      `);

      // Clean up staging file
      fs.unlinkSync(jsonlPath);

      // Register the new view
      const table = `proxy_prices_${partition}`.replace(/[^a-zA-Z0-9_]/g, '_');
      this.db!.execute(`CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_parquet('${parquetPath}')`);
    } catch (error) {
      // Keep JSONL as fallback if Parquet conversion fails
      console.warn('[DataWarehouse] Parquet conversion failed, keeping JSONL:', error);
    }
  }

  async ingestFundamentalData(data: FundamentalRow[], dataset: string = 'fnd6'): Promise<void> {
    if (!this.isConnected) {
      this.saveAsJsonl(`fundamental_${dataset}`, data);
      return;
    }

    const parquetDir = path.join(this.dataDir, 'proxy_data');
    if (!fs.existsSync(parquetDir)) {
      fs.mkdirSync(parquetDir, { recursive: true });
    }

    const jsonlPath = path.join(parquetDir, `_staging_fund_${dataset}.jsonl`);
    const parquetPath = path.join(parquetDir, `fundamental_${dataset}.parquet`);

    const jsonlLines = data.map(row => JSON.stringify(row));
    fs.writeFileSync(jsonlPath, jsonlLines.join('\n'));

    try {
      this.db!.execute(`
        COPY (SELECT * FROM read_json_auto('${jsonlPath}'))
        TO '${parquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
      `);

      fs.unlinkSync(jsonlPath);

      const table = `fundamental_${dataset}`.replace(/[^a-zA-Z0-9_]/g, '_');
      this.db!.execute(`CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_parquet('${parquetPath}')`);
    } catch (error) {
      console.warn('[DataWarehouse] Fundamental data Parquet conversion failed:', error);
    }
  }

  async storeAlphaProxyReturns(returns: ProxyReturnSeries[]): Promise<void> {
    if (returns.length === 0) return;

    if (!this.isConnected) {
      this.saveAsJsonl('alpha_returns', returns);
      return;
    }

    const parquetDir = path.join(this.dataDir, 'proxy_data');
    if (!fs.existsSync(parquetDir)) {
      fs.mkdirSync(parquetDir, { recursive: true });
    }

    const fingerprint = returns[0].fingerprint;
    const jsonlPath = path.join(parquetDir, `_staging_alpha_${fingerprint}.jsonl`);
    const parquetPath = path.join(parquetDir, `alpha_returns_${fingerprint}.parquet`);

    const jsonlLines = returns.map(row => JSON.stringify(row));
    fs.writeFileSync(jsonlPath, jsonlLines.join('\n'));

    try {
      this.db!.execute(`
        COPY (SELECT * FROM read_json_auto('${jsonlPath}'))
        TO '${parquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
      `);

      fs.unlinkSync(jsonlPath);

      // Register a unified view that combines all alpha returns
      this.rebuildAlphaReturnsView();
    } catch (error) {
      console.warn('[DataWarehouse] Alpha returns Parquet conversion failed:', error);
    }
  }

  private rebuildAlphaReturnsView(): void {
    if (!this.db) return;

    const parquetDir = path.join(this.dataDir, 'proxy_data');
    const alphaFiles = fs.readdirSync(parquetDir)
      .filter(f => f.startsWith('alpha_returns_') && f.endsWith('.parquet'));

    if (alphaFiles.length === 0) return;

    const paths = alphaFiles.map(f => `'${path.join(parquetDir, f)}'`).join(', ');

    try {
      this.db!.execute(`
        CREATE OR REPLACE VIEW all_alpha_returns AS
        SELECT * FROM read_parquet([${paths}])
      `);
    } catch {
      // View creation might fail if files are incompatible
    }
  }

  private saveAsJsonl(prefix: string, data: unknown[], partition?: string): void {
    const jsonlDir = path.join(this.dataDir, 'jsonl_fallback');
    if (!fs.existsSync(jsonlDir)) {
      fs.mkdirSync(jsonlDir, { recursive: true });
    }

    const suffix = partition ? `_${partition}` : '';
    const jsonlPath = path.join(jsonlDir, `${prefix}${suffix}.jsonl`);

    const lines = data.map(row => JSON.stringify(row));
    fs.writeFileSync(jsonlPath, lines.join('\n'));
  }

  // --- Analytical Queries (DuckDB SQL on Parquet) ---

  /**
   * Pre-Simulation Correlation Prediction via PCA
   * Computes correlation between a new alpha's proxy returns and existing alphas
   */
  async computeProxyCorrelation(
    newReturns: Array<{ ticker: string; date: string; proxy_return: number }>,
    _existingFingerprints?: string[]
  ): Promise<CorrelationResult[]> {
    if (!this.isConnected) {
      // Fallback: compute correlation in-process
      return this.fallbackCorrelation(newReturns);
    }

    // Temporarily store new returns for cross-referencing
    const stagingPath = path.join(this.dataDir, 'proxy_data', '_new_returns.parquet');
    const jsonlPath = path.join(this.dataDir, 'proxy_data', '_new_returns.jsonl');

    const jsonlLines = newReturns.map(r => JSON.stringify(r));
    fs.writeFileSync(jsonlPath, jsonlLines.join('\n'));

    try {
      this.db!.execute(`
        COPY (SELECT * FROM read_json_auto('${jsonlPath}'))
        TO '${stagingPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
      `);
      fs.unlinkSync(jsonlPath);

      // Cross-correlate with all existing alpha returns
      const existingFiles = fs.readdirSync(path.join(this.dataDir, 'proxy_data'))
        .filter(f => f.startsWith('alpha_returns_') && f.endsWith('.parquet'));

      if (existingFiles.length === 0) return [];

      const existingPaths = existingFiles
        .filter(f => !f.includes('_new_returns'))
        .map(f => `'${path.join(this.dataDir, 'proxy_data', f)}'`)
        .join(', ');

      // Query: compute pairwise correlation between new alpha and all existing alphas
      const result = this.db!.query(`
        SELECT
          n.fingerprint as fingerprint1,
          e.fingerprint as fingerprint2,
          CORR(n.proxy_return, e.proxy_return) as correlation
        FROM read_parquet('${stagingPath}') n
        INNER JOIN read_parquet([${existingPaths}]) e
          ON n.ticker = e.ticker AND n.date = e.date
        GROUP BY n.fingerprint, e.fingerprint
        HAVING COUNT(*) > 20
        ORDER BY ABS(correlation) DESC
        LIMIT 50
      `);

      return result.toArray() as unknown as CorrelationResult[];
    } finally {
      // Clean up
      try { if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath); } catch { /* ignore */ }
      try { if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath); } catch { /* ignore */ }
    }
  }

  /**
   * Compute auto-correlation for tickers (used for momentum signal validation)
   */
  async computeAutoCorrelations(lag: number = 1): Promise<AutoCorrelationResult[]> {
    if (!this.isConnected) {
      return [];
    }

    const proxyDir = path.join(this.dataDir, 'proxy_data');
    const priceFiles = fs.readdirSync(proxyDir)
      .filter(f => f.startsWith('proxy_prices_') && f.endsWith('.parquet'));

    if (priceFiles.length === 0) return [];

    const pricePaths = priceFiles.map(f => `'${path.join(proxyDir, f)}'`).join(', ');

    try {
      const result = this.db!.query(`
        WITH lagged AS (
          SELECT
            ticker,
            date,
            close,
            LAG(close, ${lag}) OVER (PARTITION BY ticker ORDER BY date) as lagged_close
          FROM read_parquet([${pricePaths}])
          WHERE close IS NOT NULL
        )
        SELECT
          ticker,
          CORR(close, lagged_close) as auto_corr
        FROM lagged
        WHERE lagged_close IS NOT NULL
        GROUP BY ticker
        HAVING COUNT(*) > 100
        ORDER BY auto_corr DESC
        LIMIT 1000
      `);

      return result.toArray().map((row: Record<string, unknown>) => ({
        ticker: row.ticker as string,
        auto_corr_1d: row.auto_corr as number,
        auto_corr_5d: 0,
        auto_corr_10d: 0,
        auto_corr_21d: 0,
      })) as AutoCorrelationResult[];
    } catch {
      return [];
    }
  }

  /**
   * PCA Coverage: estimate how much variance a new alpha's returns
   * are explained by existing principal components
   */
  async computePCACoverage(newReturns: Array<{ ticker: string; date: string; proxy_return: number }>): Promise<{
    coverage: number;
    topCorrelations: CorrelationResult[];
    recommendation: string;
  }> {
    const correlations = await this.computeProxyCorrelation(newReturns);

    if (correlations.length === 0) {
      return { coverage: 0, topCorrelations: [], recommendation: 'No existing data for comparison. Alpha appears diverse.' };
    }

    // Use top 3 absolute correlations as PCA coverage proxy
    const top3 = correlations.slice(0, 3);
    const avgTopCorr = top3.reduce((s, c) => s + Math.abs(c.correlation), 0) / Math.min(3, correlations.length);
    const coverage = Math.min(1.0, avgTopCorr);

    let recommendation: string;
    if (coverage > 0.7) {
      recommendation = `High correlation (coverage: ${(coverage * 100).toFixed(1)}%) with existing portfolio. Consider discarding or significantly modifying.`;
    } else if (coverage > 0.4) {
      recommendation = `Moderate correlation (coverage: ${(coverage * 100).toFixed(1)}%). Acceptable but monitor post-simulation.`;
    } else {
      recommendation = `Low correlation (coverage: ${(coverage * 100).toFixed(1)}%). Good diversity - proceed with simulation.`;
    }

    return { coverage, topCorrelations: top3, recommendation };
  }

  /**
   * Get fundamental data for a specific ticker (for style premia assessment)
   */
  async getTickerFundamentals(ticker: string): Promise<FundamentalRow[]> {
    if (!this.isConnected) return [];

    const fundamentalFiles = fs.readdirSync(path.join(this.dataDir, 'proxy_data'))
      .filter(f => f.startsWith('fundamental_') && f.endsWith('.parquet'));

    if (fundamentalFiles.length === 0) return [];

    const paths = fundamentalFiles.map(f => `'${path.join(this.dataDir, 'proxy_data', f)}'`).join(', ');

    try {
      this.db!.query(`
        SELECT * FROM read_parquet([${paths}])
        WHERE ticker = ?
        ORDER BY date DESC
        LIMIT 252
      `);
      // DuckDB parameterized queries - fallback to inline
      return this.db!.query(`
        SELECT * FROM read_parquet([${paths}])
        WHERE ticker = '${ticker}'
        ORDER BY date DESC
        LIMIT 252
      `).toArray() as unknown as FundamentalRow[];
    } catch {
      return [];
    }
  }

  /**
   * Run arbitrary analytical SQL on the warehouse
   */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    if (!this.isConnected) return [];

    try {
      const result = this.db!.query(sql);
      return result.toArray();
    } catch (error) {
      console.warn('[DataWarehouse] Query failed:', error);
      return [];
    }
  }

  // --- Fallback Methods (when DuckDB is unavailable) ---

  private fallbackCorrelation(
    newReturns: Array<{ ticker: string; date: string; proxy_return: number }>,
    _existingFingerprints?: string[]
  ): CorrelationResult[] {
    // Load existing returns from JSONL fallback
    const jsonlDir = path.join(this.dataDir, 'jsonl_fallback');
    if (!fs.existsSync(jsonlDir)) return [];

    const alphaReturnFiles = fs.readdirSync(jsonlDir)
      .filter(f => f.startsWith('alpha_returns') && f.endsWith('.jsonl'));

    const results: CorrelationResult[] = [];
    const newByTickerDate = new Map<string, number>();
    for (const r of newReturns) {
      newByTickerDate.set(`${r.ticker}_${r.date}`, r.proxy_return);
    }

    for (const file of alphaReturnFiles) {
      try {
        const lines = fs.readFileSync(path.join(jsonlDir, file), 'utf-8').split('\n').filter(Boolean);
        const existingByTickerDate = new Map<string, number>();
        let fingerprint = '';

        for (const line of lines.slice(0, 50)) {
          const row = JSON.parse(line) as ProxyReturnSeries;
          fingerprint = row.fingerprint;
          existingByTickerDate.set(`${row.ticker}_${row.date}`, row.proxy_return);
        }

        // Compute correlation
        let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, n = 0;
        for (const [key, newVal] of newByTickerDate) {
          const existingVal = existingByTickerDate.get(key);
          if (existingVal !== undefined) {
            sumXY += newVal * existingVal;
            sumX += newVal;
            sumY += existingVal;
            sumX2 += newVal * newVal;
            sumY2 += existingVal * existingVal;
            n++;
          }
        }

        if (n > 20) {
          const corr = (n * sumXY - sumX * sumY) /
            Math.sqrt(Math.max(0.0001, (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)));

          results.push({
            fingerprint1: 'new',
            fingerprint2: fingerprint,
            correlation: corr,
          });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 50);
  }

  // --- Maintenance ---

  getStats(): WarehouseStats {
    const proxyDir = path.join(this.dataDir, 'proxy_data');
    let parquetFiles = 0;
    let totalSizeBytes = 0;
    const tables: string[] = [];

    if (fs.existsSync(proxyDir)) {
      const files = fs.readdirSync(proxyDir);
      for (const file of files) {
        if (file.endsWith('.parquet')) {
          parquetFiles++;
          try {
            totalSizeBytes += fs.statSync(path.join(proxyDir, file)).size;
          } catch { /* ignore */ }
          tables.push(file.replace('.parquet', ''));
        }
      }
    }

    return {
      parquetFiles,
      totalSizeBytes,
      tickersCount: 0, // Would need a query to determine
      dateRange: null, // Would need a query to determine
      tables,
    };
  }

  getStorageSize(): number {
    const proxyDir = path.join(this.dataDir, 'proxy_data');
    if (!fs.existsSync(proxyDir)) return 0;

    let totalSize = 0;
    const walkDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) walkDir(filePath);
        else totalSize += stat.size;
      }
    };

    walkDir(this.dataDir);
    return totalSize;
  }

  clearProxyData(): void {
    const proxyDir = path.join(this.dataDir, 'proxy_data');
    if (fs.existsSync(proxyDir)) {
      fs.rmSync(proxyDir, { recursive: true, force: true });
    }
    const jsonlDir = path.join(this.dataDir, 'jsonl_fallback');
    if (fs.existsSync(jsonlDir)) {
      fs.rmSync(jsonlDir, { recursive: true, force: true });
    }
    // Recreate directories
    fs.mkdirSync(proxyDir, { recursive: true });
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
      this.isConnected = false;
    }
  }
}

// Singleton
let warehouseInstance: DataWarehouse | null = null;

export async function getDataWarehouse(): Promise<DataWarehouse> {
  if (!warehouseInstance) {
    warehouseInstance = new DataWarehouse();
    await warehouseInstance.connect();
  }
  return warehouseInstance;
}
