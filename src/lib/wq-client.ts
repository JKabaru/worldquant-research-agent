// ============================================================
// WorldQuant BRAIN API Client
// Handles authentication, simulation, alpha management
// ============================================================

import {
  WQCredentials,
  WQSession,
  WQSimulationRequest,
  WQSimulationResult,
  WQAlpha,
  WQDataField,
  WQOperator,
  WQPerformanceComparison,
  WQSimulationEnrichment,
} from './types';

const WQ_BASE_URL = 'https://api.worldquantbrain.com';

interface WQAPISession {
  cookies: string;
  headers: Record<string, string>;
}

export class WorldQuantBrainClient {
  private session: WQAPISession | null = null;
  private credentials: WQCredentials | null = null;

  private extractPerformanceComparison(payload: Record<string, unknown>): WQPerformanceComparison {
    const perf =
      (payload.performanceComparison as Record<string, unknown>) ||
      (payload.performance_comparison as Record<string, unknown>) ||
      (((payload.is as Record<string, unknown>) || {}).performanceComparison as Record<string, unknown>) ||
      {};

    const toNumber = (v: unknown): number | undefined => typeof v === 'number' ? v : undefined;
    return {
      sharpeDiff: toNumber(perf.sharpeDiff ?? perf.sharpe_diff),
      fitnessDiff: toNumber(perf.fitnessDiff ?? perf.fitness_diff),
      returnsDiff: toNumber(perf.returnsDiff ?? perf.returns_diff),
      marginDiff: toNumber(perf.marginDiff ?? perf.margin_diff),
      drawdownDiff: toNumber(perf.drawdownDiff ?? perf.drawdown_diff),
      turnoverDiff: toNumber(perf.turnoverDiff ?? perf.turnover_diff),
      benchmark: typeof (perf.benchmark) === 'string' ? (perf.benchmark as string) : undefined,
    };
  }

  private buildEnrichment(
    alphaPayload: Record<string, unknown>,
    alphaMetrics: { turnover: number; drawdown: number; margin: number; checks: Array<{ result: 'PASS' | 'FAIL' }> }
  ): WQSimulationEnrichment {
    const performanceComparison = this.extractPerformanceComparison(alphaPayload);
    const totalChecks = alphaMetrics.checks.length || 1;
    const passChecks = alphaMetrics.checks.filter(c => c.result === 'PASS').length;
    const checksPassRate = passChecks / totalChecks;
    const turnoverPenalty = Math.max(0, alphaMetrics.turnover - 0.7);
    const drawdownPenalty = Math.max(0, alphaMetrics.drawdown - 0.2);
    const marginBonus = Math.max(0, alphaMetrics.margin / 100);

    const robustnessScore = Math.max(
      0,
      1.0
      + (performanceComparison.sharpeDiff || 0) * 0.25
      + (performanceComparison.fitnessDiff || 0) * 0.2
      + marginBonus * 0.1
      - turnoverPenalty * 0.5
      - drawdownPenalty * 0.5
      + checksPassRate * 0.25
    );

    return {
      performanceComparison,
      robustnessScore,
      qualitySignals: {
        checksPassRate,
        turnoverPenalty,
        drawdownPenalty,
        marginBonus,
      },
    };
  }

  // --- Authentication ---

  async authenticate(credentials: WQCredentials): Promise<WQSession> {
    this.credentials = credentials;

    const authHeader = 'Basic ' + Buffer.from(`${credentials.email}:${credentials.password}`).toString('base64');

    const response = await fetch(`${WQ_BASE_URL}/authentication`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      redirect: 'manual',
    });

    if (response.status !== 201) {
      const text = await response.text();
      throw new Error(`Authentication failed (${response.status}): ${text}`);
    }

    // Extract cookies from response
    const setCookieHeader = response.headers.get('set-cookie') || '';
    const cookies = setCookieHeader.split(',').map(c => c.split(';')[0]).join('; ');

