// ============================================================
// Model Provider Abstraction - Unified interface for multiple LLM providers
// ============================================================

import OpenAI from 'openai';
import { ModelInfo, ModelProvider, ProviderPreset, ThinkingConfig, ProviderHealth, FallbackConfig } from './types';
import { PROVIDER_PRESETS } from './constants';
import { RateLimiter } from './rate-limiter';
import { getDatabase } from './persistence/database';

export class ModelProviderClient {
  private client: OpenAI | null = null;
  private provider: ModelProvider | null = null;
  private rateLimiter: RateLimiter;
  private completionCache = new Map<string, { content: string; expiresAt: number }>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private retryCount = 0;

  private health: ProviderHealth = {
    consecutiveFailures: 0,
    totalFailures: 0,
    lastSuccess: null,
    avgLatencyMs: 0,
    isStuck: false,
  };

  private fallbackConfig: FallbackConfig = {
    enabled: false,
    fallbackModelId: null,
    failureThreshold: 5,
  };

  private thinkingConfig: ThinkingConfig = {
    mode: 'auto',
    budgetTokens: 8000,
  };

  private currentModelId: string | null = null;
  private primaryModelId: string | null = null;

  constructor() {
    this.rateLimiter = new RateLimiter({
      maxPerMinute: 20,
      maxPerHour: 200,
      minIntervalMs: 3000,
    });
  }

  connect(provider: ModelProvider): void {
    this.provider = provider;
    this.client = new OpenAI({
      baseURL: provider.baseUrl,
      apiKey: provider.apiKey,
      timeout: 600_000,
    });
    this.resetHealth();
  }

