import React, { useState, useEffect } from 'react';
import { IAMUser, Mission, ExecutionEvent, ApprovalRequest } from '../sdk/types';
import { MissionRuntime } from '../sdk/mission';
import { RepoIntelligenceView } from './intelligence/RepoIntelligenceView';
import { SelfHostingStudio } from './selfhosting/SelfHostingStudio';
import { ExecutionLedger } from './workbench/ExecutionLedger';
import { ApprovalGateModal } from './workbench/ApprovalGateModal';
import { CodeModeRunner } from './workbench/CodeModeRunner';
import { CodeWorkspace } from './workspace/CodeWorkspace';
import { BrowserShell } from './BrowserShell';
import { AppSettingsModal } from './AppSettingsModal';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../services/themeService';
import { MODEL_TIER_CONFIGS, ModelTier } from '../types/agentSam';
import { DEFAULT_RUNTIME_BINDINGS } from '../types/bindings';

interface WorkbenchAppProps {
  user: IAMUser;
  onLogout: () => void;
}

export type WorkbenchViewTab =
  | 'mission'
  | 'repository'
  | 'code'
  | 'browser'
  | 'self_hosting'
  | 'receipts'
  | 'settings';

export const WorkbenchApp: React.FC<WorkbenchAppProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<WorkbenchViewTab>('mission');
  const [selectedRepo, setSelectedRepo] = useState<string>('SamPrimeaux/inneranimalmedia');
  const [activeRef, setActiveRef] = useState<string>('main');
  const [selectedEnv, setSelectedEnv] = useState<string>('cf-computer');
  const [selectedModel, setSelectedModel] = useState<ModelTier>('glm_5_3_flash');
  
  // Mission & Event State
  const [missionInput, setMissionInput] = useState('Audit authentication overlap and eliminate duplicate authorities in src/legacy/authManager.ts');
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);

  // Settings modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    autoScrollOutput: true,
    fontFamily: 'Google Sans Flex, sans-serif',
    zoomLevel: 1,
    themeId: 'obsidian',
    soundEnabled: true,
    showLiveTokens: true,
    backgroundPattern: 'minimal',
    showWindowControls: true,
    customKeyBindings: {},
  });

  const [missionRuntime] = useState(() => new MissionRuntime());

  useEffect(() => {
    const unsub = missionRuntime.onEvent(event => {
      setEvents(prev => [...prev, event]);
    });
    return unsub;
  }, [missionRuntime]);

  const handleStartMission = async (customGoal?: any) => {
    setIsExecuting(true);
    setEvents([]);

    const goal = customGoal || {
      id: `msn_${Date.now()}`,
      title: missionInput,
      description: `Autonomous engineering refactoring on ${selectedRepo}`,
      targetRepo: selectedRepo,
      targetBranch: activeRef,
      workingBranch: `agentsam/refactor-${Math.random().toString(36).slice(2, 7)}`,
      isSelfHosting: selectedRepo.includes('agentsam-sdk'),
      priority: 'high' as const,
    };

    try {
      const result = await missionRuntime.run(goal, {
        environmentId: selectedEnv,
        modelTier: selectedModel,
      });
      setActiveMission(result);
    } catch (err: any) {
      console.error('Mission execution failed:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleStartFromIntelligenceSignal = (title: string, recommendation: string) => {
    setMissionInput(`${title}: ${recommendation}`);
    setActiveTab('mission');
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0c0e12] text-zinc-100 font-sans select-none overflow-hidden">
      {/* 1. Top Workbench Header */}
      <header className="h-12 min-h-[48px] bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-4 gap-4 z-40 shrink-0">
        {/* Left: Brand Identity & Active Repository Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <span className="material-symbols-outlined text-base">terminal</span>
            </div>
            <span className="font-bold text-sm tracking-tight text-white">Agent Sam Workbench</span>
          </div>

          <span className="text-zinc-700">/</span>

          {/* Repository Switcher Dropdown */}
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
            <span className="material-symbols-outlined text-zinc-400 text-sm">folder_open</span>
            <select
              value={selectedRepo}
              onChange={e => {
                setSelectedRepo(e.target.value);
                if (e.target.value === 'SamPrimeaux/agentsam-sdk') {
                  setActiveTab('self_hosting');
                }
              }}
              className="bg-transparent text-zinc-200 font-mono font-medium focus:outline-none cursor-pointer"
            >
              <option value="SamPrimeaux/inneranimalmedia">SamPrimeaux/inneranimalmedia</option>
              <option value="SamPrimeaux/agentsam-sdk">SamPrimeaux/agentsam-sdk (Self-Hosting)</option>
            </select>
          </div>

          {/* Branch Ref Badge */}
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 hidden sm:inline-block">
            git:{activeRef}
          </span>
        </div>

        {/* Center: Primary View Tabs */}
        <nav className="hidden md:flex items-center bg-zinc-900 border border-zinc-800 p-1 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('mission')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'mission' ? 'bg-sky-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="material-symbols-outlined text-sm">flag</span>
            <span>Mission</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('repository')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'repository' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-amber-400">insights</span>
            <span>Intelligence</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('code')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'code' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-sky-400">code</span>
            <span>Code</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('browser')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'browser' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-emerald-400">devices</span>
            <span>Browser</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('self_hosting')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'self_hosting' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-indigo-300">psychology</span>
            <span>Self-Hosting</span>
            <span className="text-[9px] px-1 py-0.2 rounded bg-white/20 font-bold">SDK</span>
          </button>
        </nav>

        {/* Right: Environment, Model, User Profile & Settings */}
        <div className="flex items-center gap-3">
          {/* Execution Environment Selector */}
          <div className="hidden lg:flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
            <span className="material-symbols-outlined text-emerald-400 text-sm">memory</span>
            <select
              value={selectedEnv}
              onChange={e => setSelectedEnv(e.target.value)}
              className="bg-transparent text-zinc-300 font-mono text-[11px] focus:outline-none cursor-pointer"
            >
              <option value="cf-computer">@cloudflare/computer</option>
              <option value="cf-container">Cloudflare Container</option>
              <option value="antigravity">Google AntiGravity</option>
              <option value="local">Local PTY</option>
            </select>
          </div>

          {/* Settings Trigger */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg border border-zinc-800 transition-colors"
            title="Settings & Runtime Bindings"
          >
            <span className="material-symbols-outlined text-lg">settings</span>
          </button>

          {/* User Profile & Logout */}
          <div className="flex items-center gap-2 pl-2 border-l border-zinc-800">
            <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 overflow-hidden flex items-center justify-center text-xs font-bold text-zinc-300">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                user.name.charAt(0)
              )}
            </div>
            <div className="hidden xl:block text-left text-xs leading-none">
              <span className="font-semibold text-zinc-200 block">{user.name}</span>
              <span className="text-[10px] text-zinc-500 font-mono">{user.companyName}</span>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Sign Out"
            >
              <span className="material-symbols-outlined text-base">logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Viewport Content Canvas */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {/* TAB 1: Mission Center */}
        {activeTab === 'mission' && (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* Left Column: Mission Definition & Execution Stream */}
            <div className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto border-r border-zinc-800/80">
              {/* Mission Input Launcher */}
              <div className="p-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl space-y-4 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sky-400 text-lg">flag</span>
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Engineering Mission</h2>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">Target: {selectedRepo}</span>
                </div>

                <div className="space-y-2">
                  <textarea
                    value={missionInput}
                    onChange={e => setMissionInput(e.target.value)}
                    rows={2}
                    placeholder="Describe the refactoring, bug fix, or feature mission for Agent Sam..."
                    className="w-full p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 transition-all font-sans"
                  />

                  {/* Preset Mission Quick Chips */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="text-[11px] text-zinc-500 self-center">Presets:</span>
                    <button
                      type="button"
                      onClick={() => setMissionInput('Finish the InnerAnimalMedia src/ legacy retirement and consolidate auth on SDK')}
                      className="px-2.5 py-1 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs transition-colors"
                    >
                      Auth Authority Consolidation
                    </button>
                    <button
                      type="button"
                      onClick={() => setMissionInput('Repair mobile chat composer safe-area insets and verify in Browser Run')}
                      className="px-2.5 py-1 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs transition-colors"
                    >
                      ChatComposer iOS Insets
                    </button>
                    <button
                      type="button"
                      onClick={() => setMissionInput('Inspect agentsam-sdk repository inspector and optimize Git churn filter')}
                      className="px-2.5 py-1 bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs transition-colors"
                    >
                      Self-Host SDK Optimization
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
                  <div className="flex items-center gap-4 text-xs text-zinc-400">
                    <div className="flex items-center gap-1.5">
                      <span>Model:</span>
                      <strong className="text-sky-400 font-mono">{MODEL_TIER_CONFIGS[selectedModel].name}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStartMission()}
                    disabled={isExecuting || !missionInput.trim()}
                    className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-sky-600/25 flex items-center gap-2"
                  >
                    {isExecuting ? (
                      <>
                        <span className="animate-spin material-symbols-outlined text-sm">progress_activity</span>
                        <span>Executing Mission Loop...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-base">play_arrow</span>
                        <span>Launch Mission</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Real Live Execution Ledger */}
              <div className="space-y-4">
                <ExecutionLedger events={events} isStreaming={isExecuting} />
              </div>

              {/* Code Mode Composition Component */}
              <CodeModeRunner />
            </div>

            {/* Right Column: Mission Plan & Artifact Overview */}
            <div className="w-full lg:w-96 bg-zinc-950 p-6 space-y-6 overflow-y-auto">
              {/* Mission Plan Status */}
              <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Mission Lifecycle</h3>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase font-bold ${
                    activeMission?.state === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : isExecuting
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {activeMission?.state || (isExecuting ? 'executing' : 'idle')}
                  </span>
                </div>

                <div className="space-y-2">
                  {(activeMission?.plan || [
                    { id: '1', title: 'Inspect target repository & module boundaries', status: 'pending' },
                    { id: '2', title: 'Formulate precise refactoring strategy', status: 'pending' },
                    { id: '3', title: 'Apply code edits to workspace branch', status: 'pending' },
                    { id: '4', title: 'Run TypeScript typecheck and Vitest suite', status: 'pending' },
                    { id: '5', title: 'Verify responsive behavior in Browser Run', status: 'pending' },
                    { id: '6', title: 'Compile reviewable Evolution Report & diff', status: 'pending' },
                  ]).map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <span className="material-symbols-outlined text-sm text-zinc-500 mt-0.5">
                        {step.status === 'completed' ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                      <span className={step.status === 'completed' ? 'text-zinc-300 line-through' : 'text-zinc-400'}>
                        {step.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Telemetry / Cost Visible */}
              {activeMission && (
                <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3 font-mono text-xs">
                  <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider font-sans">Run Telemetry</h3>
                  <div className="space-y-1.5 text-zinc-300">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Tokens Input:</span>
                      <span>{activeMission.totalTokens.input.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Tokens Output:</span>
                      <span>{activeMission.totalTokens.output.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Tool Calls:</span>
                      <span className="text-sky-400 font-bold">{activeMission.toolCallCount}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-zinc-800">
                      <span className="text-zinc-500">Estimated Cost:</span>
                      <span className="text-emerald-400 font-bold">${activeMission.totalCostUsd.toFixed(4)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Repository & Intelligence */}
        {activeTab === 'repository' && (
          <RepoIntelligenceView
            repoName={selectedRepo}
            onStartMissionForSignal={handleStartFromIntelligenceSignal}
          />
        )}

        {/* TAB 3: Monaco Code Workspace */}
        {activeTab === 'code' && (
          <div className="flex-1 min-h-0">
            <CodeWorkspace bindings={DEFAULT_RUNTIME_BINDINGS} />
          </div>
        )}

        {/* TAB 4: Browser Verifier */}
        {activeTab === 'browser' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <BrowserShell
              title="Browser Run Verifier"
              onClose={() => setActiveTab('mission')}
            />
          </div>
        )}

        {/* TAB 5: Self-Hosting Studio */}
        {activeTab === 'self_hosting' && (
          <SelfHostingStudio
            activeMission={activeMission}
            onStartMission={(goal) => {
              setSelectedRepo('SamPrimeaux/agentsam-sdk');
              handleStartMission(goal);
              setActiveTab('mission');
            }}
          />
        )}
      </main>

      {/* Safety Approval Gate Modal */}
      <ApprovalGateModal
        request={pendingApproval}
        onApprove={(id) => setPendingApproval(null)}
        onReject={(id) => setPendingApproval(null)}
      />

      {/* App Settings Modal */}
      <AppSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={setSettings}
        onResetSettings={() => setSettings(DEFAULT_APP_SETTINGS)}
      />
    </div>
  );
};
