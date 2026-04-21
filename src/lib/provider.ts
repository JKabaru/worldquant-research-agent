// ============================================================
// Model Provider Abstraction - Unified interface for multiple LLM providers
// ============================================================

import OpenAI from 'openai';
import { ModelInfo, ModelProvider, ProviderPreset } from './types';
import { PROVIDER_PRESETS } from './constants';
import { RateLimiter } from './rate-limiter';
import { getDatabase } from './persistence/database';

export class ModelProviderClient {
  private client: OpenAI | null = null;
  private provider: ModelProvider | null = null;
  private rateLimiter: RateLimiter;

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
    });
  }

  disconnect(): void {
    this.client = null;
    this.provider = null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  getProvider(): ModelProvider | null {
    return this.provider;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.client) throw new Error('Provider not connected');

    try {
      const response = await this.client.models.list();
      const models: ModelInfo[] = [];

      for (const model of response.data) {
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
    responseFormat?: { type: 'json_object' | 'text' }
  ): Promise<string> {
    if (!this.client) throw new Error('Provider not connected');

    // Rate limit the LLM call
    await this.rateLimiter.acquire();

    try {
      const completion = await this.client.chat.completions.create({
        model: modelId,
        messages: messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        temperature,
        max_tokens: maxTokens,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from model');
      return content;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Chat completion failed: ${msg}`);
    }
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

  getRateLimitStats(): { callsInLastMinute: number; callsInLastHour: number } {
    return this.rateLimiter.getStats();
  }

  updateRateLimitConfig(config: { maxPerMinute?: number; maxPerHour?: number; minIntervalMs?: number }): void {
    this.rateLimiter.updateConfig(config);
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
ensureProvidersRestored();
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
  return providerStore.get(id);
}

export function getAllProviders(): ModelProvider[] {
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