  disconnect(): void {
    this.client = null;
    this.provider = null;
    this.currentModelId = null;
    this.primaryModelId = null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  setCurrentModel(modelId: string): void {
    if (!this.primaryModelId) {
      this.primaryModelId = modelId;
    }
    this.currentModelId = modelId;
  }

  getCurrentModel(): string | null {
    return this.currentModelId;
  }

  getPrimaryModel(): string | null {
    return this.primaryModelId;
  }

  isUsingFallback(): boolean {
    return this.currentModelId !== null && this.primaryModelId !== null && this.currentModelId !== this.primaryModelId;
  }

  setThinkingConfig(config: ThinkingConfig): void {
    this.thinkingConfig = config;
  }

  getThinkingConfig(): ThinkingConfig {
    return this.thinkingConfig;
  }

  setFallbackConfig(config: FallbackConfig): void {
    this.fallbackConfig = { ...this.fallbackConfig, ...config };
  }

  getFallbackConfig(): FallbackConfig {
    return this.fallbackConfig;
  }

  private resetHealth(): void {
    this.health = {
      consecutiveFailures: 0,
      totalFailures: 0,
      lastSuccess: null,
      avgLatencyMs: 0,
      isStuck: false,
    };
  }

  recordFailure(): void {
    this.health.consecutiveFailures++;
    this.health.totalFailures++;
    if (this.health.consecutiveFailures >= 3) {
      this.health.isStuck = true;
    }
  }

  recordSuccess(latencyMs: number): void {
    this.health.lastSuccess = new Date().toISOString();
    this.health.consecutiveFailures = 0;
    this.health.isStuck = false;
    if (this.health.avgLatencyMs === 0) {
      this.health.avgLatencyMs = latencyMs;
    } else {
      this.health.avgLatencyMs = (this.health.avgLatencyMs * 0.7) + (latencyMs * 0.3);
    }
  }

  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  shouldUseFallback(): boolean {
    return (
      this.fallbackConfig.enabled &&
      this.fallbackConfig.fallbackModelId !== null &&
      this.health.consecutiveFailures >= this.fallbackConfig.failureThreshold
    );
  }

  getFallbackModelId(): string | null {
    return this.fallbackConfig.fallbackModelId;
  }

  switchToFallback(): void {
    if (this.fallbackConfig.fallbackModelId) {
      this.currentModelId = this.fallbackConfig.fallbackModelId;
      this.health.isStuck = false;
    }
  }

  switchToPrimary(): void {
    if (this.primaryModelId) {
      this.currentModelId = this.primaryModelId;
    }
  }

  getActiveModelId(): string {
    return this.currentModelId || this.primaryModelId || '';
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.client) throw new Error('Provider not connected');

    try {
      const response = await this.client.models.list();
      const modelSet = new Set<string>();
      const models: ModelInfo[] = [];

      for (const model of response.data) {
        if (modelSet.has(model.id)) continue;
        modelSet.add(model.id);
        models.push({
          id: model.id,
          name: model.id,
          provider: this.provider!.name,
          providerId: this.provider!.id,
          description: undefined,
          contextWindow: undefined,
        });
      }

      return models;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch models: ${msg}`);
    }
  }

  async chatCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    modelId: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
    responseFormat?: { type: 'json_object' | 'text' },
    thinking?: ThinkingConfig
  ): Promise<string> {
    if (!this.client) throw new Error('Provider not connected');

    this.setCurrentModel(modelId);
    const startTime = Date.now();

    const activeThinking = thinking || this.thinkingConfig;

    const cacheKey = this.buildCompletionCacheKey(messages, modelId, temperature, maxTokens, responseFormat);
    const cached = this.getCachedCompletion(cacheKey);
    if (cached) return cached;

    await this.rateLimiter.acquire();
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        let completion;

        const baseParams = {
          model: modelId,
          messages: messages.map(m => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
          })),
          temperature,
          max_tokens: maxTokens,
        };

        try {
          if (activeThinking.mode !== 'disabled' && activeThinking.mode !== 'auto') {
            completion = await this.client.chat.completions.create({
              ...baseParams,
              ...(responseFormat ? { response_format: responseFormat } : {}),
              // @ts-expect-error - thinking is not in SDK types yet but supported by OpenAI API
              thinking: {
                type: 'enabled' as const,
                budget_tokens: activeThinking.budgetTokens || 8000,
              },
            });
          } else {
            completion = await this.client.chat.completions.create({
              ...baseParams,
              ...(responseFormat ? { response_format: responseFormat } : {}),
            });
          }
        } catch (formatErr: unknown) {
          if (responseFormat && this.isUnsupportedResponseFormatError(formatErr)) {
            completion = await this.client.chat.completions.create(baseParams);
          } else {
            throw formatErr;
          }
        }

        const content = completion.choices[0]?.message?.content;
        if (!content) throw new Error('Empty response from model (possible timeout)');

        this.rateLimiter.decayAdaptiveBackoff();
        this.setCachedCompletion(cacheKey, content, 120000);
        this.recordSuccess(Date.now() - startTime);
        return content;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= maxRetries || !this.isRetryableCompletionError(error)) {
          this.recordFailure();
          const msg = lastError.message;
          throw new Error(`Chat completion failed: ${msg}`);
        }

        this.retryCount++;
        const retryAfterMs = this.getRetryAfterMs(error);
        this.rateLimiter.applyBackoffHint(attempt);
        if (retryAfterMs > 0) {
          this.rateLimiter.applyPenalty(retryAfterMs);
        } else {
          const backoffMs = Math.min(60000, 1200 * (2 ** attempt) + Math.floor(Math.random() * 500));
          this.rateLimiter.applyPenalty(backoffMs);
        }

        await this.rateLimiter.acquire();
      }
    }

    this.recordFailure();
    throw lastError || new Error('Chat completion failed after retries');
  }

  async testConnection(): Promise<{ success: boolean; message: string; modelCount?: number }> {
    if (!this.client || !this.provider) {
      return { success: false, message: 'Provider not connected' };
    }

    try {
      const models = await this.listModels();
      return {
        success: true,
        message: `Connected to ${this.provider.name}. Found ${models.length} models.`,
        modelCount: models.length,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Connection failed: ${msg}` };
    }
  }

  getRateLimitStats(): {
    callsInLastMinute: number;
    callsInLastHour: number;
    minIntervalMs: number;
    adaptiveMinIntervalMs: number;
    throttledCount: number;
    penaltyCount: number;
    penaltyActive: boolean;
    retryCount: number;
    cacheHits: number;
    cacheMisses: number;
    cacheSize: number;
  } {
    return {
      ...this.rateLimiter.getStats(),
      retryCount: this.retryCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheSize: this.completionCache.size,
    };
  }

  updateRateLimitConfig(config: { maxPerMinute?: number; maxPerHour?: number; minIntervalMs?: number }): void {
    this.rateLimiter.updateConfig(config);
  }

  private buildCompletionCacheKey(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    modelId: string,
    temperature: number,
    maxTokens: number,
    responseFormat?: { type: 'json_object' | 'text' }
  ): string {
    return JSON.stringify({
      modelId,
      temperature,
      maxTokens,
      responseFormat: responseFormat?.type || 'text',
      messages,
    });
  }

  private getCachedCompletion(cacheKey: string): string | null {
    const now = Date.now();
    const hit = this.completionCache.get(cacheKey);
    if (!hit) {
      this.cacheMisses++;
      return null;
    }
    if (hit.expiresAt <= now) {
      this.completionCache.delete(cacheKey);
      this.cacheMisses++;
      return null;
    }
    this.cacheHits++;
    return hit.content;
  }

  private setCachedCompletion(cacheKey: string, content: string, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.completionCache.set(cacheKey, { content, expiresAt });

    // Keep cache bounded and remove expired entries opportunistically.
    if (this.completionCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.completionCache) {
        if (v.expiresAt <= now) this.completionCache.delete(k);
      }
      if (this.completionCache.size > 500) {
        const firstKey = this.completionCache.keys().next().value;
        if (typeof firstKey === 'string') this.completionCache.delete(firstKey);
      }
    }
  }

  private isRetryableCompletionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('timeout') ||
      msg.includes('temporarily unavailable')
    );
  }

  private getRetryAfterMs(error: unknown): number {
    if (!(error instanceof Error)) return 0;
    const msg = error.message.toLowerCase();
    // Support patterns like "retry after 2s" or "retry_after=1500ms".
    const seconds = msg.match(/retry[-_\s]*after[:=\s]+(\d+)\s*s/);
    if (seconds) return Number(seconds[1]) * 1000;
    const millis = msg.match(/retry[-_\s]*after[:=\s]+(\d+)\s*ms/);
    if (millis) return Number(millis[1]);
    return 0;
  }

  private isUnsupportedResponseFormatError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('response_format') ||
      msg.includes('response format') ||
      msg.includes('unsupported') ||
      msg.includes('not supported') ||
      msg.includes('invalid param') ||
      msg.includes('invalid parameter')
    );
  }
}

