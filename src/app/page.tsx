'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalStorage } from '@/lib/useLocalStorage';

// ============================================================
// Types
// ============================================================

interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
}

interface ProviderPreset {
  type: string;
  name: string;
  baseUrl: string;
  description: string;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerId: string;
}

interface Alpha {
  id: string;
  code: string;
  dateCreated: string;
  sharpe: number;
  fitness: number;
  turnover: number;
  margin: number;
  returns: number;
  drawdown: number;
  longCount: number;
  shortCount: number;
  pnl: number;
  volatility: number;
  maxDrawdown: number;
  winRate: number;
  avgReturn: number;
  checks: Array<{ result: string; name: string }>;
  isSubmitted: boolean;
  status: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface SimulationRecordRow {
  id: string;
  alphaExpression: string;
  candidateId: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  sharpe?: number;
  fitness?: number;
  error?: string;
  submittedAt: string;
  completedAt?: string;
}

interface PolishQueueItem {
  id: string;
  expression: string;
  generation: number;
  status: string;
}

interface ResearchStatus {
  id: string;
  status: string;
  config: ResearchConfig | null;
  currentGeneration: number;
  totalSimulations: number;
  successfulAlphas: number;
  failedSimulations: number;
  startTime: string | null;
  lastActivity: string | null;
  livingAlphas: Alpha[];
  generationStats: GenerationStat[];
  errorLog: Array<{ id: string; timestamp: string; level: string; source: string; message: string }>;
  diversityMetrics: DiversityMetrics | null;
  currentHypothesis: string | null;
  currentExpression: string | null;
  simulationHistory?: SimulationRecordRow[];
  polishQueue?: PolishQueueItem[];
}

interface ResearchConfig {
  providerId: string;
  modelId: string;
  region: string;
  universe: string;
  delay: number;
  neutralization: string;
  maxConcurrentSimulations: number;
  maxDailySimulations: number;
  researchStrategy: string;
  maxGenerations: number;
  populationSize: number;
  autoSubmit: boolean;
  enableAutoCorrection: boolean;
  enableDiversityManagement: boolean;
  stylePremiaRotation: boolean;
  targetSharpe: number;
  targetFitness: number;
  maxTurnover: number;
}

interface GenerationStat {
  generation: number;
  totalCandidates: number;
  successful: number;
  averageSharpe: number;
  averageFitness: number;
  bestSharpe: number;
  discoveryRate: number;
  diversityScore: number;
  dominantCategory: string;
  timestamp: string;
}

interface DiversityMetrics {
  totalCandidates: number;
  acceptedCandidates: number;
  discardedDuplicates: number;
  discardedCorrelated: number;
  averagePairwiseCorrelation: number;
  pcaCoverage: number;
  categoryDistribution: Record<string, number>;
  styleDistribution: Record<string, number>;
}

// ============================================================
// Constants
// ============================================================

const REGIONS = [
  { value: 'USA', universes: ['TOP3000', 'TOP1000', 'TOP500', 'TOP200'] },
  { value: 'GLB', universes: ['TOP3000', 'MINVOL1M', 'TOPDIV3000'] },
  { value: 'EUR', universes: ['TOP2500', 'TOP1200', 'TOP800', 'TOP400'] },
  { value: 'ASI', universes: ['MINVOL1M'] },
  { value: 'CHN', universes: ['TOP2000U'] },
  { value: 'IND', universes: ['TOP500'] },
];

const NEUTRALIZATIONS = ['MARKET', 'SECTOR', 'INDUSTRY', 'SUBINDUSTRY', 'COUNTRY'];

// ============================================================
// Main Application Component
// ============================================================

export default function Home() {
  // Tab state
  const [activeTab, setActiveTab] = useLocalStorage('ui.activeTab', 'providers');

  // Provider state
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useLocalStorage('selection.providerId', '');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useLocalStorage('selection.modelId', '');
  const [newProviderName, setNewProviderName] = useLocalStorage('provider.name', '');
  const [newProviderUrl, setNewProviderUrl] = useLocalStorage('provider.url', '');
  const [newProviderKey, setNewProviderKey] = useLocalStorage('provider.key', '', ['newProviderKey']);
  const [selectedPreset, setSelectedPreset] = useLocalStorage('provider.preset', '');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [providerStatus, setProviderStatus] = useState<string>('');

  // Model validation state
  const [validatedModels, setValidatedModels] = useState<Record<string, { success: boolean; message: string; timestamp: number }>>({});
  const [validatingModelId, setValidatingModelId] = useState<string | null>(null);

  // WQ Auth state
  const [wqEmail, setWqEmail] = useLocalStorage('auth.email', '');
  const [wqPassword, setWqPassword] = useLocalStorage('auth.password', '', ['wqPassword']);
  const [wqAuthenticated, setWqAuthenticated] = useState(false);
  const [wqAuthError, setWqAuthError] = useState('');

  // Alphas state
  const [alphas, setAlphas] = useState<Alpha[]>([]);
  const [alphasLoading, setAlphasLoading] = useState(false);
  const [alphaFilter, setAlphaFilter] = useState('all');

  // Research state
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [researchRunning, setResearchRunning] = useState(false);

  // Research config
  const defaultConfig: Partial<ResearchConfig> = {
    region: 'USA',
    universe: 'TOP3000',
    delay: 1,
    neutralization: 'INDUSTRY',
    maxConcurrentSimulations: 5,
    maxDailySimulations: 100,
    researchStrategy: 'evolutionary',
    maxGenerations: 50,
    populationSize: 5,
    autoSubmit: false,
    enableAutoCorrection: true,
    enableDiversityManagement: true,
    stylePremiaRotation: true,
    targetSharpe: 1.5,
    targetFitness: 1.0,
    maxTurnover: 0.7,
  };
  const [config, setConfig] = useLocalStorage('research.config', defaultConfig);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Manual simulation
  const [manualExpression, setManualExpression] = useState('');
  const [simResult, setSimResult] = useState<{ success: boolean; message: string; data?: unknown } | null>(null);

  // Gap 6: Rate limit stats for display
  const [rateLimitStats, setRateLimitStats] = useState<{ callsInLastMinute: number; callsInLastHour: number } | null>(null);

  // Persistence state
  const [persistenceStats, setPersistenceStats] = useState<{
    sqlite: { connected: boolean; fingerprints: number; experienceReplay: number; simulationLogs: number; lineage: number; generationStats: number; errorLogs: number; feedbackEntries: number; researchSessions: number; databaseSizeBytes: number; walSizeBytes: number; error?: string | null } | null;
    warehouse: { connected: boolean; parquetFiles: number; totalSizeBytes: number; tables: string[]; error?: string | null } | null;
  } | null>(null);

  const passwordsSaved = !!wqPassword || !!newProviderKey;

  // --- Callbacks (declared before useEffects that use them) ---

  const logIdCounter = useRef(0);
  const lastLoggedErrorIdsRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    logIdCounter.current += 1;
    const entry: LogEntry = {
      id: `log_${Date.now()}_${logIdCounter.current}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    };
    setLogs(prev => [...prev.slice(-200), entry]);
  }, []);

  const pollResearchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/research/status');
      const data = await res.json();

      if (data.error) return;
      if (typeof data.status !== 'string') return;

      setResearchStatus(data as ResearchStatus);
      setResearchRunning(data.status === 'running' || data.status === 'paused');

      const recentErrors = (data.errorLog || []).slice(-5);
      for (const err of recentErrors) {
        if (err.level === 'error' || err.level === 'critical') {
          const key = `${err.id}:${err.timestamp}`;
          if (!lastLoggedErrorIdsRef.current.has(key)) {
            lastLoggedErrorIdsRef.current.add(key);
            if (lastLoggedErrorIdsRef.current.size > 40) {
              lastLoggedErrorIdsRef.current = new Set([...lastLoggedErrorIdsRef.current].slice(-20));
            }
            addLog('error', `[${err.source}] ${err.message}`);
          }
        }
      }

      if (data.rateLimitStats) {
        setRateLimitStats(data.rateLimitStats as { callsInLastMinute: number; callsInLastHour: number });
      }
    } catch {
      // Ignore polling errors
    }
  }, [addLog]);

  // --- Initialize ---

  useEffect(() => {
    fetchProviders();
    checkWQAuth();
    void pollResearchStatus();

    const eventSource = new EventSource('/api/events');
    const refreshTypes = new Set([
      'status',
      'simulation_submitted',
      'simulation_complete',
      'critique_resubmit',
      'hypothesis_generated',
      'alpha_generated',
      'diversity_check',
      'correction',
    ]);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (refreshTypes.has(data.type)) {
          void pollResearchStatus();
        }
        if (data.type === 'generation_complete' && data.data) {
          const gen = data.data;
          addLog('info', `Gen ${gen.generation}: ${gen.successful}/${gen.totalCandidates} alphas, best Sharpe: ${gen.bestSharpe?.toFixed(2)}`);
        }
        if (data.type === 'alpha_accepted' && data.data) {
          addLog('success', `Alpha accepted! Sharpe: ${data.data.alpha?.sharpe?.toFixed(2)}`);
        }
        if (data.type === 'alpha_rejected' && data.data) {
          addLog('warning', `Alpha rejected: ${data.data.error || 'below threshold'}`);
        }
        if (data.type === 'error' && data.data) {
          addLog('error', data.data.message || 'Research error');
        }
        if (data.type === 'mutation_spike' && data.data) {
          addLog('info', `Mutation spike! ${data.data.remainingGenerations + 1} generations remaining`);
        }
        if (data.type === 'simulation_submitted' && data.data?.expression) {
          const expr = String(data.data.expression);
          addLog('info', `BRAIN sim: ${expr.slice(0, 140)}${expr.length > 140 ? '…' : ''}`);
        }
      } catch { /* ignore parse errors */ }
    };

    return () => {
      eventSource.close();
    };
  }, [addLog, pollResearchStatus]);

  useEffect(() => {
    const busy =
      researchStatus?.status === 'running' ||
      researchStatus?.status === 'paused' ||
      researchStatus?.status === 'stopping';
    if (!busy) return;

    void pollResearchStatus();
    const interval = setInterval(() => {
      void pollResearchStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, [researchStatus?.status, pollResearchStatus]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- API Functions ---

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      const data = await res.json();
      setProviders(data.providers || []);
      setPresets(data.presets || []);
      if (data.activeProvider) {
        setSelectedProviderId(data.activeProvider.id);
      }
    } catch {
      addLog('error', 'Failed to fetch providers');
    }
  };

  const fetchModels = async (providerId: string) => {
    if (!providerId) return;
    setModelsLoading(true);
    setSelectedModelId('');
    setProviderStatus('Loading models...');

    try {
      const res = await fetch(`/api/providers/${providerId}/models`);
      const data = await res.json();

      if (data.models) {
        setModels(data.models);
        setProviderStatus(`Found ${data.models.length} models`);
        addLog('success', `Loaded ${data.models.length} models from ${data.providerName || 'provider'}`);
      } else {
        setModels([]);
        setProviderStatus(data.error || 'Failed to load models');
        addLog('error', data.error || 'Failed to load models');
      }
    } catch {
      setModels([]);
      setProviderStatus('Connection failed');
      addLog('error', 'Failed to connect to provider');
    } finally {
      setModelsLoading(false);
    }
  };

  const validateModel = async (providerId: string, modelId: string) => {
    const cacheKey = `${providerId}:${modelId}`;
    const cached = validatedModels[cacheKey];
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached;
    }

    setValidatingModelId(modelId);
    try {
      const res = await fetch(`/api/providers/${providerId}/validate-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();

      const result = {
        success: data.success,
        message: data.message,
        timestamp: Date.now(),
      };

      setValidatedModels(prev => ({ ...prev, [cacheKey]: result }));

      if (data.success) {
        addLog('success', `Model ${modelId} validated: ${data.message}`);
      } else {
        addLog('warning', `Model ${modelId} validation failed: ${data.message}`);
      }

      return result;
    } catch (error) {
      const result = {
        success: false,
        message: error instanceof Error ? error.message : 'Validation failed',
        timestamp: Date.now(),
      };
      setValidatedModels(prev => ({ ...prev, [cacheKey]: result }));
      addLog('error', `Model ${modelId} validation error: ${result.message}`);
      return result;
    } finally {
      setValidatingModelId(null);
    }
  };

