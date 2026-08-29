import React, { useState, useEffect, useMemo } from 'react';
import {
  RuntimeBinding,
  BindingFamily,
  BindingFamilyMeta,
  BINDING_FAMILY_META,
  BINDING_PRESETS,
  DEFAULT_RUNTIME_BINDINGS,
  BindingEnvironment,
  D1Binding,
  KVBinding,
  R2Binding,
  DurableObjectBinding,
  WorkersAIBinding,
  BrowserBinding,
  VectorizeBinding,
  QueueBinding,
  WorkflowBinding,
  ServiceBinding,
  AnalyticsEngineBinding,
  EnvVarBinding,
  SecretBinding,
} from '../../types/bindings';
import { generateWranglerJsonc, parseWranglerJsoncToBindings } from '../../utils/wranglerConfig';
import { MonacoEditor } from '../editor/MonacoEditor';

interface BindingsRuntimeViewProps {
  bindings?: RuntimeBinding[];
  onUpdateBindings?: (bindings: RuntimeBinding[]) => void;
  activeBackendName?: string;
}

export const BindingsRuntimeView: React.FC<BindingsRuntimeViewProps> = ({
  bindings: initialBindings = DEFAULT_RUNTIME_BINDINGS,
  onUpdateBindings,
  activeBackendName = '@cloudflare/computer (Dual Router)',
}) => {
  // Local state with persistence fallback
  const [bindings, setBindings] = useState<RuntimeBinding[]>(() => {
    try {
      const saved = localStorage.getItem('agentsam_runtime_bindings');
      if (saved) return JSON.parse(saved);
    } catch { }
    return initialBindings;
  });

  const [viewMode, setViewMode] = useState<'visual' | 'raw'>('visual');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedBindingId, setExpandedBindingId] = useState<string | null>(null);
  const [revealedSecretIds, setRevealedSecretIds] = useState<Record<string, boolean>>({});

  // Raw editor state
  const [rawText, setRawText] = useState<string>(() => generateWranglerJsonc(bindings));
  const [rawError, setRawError] = useState<string | null>(null);
  const [rawSuccessMessage, setRawSuccessMessage] = useState<string | null>(null);

  // Add Binding Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedAddFamily, setSelectedAddFamily] = useState<BindingFamily>('d1');
  const [newBindingName, setNewBindingName] = useState('');
  const [newBindingDesc, setNewBindingDesc] = useState('');

  // Synchronize external prop changes
  useEffect(() => {
    if (onUpdateBindings) {
      onUpdateBindings(bindings);
    }
    try {
      localStorage.setItem('agentsam_runtime_bindings', JSON.stringify(bindings));
    } catch { }
  }, [bindings, onUpdateBindings]);

  // Keep rawText synchronized when visual bindings change
  const syncVisualToRaw = (newBindings: RuntimeBinding[]) => {
    const generated = generateWranglerJsonc(newBindings);
    setRawText(generated);
    setRawError(null);
  };

  const handleUpdateBinding = (updated: RuntimeBinding) => {
    const next = bindings.map(b => b.id === updated.id ? updated : b);
    setBindings(next);
    syncVisualToRaw(next);
  };

  const handleToggleBinding = (id: string) => {
    const next = bindings.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b);
    setBindings(next);
    syncVisualToRaw(next);
  };

  const handleDeleteBinding = (id: string) => {
    const next = bindings.filter(b => b.id !== id);
    setBindings(next);
    syncVisualToRaw(next);
  };

  const handleLoadPreset = (presetId: string) => {
    const preset = BINDING_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setBindings(preset.bindings);
    syncVisualToRaw(preset.bindings);
    setRawSuccessMessage(`Loaded "${preset.name}" preset.`);
    setTimeout(() => setRawSuccessMessage(null), 3000);
  };

  // Handle Raw Text Change in Monaco Editor
  const handleRawTextChange = (text: string) => {
    setRawText(text);
    const result = parseWranglerJsoncToBindings(text, bindings);
    if (result.error) {
      setRawError(result.error);
    } else {
      setRawError(null);
      setBindings(result.bindings);
    }
  };

  const handleFormatRaw = () => {
    const formatted = generateWranglerJsonc(bindings);
    setRawText(formatted);
    setRawError(null);
    setRawSuccessMessage('Configuration formatted and validated.');
    setTimeout(() => setRawSuccessMessage(null), 3000);
  };

  const handleCopyRaw = () => {
    navigator.clipboard.writeText(rawText);
    setRawSuccessMessage('wrangler.jsonc copied to clipboard!');
    setTimeout(() => setRawSuccessMessage(null), 3000);
  };

  const handleDownloadRaw = () => {
    const blob = new Blob([rawText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wrangler.jsonc';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddBindingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const meta = BINDING_FAMILY_META[selectedAddFamily];
    const bindingIdentifier = (newBindingName.trim() || meta.exampleBinding).toUpperCase().replace(/[^A-Z0-9_]/g, '_');

    let newBinding: RuntimeBinding;

    switch (selectedAddFamily) {
      case 'd1':
        newBinding = {
          id: `bind-d1-${Date.now()}`,
          family: 'd1',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'configured',
          database_name: `${bindingIdentifier.toLowerCase()}_db`,
          database_id: `d1-${Math.random().toString(36).substring(2, 10)}`,
          migrations_dir: './d1/migrations',
        };
        break;
      case 'kv':
        newBinding = {
          id: `bind-kv-${Date.now()}`,
          family: 'kv',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'configured',
          namespace_id: `kv-${Math.random().toString(36).substring(2, 12)}`,
        };
        break;
      case 'r2':
        newBinding = {
          id: `bind-r2-${Date.now()}`,
          family: 'r2',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'configured',
          bucket_name: `${bindingIdentifier.toLowerCase()}-bucket`,
          jurisdiction: 'default',
        };
        break;
      case 'durable_object':
        newBinding = {
          id: `bind-do-${Date.now()}`,
          family: 'durable_object',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'configured',
          class_name: `${bindingIdentifier.charAt(0) + bindingIdentifier.slice(1).toLowerCase()}Actor`,
        };
        break;
      case 'ai':
        newBinding = {
          id: `bind-ai-${Date.now()}`,
          family: 'ai',
          binding: bindingIdentifier || 'AI',
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'active',
          model_routing: 'auto',
        };
        break;
      case 'browser':
        newBinding = {
          id: `bind-browser-${Date.now()}`,
          family: 'browser',
          binding: bindingIdentifier || 'BROWSER',
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'active',
          engine: 'kitesurf_worker',
          session_timeout_sec: 120,
        };
        break;
      case 'vectorize':
        newBinding = {
          id: `bind-vec-${Date.now()}`,
          family: 'vectorize',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'configured',
          index_name: `${bindingIdentifier.toLowerCase()}-index`,
          dimensions: 1536,
          metric: 'cosine',
        };
        break;
      case 'queue':
        newBinding = {
          id: `bind-queue-${Date.now()}`,
          family: 'queue',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'configured',
          queue_name: `${bindingIdentifier.toLowerCase()}-queue`,
          role: 'producer',
        };
        break;
      case 'workflow':
        newBinding = {
          id: `bind-wf-${Date.now()}`,
          family: 'workflow',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'configured',
          name: `${bindingIdentifier.toLowerCase()}-workflow`,
          class_name: `${bindingIdentifier}Workflow`,
        };
        break;
      case 'service':
        newBinding = {
          id: `bind-svc-${Date.now()}`,
          family: 'service',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'bound',
          service: `${bindingIdentifier.toLowerCase()}-service`,
        };
        break;
      case 'analytics_engine':
        newBinding = {
          id: `bind-ae-${Date.now()}`,
          family: 'analytics_engine',
          binding: bindingIdentifier,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'active',
          dataset: `${bindingIdentifier.toLowerCase()}_events`,
        };
        break;
      case 'vars':
        newBinding = {
          id: `bind-var-${Date.now()}`,
          family: 'vars',
          binding: bindingIdentifier,
          name: bindingIdentifier,
          value: 'value',
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'active',
        };
        break;
      case 'secrets':
        newBinding = {
          id: `bind-sec-${Date.now()}`,
          family: 'secrets',
          binding: bindingIdentifier,
          name: bindingIdentifier,
          secret_ref: `vault://cf-secrets/${bindingIdentifier.toLowerCase()}`,
          value: 'secret_token_val',
          is_masked: true,
          enabled: true,
          environment: 'all',
          description: newBindingDesc || meta.description,
          status: 'active',
          isSecret: true,
        };
        break;
    }

    const next = [...bindings, newBinding];
    setBindings(next);
    syncVisualToRaw(next);
    setIsAddModalOpen(false);
    setNewBindingName('');
    setNewBindingDesc('');
  };

  const filteredBindings = useMemo(() => {
    return bindings.filter(b => {
      const meta = BINDING_FAMILY_META[b.family];
      if (categoryFilter !== 'all' && meta.category !== categoryFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = b.binding.toLowerCase().includes(q);
        const matchDesc = b.description.toLowerCase().includes(q);
        const matchFamily = b.family.toLowerCase().includes(q);
        return matchName || matchDesc || matchFamily;
      }
      return true;
    });
  }, [bindings, categoryFilter, searchQuery]);

  const activeCount = bindings.filter(b => b.enabled).length;

  return (
    <div className="bindings-surface-root flex flex-col gap-4 text-zinc-200">
      {/* Header & Runtime Context Banner */}
      <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-950 border border-sky-800 flex items-center justify-center text-sky-400">
            <span className="material-symbols-outlined text-2xl">cable</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Cloudflare Bindings & Edge Runtime
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 border border-emerald-800 text-emerald-400">
                {activeCount} Active / {bindings.length} Total
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Configures typed serverless bindings exposed to AgentSam via <code>env.BINDING_NAME</code> in Worker Isolates.
            </p>
          </div>
        </div>

        {/* View Switcher & Actions */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-lg p-0.5 flex items-center">
            <button
              type="button"
              onClick={() => setViewMode('visual')}
              className={`px-3 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
                viewMode === 'visual'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="material-symbols-outlined text-sm">dashboard</span>
              <span>Visual Editor</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('raw');
                syncVisualToRaw(bindings);
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${
                viewMode === 'raw'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="material-symbols-outlined text-sm">code</span>
              <span>Raw wrangler.jsonc</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-md transition-all"
          >
            <span className="material-symbols-outlined text-base">add</span>
            <span>Add Binding</span>
          </button>
        </div>
      </div>

      {/* Preset Quick Loader Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-300">Preset Stacks:</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {BINDING_PRESETS.map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleLoadPreset(preset.id)}
                className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium flex items-center gap-1 transition-colors"
                title={preset.description}
              >
                <span>{preset.name}</span>
                <span className="text-[9px] px-1 rounded bg-zinc-800 text-sky-400 font-mono">
                  {preset.badge}
                </span>
              </button>
            ))}
          </div>
        </div>

        {rawSuccessMessage && (
          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 animate-pulse">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            {rawSuccessMessage}
          </span>
        )}
      </div>

      {/* VIEW 1: VISUAL CARDS & CONFIGURATION */}
      {viewMode === 'visual' ? (
        <div className="flex flex-col gap-3">
          {/* Filter & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
            {/* Category Chips */}
            <div className="flex flex-wrap items-center gap-1">
              {[
                { id: 'all', label: 'All Families' },
                { id: 'AI & Search', label: 'AI & Search' },
                { id: 'Storage & DB', label: 'Storage & DB' },
                { id: 'Compute & DO', label: 'Compute & DO' },
                { id: 'Network & Infra', label: 'Network & Infra' },
                { id: 'Vars & Secrets', label: 'Vars & Secrets' },
              ].map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                    categoryFilter === cat.id
                      ? 'bg-sky-950 border border-sky-700 text-sky-300'
                      : 'bg-zinc-900 border border-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-48">
              <input
                type="text"
                placeholder="Filter bindings..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1 text-zinc-500 hover:text-zinc-300 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Bindings List */}
          <div className="grid grid-cols-1 gap-2.5">
            {filteredBindings.length === 0 ? (
              <div className="p-8 text-center bg-zinc-950/60 rounded-xl border border-zinc-800/80 text-zinc-500 text-xs">
                No bindings match your filter criteria. Click <strong>Add Binding</strong> to configure a new Cloudflare resource.
              </div>
            ) : (
              filteredBindings.map(binding => {
                const meta = BINDING_FAMILY_META[binding.family];
                const isExpanded = expandedBindingId === binding.id;
                const isSecret = binding.isSecret || binding.family === 'secrets';
                const isRevealed = !!revealedSecretIds[binding.id];

                return (
                  <div
                    key={binding.id}
                    className={`rounded-xl border transition-all ${
                      binding.enabled
                        ? 'bg-zinc-950/80 border-zinc-800/90 hover:border-zinc-700'
                        : 'bg-zinc-950/40 border-zinc-900 opacity-60'
                    }`}
                  >
                    {/* Main Row */}
                    <div className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {/* Family Icon Box */}
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center border shrink-0"
                          style={{
                            backgroundColor: `${meta.badgeColor}15`,
                            borderColor: `${meta.badgeColor}40`,
                            color: meta.badgeColor,
                          }}
                        >
                          <span className="material-symbols-outlined text-lg">{meta.icon}</span>
                        </div>

                        {/* Title & Identifier */}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-white tracking-wide">
                              env.{binding.binding}
                            </span>
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase"
                              style={{
                                backgroundColor: `${meta.badgeColor}20`,
                                color: meta.badgeColor,
                                border: `1px solid ${meta.badgeColor}44`,
                              }}
                            >
                              {meta.label}
                            </span>
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono uppercase ${
                              binding.status === 'active' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                              binding.status === 'bound' ? 'bg-sky-950 text-sky-400 border border-sky-800' :
                              'bg-zinc-900 text-zinc-400 border border-zinc-800'
                            }`}>
                              {binding.status}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">
                            {binding.description}
                          </p>
                        </div>
                      </div>

                      {/* Controls (Toggle, Expand, Delete) */}
                      <div className="flex items-center gap-2">
                        {/* Target Summary for quick glance */}
                        <div className="hidden md:block text-right font-mono text-[11px] text-zinc-400">
                          {binding.family === 'd1' && <span>DB: {(binding as D1Binding).database_name}</span>}
                          {binding.family === 'kv' && <span>ID: {(binding as KVBinding).namespace_id.slice(0, 10)}...</span>}
                          {binding.family === 'r2' && <span>Bucket: {(binding as R2Binding).bucket_name}</span>}
                          {binding.family === 'durable_object' && <span>Class: {(binding as DurableObjectBinding).class_name}</span>}
                          {binding.family === 'vectorize' && <span>Index: {(binding as VectorizeBinding).index_name}</span>}
                          {binding.family === 'browser' && <span>Engine: {(binding as BrowserBinding).engine}</span>}
                          {binding.family === 'ai' && <span>Routing: Auto</span>}
                          {binding.family === 'vars' && <span>= {(binding as EnvVarBinding).value}</span>}
                          {binding.family === 'secrets' && (
                            <span className="text-red-400">
                              {isRevealed ? (binding as SecretBinding).value : '••••••••••••••••'}
                            </span>
                          )}
                        </div>

                        {/* Secret Reveal button */}
                        {isSecret && (
                          <button
                            type="button"
                            onClick={() => setRevealedSecretIds(prev => ({ ...prev, [binding.id]: !prev[binding.id] }))}
                            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs"
                            title={isRevealed ? 'Mask secret' : 'Reveal secret'}
                          >
                            <span className="material-symbols-outlined text-base">
                              {isRevealed ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        )}

                        {/* Enable/Disable Toggle */}
                        <button
                          type="button"
                          onClick={() => handleToggleBinding(binding.id)}
                          className={`w-10 h-5 rounded-full relative transition-colors ${
                            binding.enabled ? 'bg-sky-600' : 'bg-zinc-800'
                          }`}
                          title={binding.enabled ? 'Disable binding' : 'Enable binding'}
                        >
                          <div
                            className={`w-4 h-4 rounded-full bg-white transition-transform ${
                              binding.enabled ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>

                        {/* Expand Details */}
                        <button
                          type="button"
                          onClick={() => setExpandedBindingId(isExpanded ? null : binding.id)}
                          className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
                          title="Configure Parameters"
                        >
                          <span className="material-symbols-outlined text-base">
                            {isExpanded ? 'expand_less' : 'tune'}
                          </span>
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => handleDeleteBinding(binding.id)}
                          className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                          title="Delete Binding"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Collapsible Deep Parameter Form */}
                    {isExpanded && (
                      <div className="p-4 border-t border-zinc-900 bg-zinc-950/90 rounded-b-xl grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        {/* Identifier */}
                        <div>
                          <label className="block text-zinc-400 mb-1 font-semibold">Binding Identifier (JS/TS Variable)</label>
                          <input
                            type="text"
                            value={binding.binding}
                            onChange={e => handleUpdateBinding({ ...binding, binding: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                          />
                        </div>

                        {/* Description */}
                        <div>
                          <label className="block text-zinc-400 mb-1 font-semibold">Description / Purpose</label>
                          <input
                            type="text"
                            value={binding.description}
                            onChange={e => handleUpdateBinding({ ...binding, description: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100"
                          />
                        </div>

                        {/* Family specific deep inputs */}
                        {binding.family === 'd1' && (
                          <>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Database Name</label>
                              <input
                                type="text"
                                value={(binding as D1Binding).database_name}
                                onChange={e => handleUpdateBinding({ ...binding, database_name: e.target.value } as D1Binding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Database UUID</label>
                              <input
                                type="text"
                                value={(binding as D1Binding).database_id}
                                onChange={e => handleUpdateBinding({ ...binding, database_id: e.target.value } as D1Binding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                              />
                            </div>
                          </>
                        )}

                        {binding.family === 'kv' && (
                          <div>
                            <label className="block text-zinc-400 mb-1 font-semibold">Namespace ID</label>
                            <input
                              type="text"
                              value={(binding as KVBinding).namespace_id}
                              onChange={e => handleUpdateBinding({ ...binding, namespace_id: e.target.value } as KVBinding)}
                              className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                            />
                          </div>
                        )}

                        {binding.family === 'r2' && (
                          <>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Bucket Name</label>
                              <input
                                type="text"
                                value={(binding as R2Binding).bucket_name}
                                onChange={e => handleUpdateBinding({ ...binding, bucket_name: e.target.value } as R2Binding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Jurisdiction</label>
                              <select
                                value={(binding as R2Binding).jurisdiction || 'default'}
                                onChange={e => handleUpdateBinding({ ...binding, jurisdiction: e.target.value as any } as R2Binding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100"
                              >
                                <option value="default">Default Global</option>
                                <option value="eu">European Union (EU)</option>
                                <option value="fedramp">FedRAMP Compliant</option>
                              </select>
                            </div>
                          </>
                        )}

                        {binding.family === 'durable_object' && (
                          <div>
                            <label className="block text-zinc-400 mb-1 font-semibold">Exported Class Name</label>
                            <input
                              type="text"
                              value={(binding as DurableObjectBinding).class_name}
                              onChange={e => handleUpdateBinding({ ...binding, class_name: e.target.value } as DurableObjectBinding)}
                              className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                            />
                          </div>
                        )}

                        {binding.family === 'browser' && (
                          <div>
                            <label className="block text-zinc-400 mb-1 font-semibold">Browser Engine</label>
                            <select
                              value={(binding as BrowserBinding).engine}
                              onChange={e => handleUpdateBinding({ ...binding, engine: e.target.value as any } as BrowserBinding)}
                              className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100"
                            >
                              <option value="kitesurf_worker">Kitesurf Worker Browser (Ultra-Light 420ms)</option>
                              <option value="browser_run_cdp">Browser Run (Full Chromium CDP)</option>
                            </select>
                          </div>
                        )}

                        {binding.family === 'vectorize' && (
                          <>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Index Name</label>
                              <input
                                type="text"
                                value={(binding as VectorizeBinding).index_name}
                                onChange={e => handleUpdateBinding({ ...binding, index_name: e.target.value } as VectorizeBinding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Dimensions & Metric</label>
                              <input
                                type="number"
                                value={(binding as VectorizeBinding).dimensions}
                                onChange={e => handleUpdateBinding({ ...binding, dimensions: parseInt(e.target.value) || 1536 } as VectorizeBinding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                              />
                            </div>
                          </>
                        )}

                        {binding.family === 'vars' && (
                          <div>
                            <label className="block text-zinc-400 mb-1 font-semibold">Variable Value</label>
                            <input
                              type="text"
                              value={(binding as EnvVarBinding).value}
                              onChange={e => handleUpdateBinding({ ...binding, value: e.target.value } as EnvVarBinding)}
                              className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                            />
                          </div>
                        )}

                        {binding.family === 'secrets' && (
                          <>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Vault Secret Reference</label>
                              <input
                                type="text"
                                value={(binding as SecretBinding).secret_ref || ''}
                                onChange={e => handleUpdateBinding({ ...binding, secret_ref: e.target.value } as SecretBinding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-zinc-400 mb-1 font-semibold">Encrypted Value (Masked)</label>
                              <input
                                type={isRevealed ? 'text' : 'password'}
                                value={(binding as SecretBinding).value || ''}
                                onChange={e => handleUpdateBinding({ ...binding, value: e.target.value } as SecretBinding)}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 font-mono text-red-400"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* VIEW 2: RAW MONACO WRANGLER CONFIG */
        <div className="flex flex-col gap-2">
          {/* Raw Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800 text-xs">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-sky-400">description</span>
              <span className="font-mono font-semibold text-zinc-200">wrangler.jsonc (Live Synchronized)</span>
              {rawError ? (
                <span className="px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-800 text-[11px] font-mono">
                  Syntax Error
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[11px] font-mono">
                  Valid Config
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFormatRaw}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs flex items-center gap-1 font-medium"
              >
                <span className="material-symbols-outlined text-sm">auto_fix_high</span>
                <span>Format</span>
              </button>
              <button
                type="button"
                onClick={handleCopyRaw}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs flex items-center gap-1 font-medium"
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
                <span>Copy</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadRaw}
                className="px-2.5 py-1 rounded bg-sky-950 hover:bg-sky-900 border border-sky-800 text-sky-300 text-xs flex items-center gap-1 font-medium"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                <span>Export File</span>
              </button>
            </div>
          </div>

          {/* Syntax Error Alert */}
          {rawError && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-300 text-xs font-mono">
              <strong>Error:</strong> {rawError}
            </div>
          )}

          {/* Monaco Editor Container */}
          <div className="h-[460px] rounded-xl border border-zinc-800 overflow-hidden bg-zinc-950">
            <MonacoEditor
              value={rawText}
              language="jsonc"
              onChange={handleRawTextChange}
              options={{
                lineNumbers: 'on',
                minimap: true,
                wordWrap: 'on',
              }}
            />
          </div>
        </div>
      )}

      {/* ADD BINDING MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div
            className="bg-zinc-950 border border-zinc-700 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xl text-emerald-400">add_circle</span>
                <h3 className="text-base font-bold text-white">Add Cloudflare Runtime Binding</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddBindingSubmit} className="space-y-4">
              {/* Family Selector Grid */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Select Binding Family
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                  {(Object.keys(BINDING_FAMILY_META) as BindingFamily[]).map(fam => {
                    const meta = BINDING_FAMILY_META[fam];
                    const isSelected = selectedAddFamily === fam;
                    return (
                      <button
                        key={fam}
                        type="button"
                        onClick={() => setSelectedAddFamily(fam)}
                        className={`p-2 rounded-lg border text-left flex items-start gap-2 transition-all ${
                          isSelected
                            ? 'bg-sky-950/80 border-sky-500 text-white'
                            : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <span className="material-symbols-outlined text-base mt-0.5" style={{ color: meta.badgeColor }}>
                          {meta.icon}
                        </span>
                        <div>
                          <div className="text-xs font-bold">{meta.label}</div>
                          <div className="text-[10px] text-zinc-500 font-mono">env.{meta.exampleBinding}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Binding Name */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Binding Variable Name (in <code>env.VARIABLE</code>)
                </label>
                <input
                  type="text"
                  placeholder={BINDING_FAMILY_META[selectedAddFamily].exampleBinding}
                  value={newBindingName}
                  onChange={e => setNewBindingName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-xs text-white font-mono placeholder-zinc-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Description / Purpose
                </label>
                <input
                  type="text"
                  placeholder={BINDING_FAMILY_META[selectedAddFamily].description}
                  value={newBindingDesc}
                  onChange={e => setNewBindingDesc(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 shadow-md"
                >
                  Confirm & Bind
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
