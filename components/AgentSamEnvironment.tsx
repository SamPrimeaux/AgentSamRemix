import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BackendType,
  BACKEND_CONFIGS,
  ModelTier,
  MODEL_TIER_CONFIGS,
  MissionStep,
  MissionReport,
  PresetMission,
} from '../types/agentSam';
import { PRESET_MISSIONS, generateStepsForMission } from '../data/missionPresets';
import { CodeWorkspace } from './workspace/CodeWorkspace';
import { RuntimeBinding, DEFAULT_RUNTIME_BINDINGS } from '../types/bindings';

interface AgentSamEnvironmentProps {
  onSwitchToBrowser?: () => void;
}

export const AgentSamEnvironment: React.FC<AgentSamEnvironmentProps> = ({ onSwitchToBrowser }) => {
  // State
  const [selectedBackend, setSelectedBackend] = useState<BackendType>('cloudflare_computer');
  const [selectedModelTier, setSelectedModelTier] = useState<ModelTier>('glm_5_3_flash');
  const [selectedMissionId, setSelectedMissionId] = useState<string>('repair-mobile-chat-composer');
  const [codeModeEnabled, setCodeModeEnabled] = useState<boolean>(true);
  const [dailyBudgetUsd] = useState<number>(5.00);

  // Runtime Bindings state
  const [runtimeBindings, setRuntimeBindings] = useState<RuntimeBinding[]>(() => {
    try {
      const saved = localStorage.getItem('agentsam_runtime_bindings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_RUNTIME_BINDINGS;
  });

  // Execution state
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'stream' | 'code_workspace' | 'browser_verifier' | 'code_mode' | 'network' | 'artifacts' | 'benchmark'>('stream');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 4x, 0 = instant

  const streamEndRef = useRef<HTMLDivElement>(null);
  const stepTimerRef = useRef<number | null>(null);

  // Selected mission definition
  const currentMission = useMemo(() => {
    return PRESET_MISSIONS.find(m => m.id === selectedMissionId) || PRESET_MISSIONS[0];
  }, [selectedMissionId]);

  // Selected model definition
  const currentModel = MODEL_TIER_CONFIGS[selectedModelTier];

  // Generated steps & report for current backend & mission
  const { steps: allSteps, report: missionReport } = useMemo(() => {
    return generateStepsForMission(selectedMissionId, selectedBackend);
  }, [selectedMissionId, selectedBackend]);

  // Steps to display based on progress
  const visibleSteps = useMemo(() => {
    return allSteps.slice(0, currentStepIndex);
  }, [allSteps, currentStepIndex]);

  // Cumulative token and cost metrics
  const telemetry = useMemo(() => {
    let input = 0;
    let output = 0;
    let thinking = 0;
    let durationMs = 0;
    let toolCallsCount = 0;
    let terminalCallsCount = 0;
    let codeModeCount = 0;
    let roundTripsSavedTotal = 0;
    let workerIsolateOps = 0;
    let containerOps = 0;

    visibleSteps.forEach(s => {
      input += s.tokens.input;
      output += s.tokens.output;
      thinking += s.tokens.thinking;
      durationMs += s.durationMs;
      if (s.phase === 'tool_call' || s.phase === 'fileDiff') toolCallsCount++;
      if (s.phase === 'code_mode') {
        codeModeCount++;
        roundTripsSavedTotal += s.codeMode?.roundTripsSaved || 0;
      }
      if (s.terminal) {
        terminalCallsCount++;
        if (s.terminal.backendLane === 'worker_isolate') workerIsolateOps++;
        if (s.terminal.backendLane === 'linux_container') containerOps++;
      }
    });

    const totalTokens = input + output + thinking;
    
    // Model pricing from selected model tier
    const modelCost = ((input / 1_000_000) * currentModel.inputPricePerM) + 
                      (((output + thinking) / 1_000_000) * currentModel.outputPricePerM);
    
    // Antigravity vs Cloudflare vs Local Compute pricing
    const computeHours = durationMs / (1000 * 60 * 60);
    const computeCost = selectedBackend === 'antigravity'
      ? 0.0
      : computeHours * BACKEND_CONFIGS[selectedBackend].computeCostPerHour;

    const totalCost = modelCost + computeCost;
    const budgetPct = Math.min(100, (totalCost / dailyBudgetUsd) * 100);

    return {
      input,
      output,
      thinking,
      totalTokens,
      durationMs,
      toolCallsCount,
      terminalCallsCount,
      codeModeCount,
      roundTripsSavedTotal,
      workerIsolateOps,
      containerOps,
      modelCost,
      computeCost,
      totalCost,
      budgetPct,
      isCompleted: currentStepIndex >= allSteps.length,
    };
  }, [visibleSteps, selectedBackend, currentModel, currentStepIndex, allSteps.length, dailyBudgetUsd]);

  // Auto-expand newly appearing steps
  useEffect(() => {
    if (visibleSteps.length > 0) {
      const latestStep = visibleSteps[visibleSteps.length - 1];
      setExpandedStepIds(prev => ({
        ...prev,
        [latestStep.id]: true,
      }));
    }
  }, [visibleSteps.length]);

  // Auto-scroll stream to bottom when running
  useEffect(() => {
    if (isRunning && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [visibleSteps.length, isRunning]);

  // Execution loop timer
  useEffect(() => {
    if (!isRunning || isPaused) {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      return;
    }

    if (currentStepIndex >= allSteps.length) {
      setIsRunning(false);
      return;
    }

    const currentStep = allSteps[currentStepIndex];
    const delay = playbackSpeed === 0 ? 40 : Math.max(220, currentStep.durationMs / playbackSpeed);

    stepTimerRef.current = window.setTimeout(() => {
      setCurrentStepIndex(prev => prev + 1);
    }, delay);

    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, [isRunning, isPaused, currentStepIndex, allSteps, playbackSpeed]);

  // Handlers
  const handleStartMission = () => {
    setCurrentStepIndex(1);
    setIsRunning(true);
    setIsPaused(false);
  };

  const handlePauseResume = () => {
    setIsPaused(prev => !prev);
  };

  const handleStepForward = () => {
    if (currentStepIndex < allSteps.length) {
      setCurrentStepIndex(prev => prev + 1);
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    setIsPaused(false);
    setCurrentStepIndex(0);
    setExpandedStepIds({});
  };

  const handleRunAllInstant = () => {
    setCurrentStepIndex(allSteps.length);
    setIsRunning(false);
    setIsPaused(false);
    const allExp: Record<string, boolean> = {};
    allSteps.forEach(s => {
      allExp[s.id] = true;
    });
    setExpandedStepIds(allExp);
  };

  const toggleStepExpand = (stepId: string) => {
    setExpandedStepIds(prev => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  const backendConfig = BACKEND_CONFIGS[selectedBackend];

  return (
    <div className="agentsam-env-root">
      {/* Top Banner / Navigation */}
      <header className="agentsam-header">
        <div className="agentsam-brand-row">
          <div className="agentsam-logo-group">
            <div className="agentsam-hex-icon">
              <span className="material-symbols-outlined">terminal</span>
            </div>
            <div>
              <div className="agentsam-brand-title flex items-center gap-2">
                AgentSam Engine <span className="agentsam-badge-tag">@cloudflare/think + computer</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
                  GLM-5.3 Flash Active
                </span>
              </div>
              <div className="agentsam-brand-desc">
                Sovereign coding harness: SQLite-backed filesystem, Code Mode tool composition, AI Gateway Spend Limits & Kitesurf browser lane
              </div>
            </div>
          </div>

          <div className="agentsam-top-actions">
            {onSwitchToBrowser && (
              <button
                onClick={onSwitchToBrowser}
                className="agentsam-btn outline"
                title="Switch back to Browser Simulation"
              >
                <span className="material-symbols-outlined">language</span>
                <span>Browser UI</span>
              </button>
            )}
            <button
              onClick={() => {
                const json = JSON.stringify({ 
                  mission: currentMission, 
                  modelTier: currentModel,
                  backend: backendConfig,
                  telemetry, 
                  steps: visibleSteps 
                }, null, 2);
                navigator.clipboard.writeText(json);
                alert('Mission & AI Gateway Telemetry copied to clipboard!');
              }}
              className="agentsam-btn outline"
              title="Copy JSON Telemetry"
            >
              <span className="material-symbols-outlined">content_copy</span>
              <span>Export Telemetry</span>
            </button>
          </div>
        </div>

        {/* Dynamic AI Gateway & Spend Limit Status Strip */}
        <div className="bg-zinc-950/90 border-y border-zinc-800/80 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-medium text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>AI Gateway Dynamic Router:</span>
              <span className="text-emerald-400 font-mono font-bold">{currentModel.name}</span>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-zinc-400 border-l border-zinc-800 pl-3">
              <span>Input: <strong className="text-zinc-200">${currentModel.inputPricePerM}/M</strong></span>
              <span>•</span>
              <span>Output: <strong className="text-zinc-200">${currentModel.outputPricePerM}/M</strong></span>
            </div>
            <div className="hidden md:flex items-center gap-1 text-sky-400 border-l border-zinc-800 pl-3">
              <span className="material-symbols-outlined text-xs">code</span>
              <span>Code Mode: <strong>{codeModeEnabled ? 'Enabled (1-turn tool scripts)' : 'Traditional Loop'}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">Daily Spend Cap:</span>
              <div className="w-24 bg-zinc-800 rounded-full h-2 overflow-hidden border border-zinc-700">
                <div 
                  className={`h-full transition-all duration-300 ${telemetry.budgetPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                  style={{ width: `${Math.max(4, telemetry.budgetPct)}%` }}
                />
              </div>
              <span className="font-mono text-zinc-200 font-bold">
                ${telemetry.totalCost.toFixed(5)} / ${dailyBudgetUsd.toFixed(2)}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] uppercase font-bold">
              Within Budget
            </span>
          </div>
        </div>

        {/* Control Toolbar */}
        <div className="agentsam-controls-bar">
          {/* Mission Selector */}
          <div className="agentsam-control-group">
            <label className="agentsam-ctrl-label">ENGINEERING MISSION</label>
            <select
              value={selectedMissionId}
              disabled={isRunning}
              onChange={(e) => {
                setSelectedMissionId(e.target.value);
                handleReset();
              }}
              className="agentsam-select"
            >
              {PRESET_MISSIONS.map(m => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>

          {/* Model Ladder Tier Selector */}
          <div className="agentsam-control-group">
            <label className="agentsam-ctrl-label">MODEL LADDER (AI GATEWAY)</label>
            <div className="agentsam-backend-pill-group">
              {(Object.keys(MODEL_TIER_CONFIGS) as ModelTier[]).map((tierKey) => {
                const tier = MODEL_TIER_CONFIGS[tierKey];
                const isSelected = selectedModelTier === tierKey;
                return (
                  <button
                    key={tierKey}
                    disabled={isRunning}
                    onClick={() => {
                      setSelectedModelTier(tierKey);
                    }}
                    className={`agentsam-backend-pill ${isSelected ? 'active' : ''}`}
                    title={`${tier.name} - ${tier.description} ($${tier.inputPricePerM}/M in, $${tier.outputPricePerM}/M out)`}
                  >
                    <span className="backend-name">{tier.name.split(' ')[0]}</span>
                    <span className="backend-badge" style={{ color: tier.badgeColor }}>
                      {tierKey === 'glm_5_3_flash' ? '$0.15/M (Workhorse)' : tierKey === 'glm_5_3' ? '$1.40/M (SWE)' : tierKey === 'gemini_3_7_flash' ? 'Gemini' : 'Claude'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Backend Target Selector */}
          <div className="agentsam-control-group">
            <label className="agentsam-ctrl-label">WORKSPACE EXECUTION</label>
            <div className="agentsam-backend-pill-group">
              {(Object.keys(BACKEND_CONFIGS) as BackendType[]).map((key) => {
                const cfg = BACKEND_CONFIGS[key];
                const isSelected = selectedBackend === key;
                return (
                  <button
                    key={key}
                    disabled={isRunning}
                    onClick={() => {
                      setSelectedBackend(key);
                      handleReset();
                    }}
                    className={`agentsam-backend-pill ${isSelected ? 'active' : ''}`}
                    title={`${cfg.name} - ${cfg.tagline}`}
                  >
                    <span className="backend-name">{cfg.name.split(' ')[0]}</span>
                    <span className="backend-badge">
                      {key === 'cloudflare_computer' ? 'Dual Isolate/Linux' : key === 'antigravity' ? 'Antigravity' : key === 'cloudflare' ? 'Container' : 'Local'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Run / Controls */}
          <div className="agentsam-control-group playback-group">
            <label className="agentsam-ctrl-label">EXECUTION CONTROLS</label>
            <div className="flex items-center gap-2">
              {!isRunning && currentStepIndex === 0 ? (
                <button
                  onClick={handleStartMission}
                  className="agentsam-btn primary"
                  title="Execute Mission Step-by-Step"
                >
                  <span className="material-symbols-outlined">play_arrow</span>
                  <span>Run Mission</span>
                </button>
              ) : isRunning ? (
                <button
                  onClick={handlePauseResume}
                  className={`agentsam-btn ${isPaused ? 'warning' : 'secondary'}`}
                  title={isPaused ? 'Resume Mission' : 'Pause Execution'}
                >
                  <span className="material-symbols-outlined">{isPaused ? 'play_arrow' : 'pause'}</span>
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </button>
              ) : (
                <button
                  onClick={handleReset}
                  className="agentsam-btn secondary"
                  title="Reset Mission"
                >
                  <span className="material-symbols-outlined">replay</span>
                  <span>Restart</span>
                </button>
              )}

              <button
                onClick={handleStepForward}
                disabled={isRunning || currentStepIndex >= allSteps.length}
                className="agentsam-btn secondary icon-only"
                title="Single Step Forward"
              >
                <span className="material-symbols-outlined">skip_next</span>
              </button>

              <button
                onClick={handleRunAllInstant}
                disabled={currentStepIndex >= allSteps.length}
                className="agentsam-btn secondary"
                title="Run All Steps Instantly"
              >
                <span className="material-symbols-outlined">fast_forward</span>
                <span>Run Instant</span>
              </button>

              <div className="playback-speed-selector">
                <span className="speed-label">Speed:</span>
                {[1, 2, 4, 0].map(s => (
                  <button
                    key={s}
                    onClick={() => setPlaybackSpeed(s)}
                    className={`speed-pill ${playbackSpeed === s ? 'active' : ''}`}
                  >
                    {s === 0 ? 'Max' : `${s}x`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid: Workspace / Ledger / Telemetry */}
      <main className="agentsam-body-grid">
        {/* Left Side: Live Execution Ledger & Tabs */}
        <section className="agentsam-main-pane">
          {/* Pane Tab Header */}
          <div className="agentsam-pane-tabs">
            <div className="flex items-center gap-1 overflow-x-auto">
              <button
                onClick={() => setActiveTab('stream')}
                className={`pane-tab ${activeTab === 'stream' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined text-sm">terminal</span>
                <span>Execution Ledger ({visibleSteps.length}/{allSteps.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('code_workspace')}
                className={`pane-tab ${activeTab === 'code_workspace' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined text-sm text-sky-400">code</span>
                <span>Code Workspace (Monaco)</span>
              </button>
              <button
                onClick={() => setActiveTab('browser_verifier')}
                className={`pane-tab ${activeTab === 'browser_verifier' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined text-sm">devices</span>
                <span>Browser Verifier (Kitesurf + Chromium)</span>
              </button>
              <button
                onClick={() => setActiveTab('code_mode')}
                className={`pane-tab ${activeTab === 'code_mode' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined text-sm">integration_instructions</span>
                <span>Code Mode Tool Composition</span>
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`pane-tab ${activeTab === 'network' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined text-sm">public</span>
                <span>Network & Allowlist ({backendConfig.allowlist.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('artifacts')}
                className={`pane-tab ${activeTab === 'artifacts' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined text-sm">hub</span>
                <span>Architecture & Report {telemetry.isCompleted && <span className="tab-pill-done">Ready</span>}</span>
              </button>
              <button
                onClick={() => setActiveTab('benchmark')}
                className={`pane-tab ${activeTab === 'benchmark' ? 'active' : ''}`}
              >
                <span className="material-symbols-outlined text-sm">query_stats</span>
                <span>Backend Comparison</span>
              </button>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-2">
              {isRunning && !isPaused && (
                <div className="pulse-indicator">
                  <span className="pulse-dot" />
                  <span className="text-xs text-blue-400">EXECUTING AUTONOMOUS LOOP</span>
                </div>
              )}
              {isPaused && (
                <span className="text-xs text-amber-400 font-medium">PAUSED</span>
              )}
              {telemetry.isCompleted && (
                <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">check_circle</span> MISSION COMPLETE
                </span>
              )}
            </div>
          </div>

          {/* TAB 1: Stream View */}
          {activeTab === 'stream' && (
            <div className="agentsam-stream-scroll">
              {/* Mission Prompt Box */}
              <div className="mission-prompt-card">
                <div className="mission-prompt-header">
                  <span className="material-symbols-outlined text-base text-sky-400">assignment</span>
                  <span className="font-semibold text-sm text-gray-200">{currentMission.title}</span>
                  <span className="text-xs text-gray-400 ml-auto">Target: {currentMission.targetRepo}</span>
                </div>
                <pre className="mission-prompt-text">{currentMission.prompt}</pre>
              </div>

              {visibleSteps.length === 0 ? (
                <div className="empty-stream-state">
                  <span className="material-symbols-outlined text-4xl text-gray-600 mb-2">rocket_launch</span>
                  <p className="text-gray-300 font-medium">Ready to execute autonomous engineering mission.</p>
                  <p className="text-xs text-gray-500 max-w-sm text-center mt-1">
                    Click <strong>Run Mission</strong> to spawn @cloudflare/computer, execute Code Mode batch exploration, apply verified multi-file edits, and verify via Kitesurf + Browser Run.
                  </p>
                  <button onClick={handleStartMission} className="agentsam-btn primary mt-4">
                    <span className="material-symbols-outlined">play_arrow</span> Start Execution
                  </button>
                </div>
              ) : (
                <div className="stream-steps-list">
                  {visibleSteps.map((step) => {
                    const isExpanded = !!expandedStepIds[step.id];

                    return (
                      <div key={step.id} className={`step-card phase-${step.phase}`}>
                        {/* Step Header */}
                        <div
                          className="step-card-header"
                          onClick={() => toggleStepExpand(step.id)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="step-number-badge">#{step.stepNumber}</div>
                          
                          <div className="step-phase-icon">
                            {step.phase === 'env_init' && <span className="material-symbols-outlined">memory</span>}
                            {step.phase === 'code_mode' && <span className="material-symbols-outlined">integration_instructions</span>}
                            {step.phase === 'thought' && <span className="material-symbols-outlined">psychology</span>}
                            {step.phase === 'terminal' && <span className="material-symbols-outlined">terminal</span>}
                            {step.phase === 'network_egress' && <span className="material-symbols-outlined">lan</span>}
                            {step.phase === 'tool_call' && <span className="material-symbols-outlined">edit_document</span>}
                            {step.phase === 'browser_verification' && <span className="material-symbols-outlined">devices</span>}
                            {step.phase === 'verification' && <span className="material-symbols-outlined">fact_check</span>}
                            {step.phase === 'artifact_generation' && <span className="material-symbols-outlined">auto_awesome</span>}
                          </div>

                          <div className="step-title-group">
                            <div className="step-title flex items-center gap-2">
                              <span>{step.title}</span>
                              {step.subAgent && (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                  step.subAgent === 'Inspector' ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' :
                                  step.subAgent === 'Builder' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                                  step.subAgent === 'BrowserVerifier' ? 'bg-sky-950 text-sky-300 border border-sky-800' :
                                  'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                }`}>
                                  {step.subAgent}
                                </span>
                              )}
                              {step.terminal?.backendLane && (
                                <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono uppercase ${
                                  step.terminal.backendLane === 'worker_isolate' 
                                    ? 'bg-orange-950/70 text-orange-300 border border-orange-800/60' 
                                    : 'bg-blue-950/70 text-blue-300 border border-blue-800/60'
                                }`}>
                                  {step.terminal.backendLane === 'worker_isolate' ? 'Worker Isolate' : 'Linux Container'}
                                </span>
                              )}
                            </div>
                            <div className="step-meta">
                              <span>{step.timestamp}</span>
                              <span>•</span>
                              <span>{step.durationMs}ms</span>
                              <span>•</span>
                              <span>{step.tokens.input + step.tokens.output + step.tokens.thinking} tokens</span>
                            </div>
                          </div>

                          <button className="step-expand-btn" aria-label="Toggle step details">
                            <span className="material-symbols-outlined">
                              {isExpanded ? 'expand_less' : 'expand_more'}
                            </span>
                          </button>
                        </div>

                        {/* Step Body (Collapsible / Click to Expand) */}
                        {isExpanded && (
                          <div className="step-card-body">
                            {/* Thought Box */}
                            {step.thoughtContent && (
                              <div className="thought-box">
                                <div className="thought-label">
                                  <span className="material-symbols-outlined text-xs">psychology</span>
                                  <span>Agent Reasoning / Chain of Thought</span>
                                </div>
                                <div className="thought-content">{step.thoughtContent}</div>
                              </div>
                            )}

                            {/* Code Mode Program Box */}
                            {step.codeMode && (
                              <div className="my-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-sm text-emerald-400">code</span>
                                    <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Cloudflare Code Mode Script</span>
                                  </div>
                                  <span className="px-2 py-0.5 rounded bg-emerald-900/80 text-emerald-200 text-[10px] font-mono font-bold">
                                    {step.codeMode.roundTripsSaved} Round Trips Saved
                                  </span>
                                </div>
                                <pre className="bg-zinc-950/80 p-2.5 rounded border border-emerald-900/40 text-xs font-mono text-emerald-300/90 overflow-x-auto">
                                  {step.codeMode.script}
                                </pre>
                                <div className="mt-2 text-xs text-zinc-300 font-medium">
                                  <strong className="text-emerald-400">Output:</strong> {step.codeMode.resultSummary}
                                </div>
                              </div>
                            )}

                            {/* Terminal Execution Block */}
                            {step.terminal && (
                              <div className="terminal-block">
                                <div className="terminal-header">
                                  <div className="flex items-center gap-1.5">
                                    <span className="term-dot red" />
                                    <span className="term-dot yellow" />
                                    <span className="term-dot green" />
                                    <span className="term-cwd">{step.terminal.cwd}</span>
                                  </div>
                                  <span className="term-status-tag">exit code: {step.terminal.exitCode}</span>
                                </div>
                                <div className="terminal-cmd-line">
                                  <span className="term-prompt">$</span>
                                  <code>{step.terminal.command}</code>
                                </div>
                                <pre className="terminal-stdout">{step.terminal.stdout}</pre>
                              </div>
                            )}

                            {/* Browser Verification Block */}
                            {step.browserVerification && (
                              <div className="my-3 rounded-lg border border-sky-900/60 bg-sky-950/20 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-sm text-sky-400">devices</span>
                                    <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">
                                      {step.browserVerification.engine === 'kitesurf_worker' ? 'Kitesurf Worker Browser' : 'Browser Run Chromium (CDP)'}
                                    </span>
                                  </div>
                                  <span className="px-2 py-0.5 rounded bg-sky-900/80 text-sky-200 text-[10px] font-mono font-bold">
                                    {step.browserVerification.viewport.device} ({step.browserVerification.viewport.width}x{step.browserVerification.viewport.height})
                                  </span>
                                </div>
                                <div className="text-xs text-zinc-300 mb-2">
                                  <strong>Verified:</strong> {step.browserVerification.screenshotLabel}
                                </div>
                                {step.browserVerification.accessibilityTree && (
                                  <pre className="bg-zinc-950/80 p-2 rounded border border-sky-900/40 text-[11px] font-mono text-sky-300 overflow-x-auto">
                                    {step.browserVerification.accessibilityTree.ariaSnapshot}
                                  </pre>
                                )}
                              </div>
                            )}

                            {/* Network Egress Block */}
                            {step.network && (
                              <div className="network-log-card">
                                <div className="network-log-top">
                                  <span className="net-method">{step.network.method}</span>
                                  <span className="net-host">{step.network.host}</span>
                                  <span className={`net-allowed-pill ${step.network.allowed ? 'allowed' : 'blocked'}`}>
                                    {step.network.allowed ? 'ALLOWLIST PASS' : 'BLOCKED'}
                                  </span>
                                  <span className="net-bytes ml-auto">{(step.network.bytes / 1024).toFixed(1)} KB</span>
                                </div>
                                <div className="net-endpoint">{step.network.endpoint}</div>
                                <div className="net-reason">
                                  <strong>Reason:</strong> {step.network.reason}
                                </div>
                              </div>
                            )}

                            {/* File Diff / Inspection */}
                            {step.fileDiff && (
                              <div className="file-diff-card">
                                <div className="file-diff-top">
                                  <span className="material-symbols-outlined text-xs">description</span>
                                  <span className="file-diff-path">{step.fileDiff.filePath}</span>
                                  <span className="file-diff-lines">{step.fileDiff.linesAnalyzed} lines analyzed</span>
                                </div>
                                {step.fileDiff.snippet && (
                                  <pre className="file-diff-snippet">{step.fileDiff.snippet}</pre>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={streamEndRef} />
                </div>
              )}
            </div>
          )}

          {/* TAB: Code Workspace (Monaco) */}
          {activeTab === 'code_workspace' && (
            <div className="agentsam-tab-content flex-1 min-h-[580px] h-full p-0 overflow-hidden rounded-xl border border-zinc-800 shadow-2xl">
              <CodeWorkspace bindings={runtimeBindings} />
            </div>
          )}

          {/* TAB: Browser Verifier */}
          {activeTab === 'browser_verifier' && (
            <div className="agentsam-tab-content p-4 space-y-4">
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sky-400">devices</span>
                    <h3 className="text-base font-bold text-white">Autonomous Browser Lane (Kitesurf & Browser Run)</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-sky-950 border border-sky-800 text-sky-300 text-xs font-mono font-bold">
                    Dual-Engine Architecture
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                  Changes deployed to preview are verified across two autonomous browser tiers: <strong>Kitesurf</strong> (an ultra-light agent browser running directly in Cloudflare Workers using 3–7× less memory for instant accessibility trees) and <strong>Browser Run</strong> (real Chromium CDP for pixel-perfect mobile rendering & screenshot validation).
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Kitesurf Card */}
                  <div className="bg-zinc-950 border border-sky-900/50 rounded-lg p-3">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                        <span className="text-xs font-bold text-sky-200">Kitesurf (Worker Browser)</span>
                      </div>
                      <span className="text-[11px] font-mono text-emerald-400 font-bold">0 Violations</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mb-2">
                      Accessibility tree snapshot extracted in <strong>420ms</strong>:
                    </div>
                    <pre className="bg-zinc-900 p-2 rounded text-[10px] font-mono text-sky-300 overflow-x-auto leading-snug">
{`<form role="form" aria-label="Chat composer form">
  <textbox role="textbox" aria-label="Message AgentSam" aria-multiline="true" />
  <button role="button" aria-label="Attach File" min-height="44px" />
  <button role="button" aria-label="Send Message" min-height="44px" />
</form>`}
                    </pre>
                  </div>

                  {/* Chromium Card */}
                  <div className="bg-zinc-950 border border-pink-900/50 rounded-lg p-3">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-pink-400" />
                        <span className="text-xs font-bold text-pink-200">Browser Run (Chromium CDP)</span>
                      </div>
                      <span className="text-[11px] font-mono text-pink-400 font-bold">iPhone 15 (390x844)</span>
                    </div>
                    <div className="text-[11px] text-zinc-400 mb-2">
                      Pixel-perfect mobile viewport validation:
                    </div>
                    <div className="bg-zinc-900 rounded p-2.5 border border-zinc-800 flex flex-col items-center justify-center text-center">
                      <span className="material-symbols-outlined text-2xl text-emerald-400 mb-1">verified</span>
                      <span className="text-xs font-bold text-zinc-200">Safe-Area Inset Verified</span>
                      <span className="text-[10px] text-zinc-400 mt-0.5">pb-[calc(12px+env(safe-area-inset-bottom))] confirmed</span>
                      <div className="mt-2 text-[10px] text-emerald-400 font-mono">Console Errors: 0 │ HTTP Status: 200 OK</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Code Mode Tool Composition */}
          {activeTab === 'code_mode' && (
            <div className="agentsam-tab-content p-4 space-y-4">
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-emerald-400">integration_instructions</span>
                    <h3 className="text-base font-bold text-white">Cloudflare Code Mode Tool Composition</h3>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs font-mono font-bold">
                    1 Model Turn vs 10 Round Trips
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                  Traditional agents trigger a separate model round-trip for every small tool call (search → read → read → grep → diff). Code Mode empowers the model to write a short TypeScript program that searches, filters, and reads in parallel in a single turn.
                </p>

                <div className="bg-zinc-950 border border-emerald-900/50 rounded-lg p-3">
                  <div className="flex items-center justify-between text-xs text-emerald-300 font-mono mb-2">
                    <span>Generated Code Mode Execution Script:</span>
                    <span>11 Files Inspected in Parallel</span>
                  </div>
                  <pre className="bg-zinc-900 p-3 rounded text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed border border-zinc-800">
{`const files = await tools.search("ChatComposer", { glob: "src/**/*.{tsx,css}" });
const relevant = files.filter(f => f.path.includes("composer") || f.path.includes("chatLayout"));

const contents = await Promise.all(
  relevant.slice(0, 11).map(f => tools.read(f.path))
);

return {
  inspectedFiles: relevant.map(r => r.path),
  rootCause: "Composer uses fixed bottom-0 without env(safe-area-inset-bottom) & lacks viewport dvh wrapper",
  affectedComponents: ["src/components/ChatComposer.tsx", "src/styles/chatLayout.css", "src/components/ComposerActions.tsx"]
};`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Network & Allowlist */}
          {activeTab === 'network' && (
            <div className="agentsam-tab-content network-policy-view">
              <div className="network-header-box">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-sky-400">shield_lock</span>
                  <h3 className="text-base font-semibold text-white">Sandbox Egress Firewall Policy</h3>
                </div>
                <p className="text-xs text-gray-400">
                  @cloudflare/computer & Antigravity enforce strict egress allowlists to prevent exfiltration while allowing package registries like <code>files.pythonhosted.org</code> (PyPI) and <code>registry.npmjs.org</code> (npm).
                </p>
              </div>

              <div className="allowlist-table-container">
                <table className="allowlist-table">
                  <thead>
                    <tr>
                      <th>Domain / Destination</th>
                      <th>Category</th>
                      <th>Policy Status</th>
                      <th>Resolved via</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backendConfig.allowlist.map((domain, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs text-sky-300 font-semibold">{domain}</td>
                        <td className="text-xs text-gray-300">
                          {domain.includes('pythonhosted') || domain.includes('pypi')
                            ? 'PyPI Official CDN & Package Mirror'
                            : domain.includes('npmjs')
                            ? 'Node Package Registry'
                            : domain.includes('github')
                            ? 'Git Repositories & Release Tarballs'
                            : domain.includes('googleapis')
                            ? 'Gemini & Google Cloud APIs'
                            : domain.includes('cloudflare')
                            ? 'Cloudflare Gateway & Workers AI'
                            : 'Allowed Runtime CDN'}
                        </td>
                        <td>
                          <span className="status-badge-allowed">ALLOW</span>
                        </td>
                        <td className="text-xs text-gray-400">Sandbox DNS Proxy</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Architecture & Report */}
          {activeTab === 'artifacts' && (
            <div className="agentsam-tab-content artifacts-view">
              <div className="report-summary-card">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-emerald-400">verified</span>
                  <h3 className="text-base font-bold text-white">{missionReport.title}</h3>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{missionReport.summary}</p>
              </div>

              {/* SVG Architecture Diagram */}
              <div className="architecture-svg-card">
                <div className="arch-svg-title">
                  <span className="material-symbols-outlined text-sm text-sky-400">account_tree</span>
                  <span>Execution Architecture & Autonomous Router</span>
                </div>
                <div
                  className="svg-render-box"
                  dangerouslySetInnerHTML={{ __html: missionReport.architectureSvg }}
                />
              </div>

              {/* Detected Issues */}
              <div className="issues-list-section">
                <h4 className="section-subtitle">
                  <span className="material-symbols-outlined text-sm text-red-400">error</span>
                  <span>Identified Anomalies & Root Causes ({missionReport.issuesFound.length})</span>
                </h4>
                <div className="issues-grid">
                  {missionReport.issuesFound.map((issue) => (
                    <div key={issue.id} className="issue-card">
                      <div className="issue-header">
                        <span className={`severity-tag ${issue.severity}`}>{issue.severity.toUpperCase()}</span>
                        <span className="issue-component">{issue.component}</span>
                        <span className="issue-file font-mono">{issue.file}:{issue.lines}</span>
                      </div>
                      <p className="issue-desc">{issue.description}</p>
                      <div className="issue-rec">
                        <strong>Fix:</strong> {issue.recommendation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Proposed Consolidation Sequence */}
              <div className="sequence-section">
                <h4 className="section-subtitle">
                  <span className="material-symbols-outlined text-sm text-emerald-400">checklist</span>
                  <span>Consolidation & Verification Sequence</span>
                </h4>
                <div className="sequence-list">
                  {missionReport.consolidationSequence.map((item) => (
                    <div key={item.step} className="sequence-item">
                      <div className="seq-number">{item.step}</div>
                      <div className="seq-content">
                        <div className="seq-title-row">
                          <span className="seq-title">{item.title}</span>
                          <span className={`risk-badge ${item.risk}`}>Risk: {item.risk}</span>
                        </div>
                        <p className="seq-detail">{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Benchmark Comparison */}
          {activeTab === 'benchmark' && (
            <div className="agentsam-tab-content benchmark-view">
              <div className="benchmark-header">
                <h3 className="text-base font-bold text-white mb-1">Execution Backends & Cost Breakdown</h3>
                <p className="text-xs text-gray-400">
                  Side-by-side comparison of @cloudflare/computer, Google Antigravity, Cloudflare Containers, and Local Mac.
                </p>
              </div>

              <div className="benchmark-grid">
                {(Object.keys(BACKEND_CONFIGS) as BackendType[]).map((key) => {
                  const cfg = BACKEND_CONFIGS[key];
                  const isCurrent = selectedBackend === key;

                  return (
                    <div key={key} className={`bench-card ${isCurrent ? 'selected' : ''}`}>
                      <div className="bench-card-header">
                        <div className="font-semibold text-sm text-white">{cfg.name}</div>
                        <div className="text-xs text-sky-400">{cfg.tagline}</div>
                      </div>

                      <div className="bench-specs-list">
                        <div className="spec-row">
                          <span className="spec-label">Compute Model</span>
                          <span className="spec-val font-mono">{cfg.cpu}</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Memory</span>
                          <span className="spec-val font-mono">{cfg.ram}</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Filesystem</span>
                          <span className="spec-val font-mono">{cfg.disk}</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Spin-Up Latency</span>
                          <span className="spec-val font-mono font-bold text-emerald-400">{cfg.provisionTimeMs}ms</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-label">Compute Cost/hr</span>
                          <span className="spec-val font-mono">${cfg.computeCostPerHour.toFixed(3)}</span>
                        </div>
                      </div>

                      <div className="bench-note">{cfg.freeTierNote}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Right Side: Telemetry & Live Stats */}
        <aside className="agentsam-sidebar-pane">
          {/* Live Telemetry Card */}
          <div className="telemetry-card">
            <div className="telemetry-card-title">
              <span className="material-symbols-outlined text-sm text-emerald-400">monitoring</span>
              <span>Mission Telemetry</span>
            </div>

            <div className="telemetry-stat-grid">
              <div className="telemetry-stat-box">
                <div className="stat-label">TOTAL TOKENS</div>
                <div className="stat-val">{telemetry.totalTokens.toLocaleString()}</div>
                <div className="stat-sub font-mono">
                  {telemetry.input.toLocaleString()} in / {(telemetry.output + telemetry.thinking).toLocaleString()} out
                </div>
              </div>

              <div className="telemetry-stat-box">
                <div className="stat-label">EXECUTION TIME</div>
                <div className="stat-val">{(telemetry.durationMs / 1000).toFixed(2)}s</div>
                <div className="stat-sub">{telemetry.toolCallsCount + telemetry.terminalCallsCount} actions</div>
              </div>

              <div className="telemetry-stat-box">
                <div className="stat-label">MODEL COST</div>
                <div className="stat-val text-emerald-400 font-mono">
                  ${telemetry.modelCost.toFixed(5)}
                </div>
                <div className="stat-sub">{currentModel.name.split(' ')[0]}</div>
              </div>

              <div className="telemetry-stat-box">
                <div className="stat-label">TOTAL MISSION COST</div>
                <div className="stat-val text-sky-400 font-mono">
                  ${telemetry.totalCost.toFixed(5)}
                </div>
                <div className="stat-sub">Model + Sandbox compute</div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Code Mode Round-Trips Saved:</span>
                <span className="font-mono font-bold text-emerald-400">{telemetry.roundTripsSavedTotal}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Worker Isolate Text Ops:</span>
                <span className="font-mono font-bold text-orange-400">{telemetry.workerIsolateOps}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Linux Container Userland Ops:</span>
                <span className="font-mono font-bold text-blue-400">{telemetry.containerOps}</span>
              </div>
            </div>
          </div>

          {/* Active Backend Details Card */}
          <div className="telemetry-card">
            <div className="telemetry-card-title">
              <span className="material-symbols-outlined text-sm text-sky-400">dns</span>
              <span>Active Runtime Specs</span>
            </div>

            <div className="runtime-spec-rows">
              <div className="runtime-row">
                <span className="r-label">Name:</span>
                <span className="r-val">{backendConfig.name}</span>
              </div>
              <div className="runtime-row">
                <span className="r-label">Engine:</span>
                <span className="r-val font-mono">{backendConfig.cpu}</span>
              </div>
              <div className="runtime-row">
                <span className="r-label">RAM:</span>
                <span className="r-val font-mono">{backendConfig.ram}</span>
              </div>
              <div className="runtime-row">
                <span className="r-label">Storage:</span>
                <span className="r-val font-mono">{backendConfig.disk}</span>
              </div>
              <div className="runtime-row">
                <span className="r-label">Firewall:</span>
                <span className="r-val text-sky-300">{backendConfig.networkPolicy}</span>
              </div>
            </div>
          </div>

          {/* Key Advantages Summary */}
          <div className="telemetry-card">
            <div className="telemetry-card-title">
              <span className="material-symbols-outlined text-sm text-amber-400">tips_and_updates</span>
              <span>Modern Cloudflare Stack</span>
            </div>
            <ul className="text-xs text-gray-400 space-y-1.5 pl-3 list-disc">
              <li><strong className="text-zinc-200">GLM-5.3 Flash:</strong> $0.15/M in, $0.50/M out (1/10th traditional cost).</li>
              <li><strong className="text-zinc-200">@cloudflare/computer:</strong> SQLite VFS + Worker Isolate + Lazy Linux.</li>
              <li><strong className="text-zinc-200">Code Mode:</strong> 10+ tool steps compressed into 1 programmatic AST turn.</li>
              <li><strong className="text-zinc-200">Kitesurf Browser:</strong> 3–7× less memory for instant accessibility trees.</li>
              <li><strong className="text-zinc-200">AI Gateway:</strong> Hard dollar spend limit enforcement.</li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
};