  const createProvider = async () => {
    if (!newProviderName || !newProviderUrl || !newProviderKey) {
      addLog('warning', 'All fields are required to create a provider');
      return;
    }

    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProviderName,
          baseUrl: newProviderUrl,
          apiKey: newProviderKey,
          type: selectedPreset || 'custom',
        }),
      });

      const data = await res.json();
      if (data.provider) {
        addLog('success', `Provider "${data.provider.name}" created`);
        setNewProviderName('');
        setNewProviderUrl('');
        setNewProviderKey('');
        setSelectedPreset('');
        await fetchProviders();
      } else {
        addLog('error', data.error || 'Failed to create provider');
      }
    } catch {
      addLog('error', 'Failed to create provider');
    }
  };

  const deleteProviderAction = async (id: string) => {
    try {
      await fetch(`/api/providers?id=${id}`, { method: 'DELETE' });
      addLog('info', 'Provider deleted');
      await fetchProviders();
    } catch {
      addLog('error', 'Failed to delete provider');
    }
  };

  const selectProvider = async (id: string) => {
    setSelectedProviderId(id);
    setSelectedModelId('');

    try {
      await fetch('/api/providers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: true }),
      });
    } catch {
      // Non-critical
    }

    await fetchModels(id);
  };

  const checkWQAuth = async () => {
    try {
      const res = await fetch('/api/wq/auth');
      const data = await res.json();
      setWqAuthenticated(data.isAuthenticated);
    } catch {
      setWqAuthenticated(false);
    }
  };

  const authenticateWQ = async () => {
    if (!wqEmail || !wqPassword) {
      addLog('warning', 'WorldQuant email and password are required');
      return;
    }

    setWqAuthError('');
    addLog('info', 'Authenticating with WorldQuant BRAIN...');

    try {
      const res = await fetch('/api/wq/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: wqEmail, password: wqPassword }),
      });

      const data = await res.json();
      if (data.success) {
        setWqAuthenticated(true);
        addLog('success', 'WorldQuant BRAIN authentication successful');
      } else {
        setWqAuthError(data.error || 'Authentication failed');
        addLog('error', `WQ auth failed: ${data.error}`);
      }
    } catch {
      setWqAuthError('Connection failed');
      addLog('error', 'WQ auth connection failed');
    }
  };

  const disconnectWQ = async () => {
    await fetch('/api/wq/auth', { method: 'DELETE' });
    setWqAuthenticated(false);
    addLog('info', 'Disconnected from WorldQuant BRAIN');
  };

  const fetchAlphas = async (filter?: string) => {
    if (!wqAuthenticated) return;
    setAlphasLoading(true);

    try {
      const params = new URLSearchParams({ limit: '50' });
      // Default: fetch ACTIVE (submitted) alphas
      if (!filter || filter === 'all') params.set('status', 'ACTIVE');
      if (filter === 'unsubmitted') params.set('status', 'UNSUBMITTED');
      if (filter === 'submitted') params.set('status', 'ACTIVE');
      if (filter === 'top') params.set('minSharpe', '1.25');

      const res = await fetch(`/api/wq/alphas?${params}`);
      const data = await res.json();

      if (data.results) {
        setAlphas(data.results);
        addLog('info', `Loaded ${data.count} alphas (${filter || 'all'})`);
      } else {
        addLog('error', data.error || 'Failed to fetch alphas');
      }
    } catch {
      addLog('error', 'Failed to fetch alphas');
    } finally {
      setAlphasLoading(false);
    }
  };

  const submitAlpha = async (alphaId: string) => {
    try {
      const res = await fetch(`/api/wq/alphas/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alphaId }),
      });
      const data = await res.json();
      addLog(data.success ? 'success' : 'error', `Alpha submit: ${data.message}`);
    } catch {
      addLog('error', 'Failed to submit alpha');
    }
  };

  const startResearch = async () => {
    if (!selectedModelId) {
      addLog('warning', 'Select a model first');
      return;
    }
    if (!wqAuthenticated) {
      addLog('warning', 'Authenticate with WorldQuant BRAIN first');
      return;
    }

    const cacheKey = `${selectedProviderId}:${selectedModelId}`;
    const validation = validatedModels[cacheKey];

    if (!validation) {
      addLog('info', 'Validating model before starting research...');
      const result = await validateModel(selectedProviderId, selectedModelId);
      if (!result.success) {
        if (!confirm(`Model validation failed: ${result.message}\n\nDo you want to proceed anyway?`)) {
          return;
        }
        addLog('warning', 'Proceeding with unvalidated model');
      }
    } else if (!validation.success) {
      if (!confirm(`Model validation previously failed: ${validation.message}\n\nDo you want to proceed anyway?`)) {
        return;
      }
      addLog('warning', 'Proceeding with previously failed model');
    }

    try {
      const res = await fetch('/api/research/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          providerId: selectedProviderId,
          modelId: selectedModelId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResearchRunning(true);
        addLog('success', 'Research engine started');
        await pollResearchStatus();
      } else {
        addLog('error', data.error || 'Failed to start research');
      }
    } catch {
      addLog('error', 'Failed to start research engine');
    }
  };

  const stopResearch = async () => {
    try {
      await fetch('/api/research/stop', { method: 'POST' });
      setResearchRunning(false);
      addLog('info', 'Research engine stopping...');
      await pollResearchStatus();
    } catch {
      addLog('error', 'Failed to stop research');
    }
  };

  const resetResearch = async () => {
    if (!confirm('Reset will wipe ALL data (alphas, fingerprints, experience, logs). This cannot be undone. Continue?')) {
      return;
    }
    try {
      await fetch('/api/research/reset', { method: 'POST' });
      setResearchRunning(false);
      addLog('info', 'Research engine reset - all data cleared');
      await pollResearchStatus();
    } catch {
      addLog('error', 'Failed to reset research');
    }
  };

  const pauseResearch = async () => {
    try {
      await fetch('/api/research/pause', { method: 'POST' });
      setResearchRunning(false);
      addLog('info', 'Research paused — you can resume later');
      await pollResearchStatus();
    } catch {
      addLog('error', 'Failed to pause research');
    }
  };

  const resumeResearch = async () => {
    if (!selectedModelId) {
      addLog('warning', 'Select a model first');
      return;
    }
    try {
      const res = await fetch('/api/research/resume', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setResearchRunning(true);
        addLog('success', 'Research resumed');
        await pollResearchStatus();
      } else {
        addLog('error', data.error || 'Failed to resume research');
      }
    } catch {
      addLog('error', 'Failed to resume research');
    }
  };

  const submitManualSimulation = async () => {
    if (!manualExpression.trim()) return;

    try {
      setSimResult({ success: false, message: 'Submitting simulation...' });
      const res = await fetch('/api/wq/simulations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expression: manualExpression,
          settings: {
            region: config.region,
            universe: config.universe,
            delay: config.delay,
            neutralization: config.neutralization,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSimResult({ success: true, message: `Simulation submitted: ${data.simulationId}` });
        addLog('success', `Manual simulation submitted: ${data.simulationId}`);
      } else {
        setSimResult({ success: false, message: data.error || 'Submission failed' });
        addLog('error', data.error || 'Simulation submission failed');
      }
    } catch {
      setSimResult({ success: false, message: 'Connection failed' });
    }
  };

  const fetchPersistenceStats = async () => {
    try {
      const res = await fetch('/api/persistence/stats');
      const data = await res.json();
      setPersistenceStats(data);
    } catch {
      // ignore
    }
  };

  const performMaintenance = async (action: string) => {
    try {
      const res = await fetch('/api/persistence/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        addLog('success', data.message);
        await fetchPersistenceStats();
      } else {
        addLog('error', data.error || 'Maintenance failed');
      }
    } catch {
      addLog('error', 'Failed to perform maintenance');
    }
  };

  // --- Tab rendering ---

  const tabs = [
    { id: 'providers', label: 'Model Providers', icon: 'CPU' },
    { id: 'wqauth', label: 'WQ BRAIN', icon: 'KEY' },
    { id: 'research', label: 'Research Engine', icon: 'ROCKET' },
    { id: 'library', label: 'Alpha Library', icon: 'DATABASE' },
    { id: 'storage', label: 'Storage', icon: 'DISK' },
    { id: 'logs', label: 'Console', icon: 'TERM' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-3 sm:px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
            WQ
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-white leading-tight truncate">WQ Research Agent</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Model-Agnostic Automated Quantitative Research</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${researchRunning ? 'bg-green-400 animate-pulse-dot' : researchStatus?.status === 'paused' ? 'bg-yellow-400' : 'bg-gray-600'}`} />
            <span className="text-xs text-gray-400 font-mono hidden sm:inline">
              {researchRunning ? 'RUNNING' : researchStatus?.status === 'paused' ? 'PAUSED' : 'IDLE'}
            </span>
          </div>
          {wqAuthenticated && (
            <span className="badge badge-success text-xs">WQ</span>
          )}
          {!wqAuthenticated && (
            <span className="badge badge-neutral text-xs">WQ</span>
          )}
          {selectedModelId && (
            <span className="badge badge-info truncate max-w-[120px] sm:max-w-[200px] text-xs">{selectedModelId}</span>
          )}
          {rateLimitStats && researchRunning && (
            <span className="text-xs text-gray-500 font-mono hidden lg:inline">
              LLM: {rateLimitStats.callsInLastMinute}/min
            </span>
          )}
          {passwordsSaved && (
            <span className="badge badge-warning text-xs" title="Passwords encrypted in browser">
              🔐
            </span>
          )}
          <button
            className="btn btn-xs btn-ghost text-gray-500 hover:text-white"
            onClick={() => {
              if (confirm('Clear all saved state? You will need to re-enter credentials.')) {
                localStorage.clear();
                window.location.reload();
              }
            }}
            title="Clear saved state"
          >
            Clear
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="border-b border-gray-800 px-2 sm:px-4 bg-gray-900/30 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'library' && wqAuthenticated) fetchAlphas(alphaFilter);
                if (tab.id === 'storage') fetchPersistenceStats();
              }}
              className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
            >
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-3 sm:p-4 overflow-auto">
        {/* ===== PROVIDERS TAB ===== */}
        {activeTab === 'providers' && (
          <div className="space-y-6">
            {/* Create Provider */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="text-indigo-400">&#9889;</span> Connect Model Provider
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Preset</label>
                  <select
                    className="select"
                    value={selectedPreset}
                    onChange={e => {
                      setSelectedPreset(e.target.value);
                      const preset = presets.find(p => p.type === e.target.value);
                      if (preset) {
                        setNewProviderName(preset.name);
                        setNewProviderUrl(preset.baseUrl);
                      }
                    }}
                  >
                    <option value="">Select a provider...</option>
                    {presets.map(p => (
                      <option key={p.type} value={p.type}>{p.name} - {p.description}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Name</label>
                  <input className="input" placeholder="Provider name" value={newProviderName} onChange={e => setNewProviderName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Base URL</label>
                  <input className="input" placeholder="https://api.openai.com/v1" value={newProviderUrl} onChange={e => setNewProviderUrl(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">API Key</label>
                  <input className="input" type="password" placeholder="sk-..." value={newProviderKey} onChange={e => setNewProviderKey(e.target.value)} />
                </div>
              </div>

              <button className="btn btn-primary" onClick={createProvider}>
                + Connect Provider
              </button>

              {newProviderKey && (
                <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-xs text-yellow-400">
                    🔐 API key will be encrypted and saved in your browser for convenience.
                  </p>
                </div>
              )}
            </div>

            {/* Configured Providers */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">Configured Providers</h2>

              {providers.length === 0 ? (
                <p className="text-gray-500 text-sm">No providers configured yet. Add one above.</p>
              ) : (
                <div className="space-y-3">
                  {providers.map(p => (
                    <div key={p.id} className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg border ${p.id === selectedProviderId ? 'border-indigo-500 bg-indigo-500/5' : 'border-gray-800 bg-gray-900/50'}`}>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => selectProvider(p.id)}
                          className={`w-4 h-4 rounded-full border-2 ${p.id === selectedProviderId ? 'border-indigo-400 bg-indigo-400' : 'border-gray-600'}`}
                        />
                        <div>
                          <div className="font-medium text-sm">{p.name}</div>
                          <div className="text-xs text-gray-500 font-mono">{p.baseUrl}</div>
                        </div>
                        {p.isActive && <span className="badge badge-success">Active</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="btn btn-sm btn-secondary" onClick={() => fetchModels(p.id)}>
                          {modelsLoading && p.id === selectedProviderId ? 'Loading...' : 'Load Models'}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteProviderAction(p.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Model Selection */}
            {selectedProviderId && models.length > 0 && (
              <div className="card">
                <h2 className="text-lg font-semibold mb-4">
                  Available Models
                  {providerStatus && <span className="text-sm font-normal text-gray-400 ml-2">{providerStatus}</span>}
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
                  {models.map(m => {
                    const cacheKey = `${selectedProviderId}:${m.id}`;
                    const validation = validatedModels[cacheKey];
                    const isValidating = validatingModelId === m.id;

                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelectedModelId(m.id);
                          validateModel(selectedProviderId, m.id);
                        }}
                        className={`p-3 rounded-lg border text-left transition-all relative ${m.id === selectedModelId ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-800 hover:border-gray-600 hover:bg-gray-900/50'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-sm font-medium truncate flex-1">{m.id}</div>
                          <div className="ml-2">
                            {isValidating ? (
                              <span className="text-yellow-400 text-xs">⏳</span>
                            ) : validation ? (
                              validation.success ? (
                                <span className="text-green-400 text-xs" title={validation.message}>✓</span>
                              ) : (
                                <span className="text-red-400 text-xs" title={validation.message}>✗</span>
                              )
                            ) : null}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{m.provider}</div>
                      </button>
                    );
                  })}
                </div>

                {selectedModelId && (
                  <div className="mt-4 p-3 rounded-lg border bg-gray-900/50">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-gray-400 font-medium text-sm">Selected: </span>
                        <span className="font-mono text-sm">{selectedModelId}</span>
                      </div>
                      {(() => {
                        const cacheKey = `${selectedProviderId}:${selectedModelId}`;
                        const validation = validatedModels[cacheKey];
                        if (!validation) return null;
                        return validation.success ? (
                          <span className="text-green-400 text-xs flex items-center gap-1">
                            <span>✓</span> Validated
                          </span>
                        ) : (
                          <span className="text-red-400 text-xs flex items-center gap-1" title={validation.message}>
                            <span>✗</span> Failed
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== WQ AUTH TAB ===== */}
        {activeTab === 'wqauth' && (
          <div className="space-y-6 max-w-2xl">
            {!wqAuthenticated ? (
              <div className="card">
                <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <span className="text-indigo-400">&#128274;</span> WorldQuant BRAIN Authentication
                </h2>
                <p className="text-sm text-gray-400 mb-4">
                  Enter your WorldQuant BRAIN credentials. The session is maintained server-side using HTTP Basic Authentication with cookie persistence.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Email</label>
                    <input className="input" type="email" placeholder="your.email@worldquant.com" value={wqEmail} onChange={e => setWqEmail(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Password</label>
                    <input className="input" type="password" placeholder="Your WQ password" value={wqPassword} onChange={e => setWqPassword(e.target.value)} />
                  </div>

                  {wqAuthError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                      {wqAuthError}
                    </div>
                  )}

                  <button className="btn btn-primary" onClick={authenticateWQ}>
                    Authenticate
                  </button>
                </div>
              </div>
            ) : (
              <div className="card">
                <h2 className="text-lg font-semibold mb-4 text-green-400">&#10003; Connected to WorldQuant BRAIN</h2>
                <p className="text-sm text-gray-400 mb-6">
                  Your session is active. The research engine will use this connection to submit
                  LLM-generated FASTEXPR expressions for simulation. It will also fetch your
                  <strong className="text-white"> active submitted alphas</strong> to build a correlation baseline
                  &mdash; ensuring newly generated alphas are independent of your existing portfolio.
                </p>

                <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg mb-6">
                  <h3 className="text-sm font-semibold text-indigo-300 mb-2">Next Steps</h3>
                  <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                    <li>Go to <strong className="text-white">Model Providers</strong> tab and connect an LLM provider</li>
                    <li>Select a model (the AI that will generate unique FASTEXPR expressions)</li>
                    <li>Go to <strong className="text-white">Research Engine</strong> tab and configure your strategy</li>
                    <li>Hit <strong className="text-green-400">Start Research</strong> &mdash; the agent works autonomously from here</li>
                  </ol>
                </div>

                <button className="btn btn-danger" onClick={disconnectWQ}>
                  Disconnect
                </button>

                {wqPassword && (
                  <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <p className="text-xs text-yellow-400">
                      🔐 Your password is securely stored (encrypted) in your browser. 
                      It will auto-populate on your next visit.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* How It Works */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-3">How the Autonomous Agent Works</h2>
              <p className="text-sm text-gray-400 mb-4">
                You don&#39;t write FASTEXPR expressions manually &mdash; the LLM does. Here&#39;s the flow:
              </p>
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">1</div>
                  <div>
                    <div className="text-sm font-medium text-white">Fetch Your Active Alphas</div>
                    <div className="text-xs text-gray-500">Retrieves your <strong>submitted</strong> alphas from WQ BRAIN as a correlation baseline</div>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs font-bold shrink-0">2</div>
                  <div>
                    <div className="text-sm font-medium text-white">LLM Generates Unique FASTEXPR</div>
                    <div className="text-xs text-gray-500">The connected model creates novel alpha expressions using style-aware prompts, error feedback, and experience replay</div>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold shrink-0">3</div>
                  <div>
                    <div className="text-sm font-medium text-white">Inner Loop Validates Syntax</div>
                    <div className="text-xs text-gray-500">AST-lite checks: operator arity, forbidden nesting, balanced parens, fingerprinting</div>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-bold shrink-0">4</div>
                  <div>
                    <div className="text-sm font-medium text-white">Diversity Check (Correlation)</div>
                    <div className="text-xs text-gray-500">Ensures new alpha is not a duplicate or correlated with your existing submitted alphas</div>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">5</div>
                  <div>
                    <div className="text-sm font-medium text-white">Submit to WQ BRAIN for Simulation</div>
                    <div className="text-xs text-gray-500">Expression is sent to the platform, polled until complete, metrics extracted</div>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0">6</div>
                  <div>
                    <div className="text-sm font-medium text-white">Middle Loop Polishes Weak Alphas</div>
                    <div className="text-xs text-gray-500">If Sharpe/Fitness/Turnover are close but not passing, the LLM suggests decay operators, lookback tweaks, etc.</div>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs font-bold shrink-0">7</div>
                  <div>
                    <div className="text-sm font-medium text-white">Outer Loop Evolves Strategy</div>
                    <div className="text-xs text-gray-500">Dataset rotation, style premia cycling (Value/Momentum/Carry/Defensive), anti-deadlock mutation spikes</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== RESEARCH ENGINE TAB ===== */}
        {activeTab === 'research' && (
          <div className="space-y-6">
            {/* Setup */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <span className="text-purple-400">&#9889;</span> Research Configuration
              </h2>
              <p className="text-sm text-gray-400 mb-4">
                Configure the autonomous research engine. Once started, the LLM will generate unique FASTEXPR alpha expressions,
                validate them, check correlation against your submitted alphas, submit to WQ BRAIN, and iterate — all without manual intervention.
              </p>

              {/* Prerequisites */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                <div className={`p-3 rounded-lg border flex items-center gap-3 ${wqAuthenticated ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${wqAuthenticated ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {wqAuthenticated ? '✓' : '!'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{wqAuthenticated ? 'WQ BRAIN Connected' : 'WQ BRAIN Not Connected'}</div>
                    <div className="text-xs text-gray-500 hidden sm:inline">Required for simulation</div>
                  </div>
                </div>
                <div className={`p-3 rounded-lg border flex items-center gap-3 ${selectedModelId ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 ${selectedModelId ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {selectedModelId ? '✓' : '!'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{selectedModelId ? `Model: ${selectedModelId}` : 'No Model Selected'}</div>
                    <div className="text-xs text-gray-500 hidden sm:inline">Required for generation</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Strategy</label>
                  <select className="select" value={config.researchStrategy} onChange={e => setConfig({ ...config, researchStrategy: e.target.value })}>
                    <option value="evolutionary">Evolutionary / Genetic</option>
                    <option value="bfs">Breadth-First Search</option>
                    <option value="dfs">Depth-First Search</option>
                    <option value="random">Random Walk</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Region</label>
                  <select className="select" value={config.region} onChange={e => {
                    const region = REGIONS.find(r => r.value === e.target.value);
                    setConfig({ ...config, region: e.target.value, universe: region?.universes[0] || 'TOP3000' });
                  }}>
                    {REGIONS.map(r => <option key={r.value} value={r.value}>{r.value}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Universe</label>
                  <select className="select" value={config.universe} onChange={e => setConfig({ ...config, universe: e.target.value })}>
                    {REGIONS.find(r => r.value === config.region)?.universes.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Delay</label>
                  <select className="select" value={config.delay} onChange={e => setConfig({ ...config, delay: parseInt(e.target.value) })}>
                    <option value={0}>0 (No delay)</option>
                    <option value={1}>1 (1 day delay)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Neutralization</label>
                  <select className="select" value={config.neutralization} onChange={e => setConfig({ ...config, neutralization: e.target.value })}>
                    {NEUTRALIZATIONS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Generations</label>
                  <input className="input" type="number" value={config.maxGenerations} onChange={e => setConfig({ ...config, maxGenerations: parseInt(e.target.value) || 50 })} min={1} max={1000} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Population Size</label>
                  <input className="input" type="number" value={config.populationSize} onChange={e => setConfig({ ...config, populationSize: parseInt(e.target.value) || 5 })} min={1} max={20} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Daily Sims</label>
                  <input className="input" type="number" value={config.maxDailySimulations} onChange={e => setConfig({ ...config, maxDailySimulations: parseInt(e.target.value) || 100 })} min={1} max={5000} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Target Sharpe</label>
                  <input className="input" type="number" step={0.05} value={config.targetSharpe} onChange={e => setConfig({ ...config, targetSharpe: parseFloat(e.target.value) || 1.5 })} />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={config.autoSubmit || false} onChange={e => setConfig({ ...config, autoSubmit: e.target.checked })} className="rounded" />
                  <span className="text-sm">Auto-Submit Passing Alphas</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={config.enableAutoCorrection !== false} onChange={e => setConfig({ ...config, enableAutoCorrection: e.target.checked })} className="rounded" />
                  <span className="text-sm">Auto-Correction (LLM)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={config.enableDiversityManagement !== false} onChange={e => setConfig({ ...config, enableDiversityManagement: e.target.checked })} className="rounded" />
                  <span className="text-sm">Diversity Management</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={config.stylePremiaRotation !== false} onChange={e => setConfig({ ...config, stylePremiaRotation: e.target.checked })} className="rounded" />
                  <span className="text-sm">Style Premia Rotation</span>
                </label>
              </div>

              <div className="flex gap-3">
                {!researchRunning ? (
                  <button
                    className="btn btn-success"
                    onClick={startResearch}
                    disabled={!selectedModelId || !wqAuthenticated}
                  >
                    Start Research
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button className="btn btn-danger" onClick={stopResearch}>
                      Stop
                    </button>
                    <button className="btn btn-warning" onClick={resetResearch}>
                      Reset
                    </button>
                    <button className="btn btn-secondary" onClick={pauseResearch}>
                      Pause
                    </button>
                  </div>
                )}
                {researchStatus?.status === 'paused' && (
                  <button className="btn btn-primary" onClick={resumeResearch}>
                    Resume Research
                  </button>
                )}
                {!selectedModelId && <span className="text-sm text-gray-500 self-center">Select a model in Providers tab</span>}
                {!wqAuthenticated && <span className="text-sm text-gray-500 self-center">Connect to WQ BRAIN first</span>}
              </div>
            </div>

            {/* Live Activity Panel — show while running, paused, or stopping so expression trace survives pause */}
            {researchStatus && ['running', 'paused', 'stopping'].includes(researchStatus.status) && (
              <div className="card border-cyan-500/30 bg-cyan-500/5">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 flex-wrap">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${researchStatus.status === 'running' ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span className="text-cyan-300">Engine activity</span>
                  <span className="text-xs font-normal text-gray-500">
                    {researchStatus.status === 'paused' ? '(paused)' : researchStatus.status === 'stopping' ? '(stopping)' : ''}
                    {researchStatus.lastActivity ? ` · last update ${new Date(researchStatus.lastActivity).toLocaleTimeString()}` : ''}
                  </span>
                </h3>

                <div className="space-y-3">
                  {(researchStatus.polishQueue?.length ?? 0) > 0 && (
                    <div className="text-xs text-amber-300/90">
                      Polish / correction queue: <span className="font-mono">{researchStatus.polishQueue!.length}</span> pending re-sim
                    </div>
                  )}

                  {researchStatus.currentHypothesis && (
                    <div>
                      <div className="text-xs text-cyan-400 mb-1">Hypothesis (LLM)</div>
                      <div className="p-2 bg-gray-900/50 rounded text-sm text-gray-300 italic max-h-32 overflow-y-auto">
                        &ldquo;{researchStatus.currentHypothesis}&rdquo;
                      </div>
                    </div>
                  )}

                  {(() => {
                    const hist = researchStatus.simulationHistory;
                    const inFlight = hist?.filter(s => s.status === 'pending' || s.status === 'running').slice(-1)[0];
                    const primaryExpr = researchStatus.currentExpression || inFlight?.alphaExpression;
                    const showFallback = !researchStatus.currentExpression && inFlight;

                    if (!primaryExpr) {
                      if (researchStatus.currentHypothesis) return null;
                      return (
                        <div className="text-xs text-gray-500">
                          {researchStatus.status === 'running' ? 'Waiting for next candidate (validation / diversity / queue)…' : 'No active BRAIN simulation.'}
                        </div>
                      );
                    }

                    return (
                      <div>
                        <div className="text-xs text-green-400 mb-1 flex flex-wrap items-center gap-2">
                          <span>Expression on BRAIN</span>
                          {inFlight && (
                            <span className="text-gray-500 font-mono normal-case">
                              candidate <span className="text-gray-400">{inFlight.candidateId.slice(0, 8)}</span> · {inFlight.status}
                            </span>
                          )}
                          {showFallback && (
                            <span className="text-amber-400/90 normal-case">(from sim history — UI sync)</span>
                          )}
                        </div>
                        <div
                          className="p-3 bg-gray-950/70 rounded border border-green-500/20 font-mono text-xs text-green-200 max-h-56 overflow-y-auto whitespace-pre-wrap break-all"
                          title={primaryExpr}
                        >
                          {primaryExpr}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Recent BRAIN simulations (engine trace) */}
            {researchStatus?.simulationHistory && researchStatus.simulationHistory.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold mb-2 text-gray-300">Simulation trace</h3>
                <p className="text-xs text-gray-500 mb-3">Recent expressions submitted to BRAIN (newest first). Hover a row for full expression.</p>
                <div className="table-container max-h-[280px] overflow-y-auto">
                  <table className="text-xs">
                    <thead>
                      <tr>
                        <th className="w-24">Status</th>
                        <th className="w-28">Candidate</th>
                        <th>Expression</th>
                        <th className="w-20">Sharpe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...researchStatus.simulationHistory].reverse().slice(0, 16).map(row => (
                        <tr key={row.id}>
                          <td>
                            <span className={`badge ${row.status === 'complete' ? 'badge-success' : row.status === 'failed' ? 'badge-error' : 'badge-neutral'}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="font-mono text-gray-500">{row.candidateId.slice(0, 10)}</td>
                          <td>
                            <div className="font-mono text-gray-300 truncate max-w-[min(520px,55vw)]" title={row.alphaExpression}>
                              {row.alphaExpression}
                            </div>
                          </td>
                          <td className="font-mono text-right">
                            {row.sharpe != null ? row.sharpe.toFixed(3) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Status Dashboard */}
            {researchStatus && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="metric-card">
                  <div className="metric-label">Generation</div>
                  <div className="metric-value text-indigo-400">{researchStatus.currentGeneration}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Total Simulations</div>
                  <div className="metric-value text-blue-400">{researchStatus.totalSimulations}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Successful Alphas</div>
                  <div className="metric-value text-green-400">{researchStatus.successfulAlphas}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Failed</div>
                  <div className="metric-value text-red-400">{researchStatus.failedSimulations}</div>
                </div>
</div>
              )}

            {/* Generation Stats Chart */}
            {researchStatus?.generationStats && researchStatus.generationStats.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold mb-3 text-gray-300">Generation Performance</h3>
                <div className="table-container max-h-[300px] overflow-y-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Gen</th>
                        <th>Total</th>
                        <th>Success</th>
                        <th>Discovery %</th>
                        <th>Avg Sharpe</th>
                        <th>Avg Fitness</th>
                        <th>Best Sharpe</th>
                        <th>Dominant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {researchStatus.generationStats.slice().reverse().map((g, idx) => (
                        <tr key={`${g.generation}_${g.timestamp || idx}`}>
                          <td className="font-mono">{g.generation}</td>
                          <td>{g.totalCandidates}</td>
                          <td className="text-green-400">{g.successful}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="progress-bar w-16">
                                <div className="progress-fill" style={{ width: `${g.discoveryRate * 100}%`, background: g.discoveryRate > 0.3 ? '#10b981' : g.discoveryRate > 0.1 ? '#f59e0b' : '#ef4444' }} />
                              </div>
                              <span className="font-mono text-xs">{(g.discoveryRate * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="font-mono">{g.averageSharpe.toFixed(2)}</td>
                          <td className="font-mono">{g.averageFitness.toFixed(2)}</td>
                          <td className="font-mono text-green-400">{g.bestSharpe.toFixed(2)}</td>
                          <td><span className="badge badge-neutral">{g.dominantCategory}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Diversity Metrics */}
            {researchStatus?.diversityMetrics && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="card">
                  <h3 className="text-sm font-semibold mb-3 text-gray-300">Diversity Metrics</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-400">Total Candidates</span><span className="font-mono">{researchStatus.diversityMetrics.totalCandidates}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Avg Pairwise Correlation</span><span className="font-mono">{researchStatus.diversityMetrics.averagePairwiseCorrelation.toFixed(3)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">PCA Coverage</span><span className="font-mono">{researchStatus.diversityMetrics.pcaCoverage.toFixed(3)}</span></div>
                  </div>
                </div>
                <div className="card">
                  <h3 className="text-sm font-semibold mb-3 text-gray-300">Category Distribution</h3>
                  <div className="space-y-2">
                    {Object.entries(researchStatus.diversityMetrics.categoryDistribution || {}).map(([cat, count]) => (
                      <div key={cat} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-400 w-32 truncate">{cat}</span>
                        <div className="flex-1 progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, (count as number) * 2)}%` }} /></div>
                        <span className="font-mono w-8 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Architecture Overview */}
            <div className="card">
              <h3 className="text-sm font-semibold mb-3 text-gray-300">Multi-Timescale Feedback Architecture</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5">
                  <div className="font-semibold text-cyan-400 text-sm mb-1">Inner Loop (ms)</div>
                  <p className="text-xs text-gray-400">Syntax validation, operator arity checks, forbidden nesting detection, AST-Lite schema enforcement, fingerprinting</p>
                </div>
                <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                  <div className="font-semibold text-amber-400 text-sm mb-1">Middle Loop (min)</div>
                  <p className="text-xs text-gray-400">Metric optimization, Sharpe/Fitness/Turnover analysis, alpha polishing via decay operators, LLM-guided textual gradients</p>
                </div>
                <div className="p-3 rounded-lg border border-purple-500/20 bg-purple-500/5">
                  <div className="font-semibold text-purple-400 text-sm mb-1">Outer Loop (hrs)</div>
                  <p className="text-xs text-gray-400">Evolutionary strategy, dataset rotation, style premia alignment, anti-deadlock mutation spikes, Karpathy-style meta-research</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== ALPHA LIBRARY TAB ===== */}
        {activeTab === 'library' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Active Submitted Alphas</h2>
                <p className="text-xs text-gray-500 mt-1">
                  These are your existing submitted alphas used as the <strong className="text-white">correlation baseline</strong>. New LLM-generated alphas are checked against this pool to ensure portfolio diversity.
                </p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchAlphas('submitted')} disabled={!wqAuthenticated}>
                {alphasLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {!wqAuthenticated ? (
              <div className="card text-center py-12">
                <p className="text-gray-500">Authenticate with WorldQuant BRAIN to view your submitted alphas.</p>
                <button className="btn btn-primary mt-4" onClick={() => setActiveTab('wqauth')}>Go to WQ BRAIN Auth</button>
              </div>
            ) : alphas.length === 0 && !alphasLoading ? (
              <div className="card text-center py-12">
                <p className="text-gray-500">No submitted alphas found. This baseline will be populated once the research engine discovers and submits new alphas.</p>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Expression</th>
                      <th>Sharpe</th>
                      <th>Fitness</th>
                      <th>Turnover</th>
                      <th>Margin</th>
                      <th>Checks</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alphas.map(alpha => (
                      <tr key={alpha.id}>
                        <td>
                          <div className="code-block text-xs max-w-[300px] truncate" title={alpha.code}>
                            {alpha.code}
                          </div>
                        </td>
                        <td className={`font-mono font-bold ${alpha.sharpe >= 1.5 ? 'text-green-400' : alpha.sharpe >= 1.25 ? 'text-yellow-400' : 'text-gray-400'}`}>
                          {alpha.sharpe.toFixed(3)}
                        </td>
                        <td className={`font-mono ${alpha.fitness >= 1.0 ? 'text-green-400' : 'text-red-400'}`}>
                          {alpha.fitness.toFixed(3)}
                        </td>
                        <td className="font-mono">{(alpha.turnover * 100).toFixed(1)}%</td>
                        <td className="font-mono">{alpha.margin.toFixed(2)}</td>
                        <td>
                          {(alpha.checks?.length ?? 0) > 0 ? (
                            (alpha.checks ?? []).every(c => c.result === 'PASS') ?
                              <span className="badge badge-success">ALL PASS</span> :
                              <span className="badge badge-error">{(alpha.checks ?? []).filter(c => c.result === 'FAIL').length} FAIL</span>
                          ) : <span className="badge badge-neutral">N/A</span>}
                        </td>
                        <td>
                          {alpha.isSubmitted ?
                            <span className="badge badge-info">Submitted</span> :
                            <span className="badge badge-neutral">{alpha.status}</span>
                          }
                        </td>
                        <td>
                          {alpha.status === 'ACTIVE' ? (
                            <span className="badge badge-info">Live</span>
                          ) : (
                            <span className="badge badge-neutral">{alpha.status}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===== STORAGE TAB ===== */}
        {activeTab === 'storage' && (
          <div className="space-y-6">
            {/* Hybrid Persistence Architecture Overview */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <span className="text-cyan-400">&#128451;</span> Hybrid Persistence Model
              </h2>
              <p className="text-sm text-gray-400 mb-4">
                The research agent uses a hybrid persistence architecture optimized for your hardware.
                <strong className="text-white"> SQLite (WAL mode)</strong> handles transactional bookkeeping at high throughput,
                while <strong className="text-white"> DuckDB + Parquet</strong> powers analytical queries on proxy data without loading into memory.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* SQLite Status */}
                <div className={`p-4 rounded-lg border ${persistenceStats?.sqlite?.connected ? 'border-green-500/30 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <span className="text-2xl">&#128190;</span> SQLite (Transactional)
                    </h3>
                    <span className={`badge ${persistenceStats?.sqlite?.connected ? 'badge-success' : 'badge-warning'}`}>
                      {persistenceStats?.sqlite?.connected ? 'WAL Active' : 'Initializing...'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mb-2 font-mono">
                    PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;
                  </div>
                  {persistenceStats?.sqlite && (
                    <div className="space-y-2">
                      {[
                        { label: 'Alpha Fingerprints', value: persistenceStats.sqlite.fingerprints },
                        { label: 'Experience Replay (TD-priority)', value: persistenceStats.sqlite.experienceReplay },
                        { label: 'Simulation Logs', value: persistenceStats.sqlite.simulationLogs },
                        { label: 'Lineage Tree Nodes', value: persistenceStats.sqlite.lineage },
                        { label: 'Generation Stats', value: persistenceStats.sqlite.generationStats },
                        { label: 'Error Logs', value: persistenceStats.sqlite.errorLogs },
                        { label: 'Feedback Entries', value: persistenceStats.sqlite.feedbackEntries },
                        { label: 'Research Sessions', value: persistenceStats.sqlite.researchSessions },
                      ].map(row => (
                        <div key={row.label} className="flex justify-between items-center">
                          <span className="text-xs text-gray-400">{row.label}</span>
                          <span className="text-xs font-mono text-white">{row.value.toLocaleString()}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                        <span className="text-xs text-gray-400">DB Size</span>
                        <span className="text-xs font-mono text-cyan-400">{(persistenceStats.sqlite.databaseSizeBytes / 1024).toFixed(1)} KB</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400">WAL Size</span>
                        <span className="text-xs font-mono text-cyan-400">{(persistenceStats.sqlite.walSizeBytes / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* DuckDB Warehouse Status */}
                <div className={`p-4 rounded-lg border ${persistenceStats?.warehouse?.connected ? 'border-green-500/30 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <span className="text-2xl">&#128202;</span> DuckDB + Parquet (Analytical)
                    </h3>
                    <span className={`badge ${persistenceStats?.warehouse?.connected ? 'badge-success' : 'badge-warning'}`}>
                      {persistenceStats?.warehouse?.connected ? 'Connected' : 'Standby'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mb-2 font-mono">
                    SELECT CORR(close, lagged_close) FROM read_parquet(&apos;proxy_data/*.parquet&apos;)
                  </div>
                  {persistenceStats?.warehouse && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400">Parquet Files</span>
                        <span className="text-xs font-mono text-white">{persistenceStats.warehouse.parquetFiles}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400">Total Warehouse Size</span>
                        <span className="text-xs font-mono text-cyan-400">{(persistenceStats.warehouse.totalSizeBytes / 1024).toFixed(1)} KB</span>
                      </div>
                      {(persistenceStats.warehouse.tables || []).length > 0 && (
                        <div>
                          <span className="text-xs text-gray-400 block mb-1">Registered Tables:</span>
                          <div className="flex flex-wrap gap-1">
                            {(persistenceStats.warehouse.tables || []).map(t => (
                              <span key={t} className="text-xs font-mono bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">{t}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {persistenceStats.warehouse.parquetFiles === 0 && (
                        <p className="text-xs text-gray-500 mt-2">
                          No proxy data loaded yet. Parquet files are created when local price/volume data is ingested for PCA pre-simulation correlation prediction.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* What Gets Stored */}
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">What Gets Persisted</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-gray-400">
                <div className="space-y-2">
                  <div className="font-semibold text-gray-300">SQLite (Bookkeeping)</div>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Every alpha fingerprint ever generated (accepted + rejected)</li>
                    <li>Experience replay buffer with TD-error prioritized sampling</li>
                    <li>Complete simulation log with metrics (Sharpe, Fitness, Turnover, etc.)</li>
                    <li>Lineage tree (parent-child relationships across generations)</li>
                    <li>Per-generation summary statistics</li>
                    <li>All error logs (inner/middle/outer loop failures)</li>
                    <li>All feedback history (corrections, polishes, strategy changes)</li>
                    <li>Research session tracking (start, progress, completion)</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <div className="font-semibold text-gray-300">DuckDB/Parquet (Analytics)</div>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>1-year local proxy price/volume data (pv13 dataset)</li>
                    <li>Fundamental data (fnd6: assets, revenue, earnings, cashflow)</li>
                    <li>Alpha proxy return series for PCA correlation prediction</li>
                    <li>Auto-correlation matrices for momentum validation</li>
                  </ul>
                  <div className="mt-3 p-2 bg-cyan-500/10 border border-cyan-500/20 rounded text-cyan-300">
                    DuckDB queries Parquet files directly without loading into memory &mdash; perfect for maximizing your Information Ratio on limited hardware.
                  </div>
                </div>
              </div>
            </div>

            {/* Maintenance Actions */}
            <div className="card">
              <h3 className="text-sm font-semibold mb-3">Maintenance</h3>
              <div className="flex flex-wrap gap-3">
                <button className="btn btn-sm btn-secondary" onClick={() => performMaintenance('checkpoint')}>
                  Checkpoint WAL to Disk
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => performMaintenance('vacuum')}>
                  Vacuum Database
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => performMaintenance('prune_replay')}>
                  Prune Old Replay Entries
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => performMaintenance('clear_warehouse')}>
                  Clear Warehouse Data
                </button>
                <button className="btn btn-sm btn-secondary" onClick={fetchPersistenceStats}>
                  Refresh Stats
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== CONSOLE TAB ===== */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Console Output</h2>
              <button className="btn btn-sm btn-secondary" onClick={() => setLogs([])}>Clear</button>
            </div>
            <div className="log-console">
              {logs.length === 0 ? (
                <div className="text-gray-600 text-center py-8">No log entries yet. Start the research engine to see output.</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className={`log-entry log-${log.type}`}>
                    <span className="text-gray-600">[{log.timestamp}]</span>{' '}
                    {log.message}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-2 text-center text-xs text-gray-600">
        WorldQuant BRAIN Research Agent &mdash; Model-Agnostic Automated Quantitative Research Architecture
      </footer>
    </div>
  );
}