    this.session = {
      cookies,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': cookies,
      },
    };

    return {
      isAuthenticated: true,
      cookies,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  private ensureAuth(): void {
    if (!this.session) throw new Error('Not authenticated. Please log in first.');
  }

  private async apiRequest(
    method: string,
    path: string,
    body?: unknown,
    retries: number = 1
  ): Promise<Response> {
    this.ensureAuth();

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(`${WQ_BASE_URL}${path}`, {
        method,
        headers: { ...this.session!.headers },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle 401 - re-authenticate
      if (response.status === 401 && this.credentials && attempt < retries) {
        await this.authenticate(this.credentials);
        continue;
      }

      // Handle 429 - rate limited
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '30', 10);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue;
        }
      }

      return response;
    }

    throw new Error('Max retries exceeded');
  }

  // --- Simulation ---

  async submitSimulation(request: WQSimulationRequest): Promise<{ progressUrl: string; simulationId: string }> {
    this.ensureAuth();

    const response = await this.apiRequest('POST', '/simulations', request);

    if (response.status !== 201) {
      const text = await response.text();
      throw new Error(`Simulation submission failed (${response.status}): ${text}`);
    }

    const location = response.headers.get('Location') || '';
    if (!location) throw new Error('No Location header in simulation response');

    return {
      progressUrl: location,
      simulationId: location.split('/').pop() || '',
    };
  }

  async pollSimulation(progressUrl: string, maxWaitMs: number = 300000, onProgress?: (status: string) => void): Promise<WQSimulationResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const response = await this.apiRequest('GET', progressUrl.replace(WQ_BASE_URL, ''));

      if (response.ok) {
        const retryAfter = response.headers.get('Retry-After');

        if (retryAfter) {
          onProgress?.(`Waiting... retry in ${retryAfter}s`);
          await new Promise(r => setTimeout(r, parseFloat(retryAfter) * 1000));
          continue;
        }

        const data = await response.json();
        const status = data.status;

        onProgress?.(`Status: ${status}`);

        if (status === 'COMPLETE') {
          const alphaId = data.alpha;
          if (alphaId) {
            const alpha = await this.getAlpha(alphaId);
            return {
              id: progressUrl.split('/').pop() || '',
              status: 'COMPLETE',
              alphaId,
              alpha,
              enrichment: alpha.enrichment,
            };
          }
          return { id: '', status: 'COMPLETE' };
        }

        if (status === 'FAILED' || status === 'ERROR') {
          return {
            id: progressUrl.split('/').pop() || '',
            status: status as 'FAILED' | 'ERROR',
            error: data.error || data.message || 'Simulation failed',
          };
        }

        // Still running - wait a bit
        await new Promise(r => setTimeout(r, 5000));
      } else {
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    return { id: '', status: 'PENDING', error: 'Polling timeout exceeded' };
  }

  // --- Alpha Management ---

  async getAlpha(alphaId: string): Promise<WQAlpha> {
    const response = await this.apiRequest('GET', `/alphas/${alphaId}`);
    if (!response.ok) throw new Error(`Failed to fetch alpha ${alphaId}`);

    const data = await response.json();
    const isData = data.is || {};

    const checks = (isData.checks || []).map((c: Record<string, string>) => ({
      result: (c.result || 'FAIL') as 'PASS' | 'FAIL',
      name: c.name || '',
      description: c.description,
    }));
    const turnover = isData.turnover || 0;
    const drawdown = isData.drawdown || 0;
    const margin = isData.margin || 0;
    const enrichment = this.buildEnrichment(data as Record<string, unknown>, {
      turnover,
      drawdown,
      margin,
      checks,
    });

    return {
      id: data.id,
      code: data.regular?.code || data.code || '',
      dateCreated: data.dateCreated || '',
      sharpe: isData.sharpe || 0,
      fitness: isData.fitness || 0,
      turnover,
      margin,
      returns: isData.returns || 0,
      drawdown,
      longCount: isData.longCount || 0,
      shortCount: isData.shortCount || 0,
      pnl: isData.pnl || 0,
      volatility: isData.volatility || 0,
      maxDrawdown: isData.maxDrawdown || 0,
      winRate: isData.winRate || 0,
      avgReturn: isData.avgReturn || 0,
      checks,
      correlations: data.correlations || { powerPool: {}, prod: {} },
      performanceComparison: enrichment.performanceComparison,
      enrichment,
      settings: data.settings || {},
      isSubmitted: data.status === 'SUBMITTED' || data.status === 'UNSUBMITTED',
      status: data.status || 'ACTIVE',
    };
  }

  async listUserAlphas(params?: {
    limit?: number;
    offset?: number;
    status?: string;
    minFitness?: number;
    minSharpe?: number;
    order?: string;
  }): Promise<{ count: number; results: WQAlpha[] }> {
    const statusesToTry = params?.status ? [params.status] : ['ACTIVE', 'SUBMITTED', undefined];
    let allResults: WQAlpha[] = [];
    let totalCount = 0;

    for (const tryStatus of statusesToTry) {
      const queryParams = new URLSearchParams();
      queryParams.set('limit', (params?.limit || 20).toString());
      queryParams.set('offset', (params?.offset || 0).toString());
      queryParams.set('hidden', 'false');
      if (tryStatus) queryParams.set('status', tryStatus);
      if (params?.minFitness) queryParams.set('is.fitness>', params.minFitness.toString());
      if (params?.minSharpe) queryParams.set('is.sharpe>', params.minSharpe.toString());
      if (params?.order) queryParams.set('order', params.order);
      else queryParams.set('order', '-dateCreated');

      const queryString = queryParams.toString();

      const response = await this.apiRequest('GET', `/users/self/alphas?${queryString}`);
      if (!response.ok) continue;

      const data = await response.json();
      if (data.results && data.results.length > 0) {
        const results = (data.results || []).map((a: Record<string, unknown>) => {
          const isData = (a.is || {}) as Record<string, unknown>;
          const checks = ((isData.checks || []) as Record<string, string>[]).map((c: Record<string, string>) => ({
            result: (c.result || 'FAIL') as 'PASS' | 'FAIL',
            name: c.name || '',
            description: c.description,
          }));
          const turnover = (isData.turnover as number) || 0;
          const drawdown = (isData.drawdown as number) || 0;
          const margin = (isData.margin as number) || 0;
          const enrichment = this.buildEnrichment(a, {
            turnover,
            drawdown,
            margin,
            checks,
          });
          return {
            id: a.id as string,
            code: ((a.regular as Record<string, unknown>)?.code || '') as string,
            dateCreated: a.dateCreated as string,
            sharpe: (isData.sharpe as number) || 0,
            fitness: (isData.fitness as number) || 0,
            turnover,
            margin,
            returns: (isData.returns as number) || 0,
            drawdown,
            longCount: (isData.longCount as number) || 0,
            shortCount: (isData.shortCount as number) || 0,
            pnl: (isData.pnl as number) || 0,
            volatility: (isData.volatility as number) || 0,
            maxDrawdown: (isData.maxDrawdown as number) || 0,
            winRate: (isData.winRate as number) || 0,
            avgReturn: (isData.avgReturn as number) || 0,
            checks,
            correlations: (a.correlations || { powerPool: {}, prod: {} }) as Record<string, Record<string, number>>,
            performanceComparison: enrichment.performanceComparison,
            enrichment,
            settings: (a.settings || {}) as Record<string, unknown>,
            isSubmitted: a.status === 'SUBMITTED' || a.status === 'UNSUBMITTED',
            status: (a.status || 'ACTIVE') as string,
          };
        });
        return { count: data.count || 0, results };
      }
    }

    return { count: 0, results: [] };
  }

  async submitAlpha(alphaId: string): Promise<{ success: boolean; message: string }> {
    const response = await this.apiRequest('POST', `/alphas/${alphaId}/submit`);

    if (response.status === 201) {
      return { success: true, message: 'Alpha submitted for review' };
    }
    if (response.status === 409) {
      return { success: true, message: 'Alpha already submitted' };
    }

    const text = await response.text();
    return { success: false, message: `Submit failed: ${text}` };
  }

  async setAlphaProperties(alphaId: string, properties: {
    name?: string;
    color?: string;
    tags?: string[];
    description?: string;
  }): Promise<void> {
    await this.apiRequest('PATCH', `/alphas/${alphaId}`, {
      color: properties.color,
      name: properties.name,
      tags: properties.tags,
      regular: properties.description ? { description: properties.description } : undefined,
    });
  }

  // --- Data Discovery ---

  async getDataFields(params: {
    region: string;
    universe: string;
    delay: number;
    datasetId?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ results: WQDataField[]; count: number; next?: string }> {
    const queryParams = new URLSearchParams();
    queryParams.set('instrumentType', 'EQUITY');
    queryParams.set('region', params.region);
    queryParams.set('universe', params.universe);
    queryParams.set('delay', params.delay.toString());
    queryParams.set('limit', (params.limit || 100).toString());
    queryParams.set('offset', (params.offset || 0).toString());
    if (params.datasetId) queryParams.set('dataset.id', params.datasetId);
    if (params.category) queryParams.set('category', params.category);

    const response = await this.apiRequest('GET', `/data-fields?${queryParams.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch data fields');

    const data = await response.json();
    return {
      results: (data.results || []).map((f: Record<string, unknown>) => ({
        id: f.id as string,
        description: (f.description as string) || '',
        datasetId: ((f.dataset as Record<string, unknown>)?.id || '') as string,
        datasetName: ((f.dataset as Record<string, unknown>)?.name || '') as string,
        category: (f.category as string) || '',
        type: (f.type as string) || '',
        delay: (f.delay as number) || 0,
      })),
      count: data.count || 0,
      next: data.next,
    };
  }

  async getDatasets(params: {
    region: string;
    universe: string;
    delay: number;
    category?: string;
  }): Promise<Array<{ id: string; name: string; category: string; fieldCount?: number }>> {
    const queryParams = new URLSearchParams();
    queryParams.set('instrumentType', 'EQUITY');
    queryParams.set('region', params.region);
    queryParams.set('universe', params.universe);
    queryParams.set('delay', params.delay.toString());
    queryParams.set('limit', '50');
    if (params.category) queryParams.set('category', params.category);

    const response = await this.apiRequest('GET', `/data-sets?${queryParams.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch datasets');

    const data = await response.json();
    return (data.results || []).map((ds: Record<string, unknown>) => ({
      id: ds.id as string,
      name: ds.name as string,
      category: (ds.category as string) || '',
      fieldCount: (ds.fieldCount as number) || undefined,
    }));
  }

  async getOperators(): Promise<WQOperator[]> {
    const response = await this.apiRequest('GET', '/operators');
    if (!response.ok) throw new Error('Failed to fetch operators');

    const data = await response.json();
    return (Array.isArray(data) ? data : data.results || []).map((op: Record<string, unknown>) => ({
      name: op.name as string,
      type: (op.type as string) || '',
      category: (op.category as string) || '',
      definition: (op.definition as string) || '',
      description: (op.description as string) || '',
      minArgs: (op.minArgs as number) || 0,
      maxArgs: (op.maxArgs as number) || 0,
      inputs: ((op.inputs || []) as string[]).map(String),
    }));
  }

  async disconnect(): Promise<void> {
    this.session = null;
    this.credentials = null;
  }
}

// Singleton instance
let wqClientInstance: WorldQuantBrainClient | null = null;

export function getWQClient(): WorldQuantBrainClient {
  if (!wqClientInstance) {
    wqClientInstance = new WorldQuantBrainClient();
  }
  return wqClientInstance;
}