// Singleton instance for server-side use
let providerClientInstance: ModelProviderClient | null = null;

export function getProviderClient(): ModelProviderClient {
  if (!providerClientInstance) {
    providerClientInstance = new ModelProviderClient();
  }
  return providerClientInstance;
}

export function getProviderPresets(): ProviderPreset[] {
  return PROVIDER_PRESETS;
}

// Auto-restore providers from SQLite on module load (server startup)
// This runs once when the module is first imported
let providersRestored = false;
function ensureProvidersRestored(): void {
  if (!providersRestored) {
    providersRestored = true;
    try {
      restoreProvidersFromDB();
    } catch {
      // Non-fatal
    }
  }
}
const providerStore = new Map<string, ModelProvider>();

export function saveProvider(provider: ModelProvider): void {
  providerStore.set(provider.id, provider);
  // Persist to SQLite
  try {
    getDatabase().saveProviderConfig({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      isActive: provider.isActive,
      createdAt: provider.createdAt,
    });
  } catch { /* non-fatal: in-memory fallback */ }
}

export function getProvider(id: string): ModelProvider | undefined {
  ensureProvidersRestored();
  return providerStore.get(id);
}

export function getAllProviders(): ModelProvider[] {
  ensureProvidersRestored();
  return Array.from(providerStore.values());
}

export function deleteProvider(id: string): boolean {
  const deleted = providerStore.delete(id);
  // Also delete from SQLite
  try { getDatabase().deleteProviderConfig(id); } catch { /* non-fatal */ }
  return deleted;
}

export function setActiveProvider(id: string): void {
  for (const [key, provider] of providerStore) {
    provider.isActive = key === id;
  }
  // Persist active state to SQLite
  try { getDatabase().setActiveProviderConfig(id); } catch { /* non-fatal */ }
}

export function saveModelSelection(providerId: string, modelId: string): void {
  try { getDatabase().saveModelSelection(providerId, modelId); } catch { /* non-fatal */ }
}

export function getModelSelection(providerId: string): string | null {
  try { return getDatabase().getModelSelection(providerId); } catch { return null; }
}

/**
 * Restore providers from SQLite on server startup.
 * Called once during initialization to reload persisted configs.
 */
export function restoreProvidersFromDB(): void {
  try {
    const db = getDatabase();
    const configs = db.getAllProviderConfigs();
    for (const config of configs) {
      const provider: ModelProvider = {
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        isActive: config.isActive,
        createdAt: config.createdAt,
      };
      providerStore.set(provider.id, provider);
    }
    if (configs.length > 0) {
      console.log(`[Provider] Restored ${configs.length} provider config(s) from SQLite`);
    }
  } catch {
    // Non-fatal: providers will start empty
  }
}
