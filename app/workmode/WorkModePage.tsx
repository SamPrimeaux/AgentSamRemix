/**
 * Agent Sam Work Mode — integrated product surface (/dashboard/workmode).
 * Ports the AgentSamWorkMode-Prototype UI with bridges to Remix shell APIs.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../src/context/WorkspaceContext';
import {
  AppMode,
  FlexLayoutMode,
  ModelChoice,
  WorkSubTab,
  ChatMessageItem,
  PresentationDeck,
  ClientWebsiteData,
  DashboardMetric,
  BrandKitData,
  CollaboratorAgent,
} from './types';
import {
  getDynamicMessages,
  getDynamicPresentation,
  getDynamicClientWebsite,
  getDynamicDashboardMetrics,
  getDynamicBrandKit,
  getDynamicCollaborators,
} from './data/mockWorkspace';
import { executeAgentSamTask } from './services/workModeAgentEngine';
import { WorkModeConfigProvider, useWorkModeConfig } from './context/WorkModeConfigContext';
import { Sidebar } from './components/navigation/Sidebar';
import { AppSidebar } from './components/navigation/AppSidebar';
import { MobileStatusBar } from './components/MobileStatusBar';
import { NavigationHeader } from './components/NavigationHeader';
import { ChatView } from './components/ChatView';
import { WorkModeView } from './components/WorkModeView';
import { TerminalDrawer } from './components/TerminalDrawer';
import { PresentationModal } from './components/PresentationModal';
import { cn } from '../lib/utils';
import { Smartphone, Columns } from 'lucide-react';
import { useWorkModeShellBridge } from './hooks/useWorkModeShellBridge';
import { useWorkModeGitBridge } from './hooks/useWorkModeGitBridge';
import { useWorkModeTelemetryBridge } from './hooks/useWorkModeTelemetryBridge';
import type { TelemetryData } from './lib/telemetry';

function WorkModeInner() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { config, setActiveBranch: setConfigBranch, setActivePath: setConfigPath } = useWorkModeConfig();
  const { openShellTerminal, runInShellTerminal } = useWorkModeShellBridge();
  const { activeBranch: liveBranch, setActiveBranch: setLiveBranch, liveGit, refreshGit } =
    useWorkModeGitBridge(workspaceId);

  const [mode, setMode] = useState<AppMode>('work');
  const [workSubTab, setWorkSubTab] = useState<WorkSubTab>('workbench');
  const [layoutMode, setLayoutMode] = useState<FlexLayoutMode>('single');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme');
      if (stored) return stored === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isPresentationOpen, setIsPresentationOpen] = useState(false);

  const [selectedModel, setSelectedModel] = useState<ModelChoice>(config.defaultModel);
  const [activeBranch, setActiveBranchState] = useState<string>(config.defaultBranch);
  const [activePath, setActivePathState] = useState<string>(config.defaultPath);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (liveBranch && liveGit) {
      setActiveBranchState(liveBranch);
      setConfigBranch(liveBranch);
    }
  }, [liveBranch, liveGit, setConfigBranch]);

  const handleBranchChange = (newBranch: string) => {
    setActiveBranchState(newBranch);
    setConfigBranch(newBranch);
    setLiveBranch(newBranch);
  };

  const handlePathChange = (newPath: string) => {
    setActivePathState(newPath);
    setConfigPath(newPath);
  };

  const [messages, setMessages] = useState<ChatMessageItem[]>(() => getDynamicMessages(config));
  const [deck, setDeck] = useState<PresentationDeck>(() => getDynamicPresentation(config));
  const [website, setWebsite] = useState<ClientWebsiteData>(() => getDynamicClientWebsite(config));
  const [metrics, setMetrics] = useState<DashboardMetric[]>(() => getDynamicDashboardMetrics(config));
  const [brandKit, setBrandKit] = useState<BrandKitData>(() => getDynamicBrandKit(config));
  const [collaborators, setCollaborators] = useState<CollaboratorAgent[]>(() =>
    getDynamicCollaborators(config),
  );
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [localTelemetry, setLocalTelemetry] = useState<TelemetryData[]>([]);
  const telemetryLogs = useWorkModeTelemetryBridge(localTelemetry);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
      try {
        localStorage.setItem('theme', 'dark');
      } catch {
        /* ignore */
      }
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
      try {
        localStorage.setItem('theme', 'light');
      } catch {
        /* ignore */
      }
    }
  }, [isDarkMode]);

  const handleOpenTerminal = useCallback(() => {
    setIsTerminalOpen(true);
    openShellTerminal();
  }, [openShellTerminal]);

  const handleSendMessage = async (text: string, model: ModelChoice) => {
    const userMsg: ChatMessageItem = {
      id: 'msg-' + Date.now(),
      role: 'user',
      authorName: config.developerName,
      authorInitials: config.developerInitials,
      authorAvatarBg: 'bg-blue-600 text-white',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    try {
      const result = await executeAgentSamTask(text, model, {
        currentSlides: deck.slides,
        currentWebsite: website,
        activeBranch,
      });

      if (result.newSlides) {
        setDeck((prev) => ({ ...prev, slides: [...prev.slides, ...result.newSlides!] }));
      }
      if (result.websiteUpdates) {
        setWebsite((prev) => ({ ...prev, ...result.websiteUpdates }));
      }
      if (result.newImage) {
        setBrandKit((prev) => ({
          ...prev,
          generatedImages: [result.newImage!, ...prev.generatedImages],
        }));
      }
      if (result.newVideo) {
        setBrandKit((prev) => ({
          ...prev,
          generatedVideos: [result.newVideo!, ...prev.generatedVideos],
        }));
      }
      if (result.terminalLogs?.length) {
        setTerminalLogs(result.terminalLogs);
        const cmd = result.terminalLogs.find((l) => !l.startsWith('$') && !l.startsWith('>'));
        if (cmd) runInShellTerminal(cmd);
      }
      if (result.telemetry) {
        setLocalTelemetry((prev) => [...prev, result.telemetry!]);
      }

      if (text.toLowerCase().includes('git') || text.toLowerCase().includes('status')) {
        void refreshGit();
      }

      const agentMsg: ChatMessageItem = {
        id: 'msg-' + (Date.now() + 1),
        role: 'agent',
        authorName: config.agentName,
        authorInitials: config.agentInitials,
        authorAvatarBg: 'bg-zinc-900 dark:bg-emerald-600 text-white',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: result.text,
        taskTrace: result.trace,
        reactions: ['thumbs-up', 'smile', 'clipboard'],
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [
        ...prev,
        {
          id: 'msg-' + (Date.now() + 1),
          role: 'agent',
          authorName: config.agentName,
          authorInitials: config.agentInitials,
          authorAvatarBg: 'bg-zinc-900 dark:bg-emerald-600 text-white',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: `Encountered an execution exception: ${message}. Open the shell terminal for live output.`,
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunTestAgain = () => {
    handleSendMessage('npm test -- auth', selectedModel);
  };

  const handleQuickAction = () => {
    navigate('/dashboard/agent/new');
  };

  return (
    <div
      className={cn(
        'relative w-full h-full min-h-0 flex flex-col transition-colors duration-200 font-sans antialiased overflow-hidden',
        isDarkMode ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-100 text-zinc-900',
      )}
    >
      <aside
        aria-label="Layout controls"
        className="hidden 2xl:flex absolute top-3 right-6 z-50 items-center gap-2 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 shadow-xl text-xs font-medium"
      >
        <button
          type="button"
          onClick={() => setLayoutMode(layoutMode === 'split' ? 'single' : 'split')}
          className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
        >
          <Columns size={13} />
          <span>{layoutMode === 'split' ? 'Split FlexFit' : 'Single Pane'}</span>
        </button>
        <span className="text-zinc-300 dark:text-zinc-700">|</span>
        <button
          type="button"
          onClick={() => setLayoutMode(layoutMode === 'phone' ? 'split' : 'phone')}
          className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
        >
          <Smartphone size={13} />
          <span>{layoutMode === 'phone' ? 'Exit Frame' : 'Phone Frame'}</span>
        </button>
      </aside>

      <main
        className={cn(
          'relative w-full flex-1 min-h-0 flex flex-col overflow-hidden transition-all duration-300',
          layoutMode === 'phone'
            ? 'max-w-[430px] mx-auto my-2 rounded-[44px] border-[10px] border-zinc-900 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl'
            : 'bg-white dark:bg-zinc-950',
        )}
      >
        {layoutMode === 'phone' && <MobileStatusBar darkMode={isDarkMode} />}

        <NavigationHeader
          mode={mode}
          onModeChange={setMode}
          workSubTab={workSubTab}
          onWorkSubTabChange={setWorkSubTab}
          onQuickAction={handleQuickAction}
          onOpenTerminal={handleOpenTerminal}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          activeBranch={activeBranch}
          activePath={activePath}
        />

        <div className="flex-1 flex min-h-0 relative overflow-hidden">
          <AppSidebar
            currentMode={mode}
            onModeChange={setMode}
            currentWorkSubTab={workSubTab}
            onWorkSubTabChange={setWorkSubTab}
            onOpenTerminal={handleOpenTerminal}
            isDarkMode={isDarkMode}
            onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
            activePath={activePath}
            activeBranch={activeBranch}
            onBranchChange={handleBranchChange}
            onSelectPreset={(prompt) => handleSendMessage(prompt, selectedModel)}
          />

          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {layoutMode === 'split' ? (
              <div className="flex-1 flex w-full h-full min-h-0 overflow-hidden">
                <section
                  aria-label="Agent Chat Conversation Pane"
                  className={cn(
                    'flex-col h-full overflow-hidden bg-white dark:bg-zinc-950 border-r border-zinc-200/80 dark:border-zinc-800/80 transition-all',
                    'w-full lg:w-[400px] xl:w-[440px] 2xl:w-[480px] shrink-0',
                    mode === 'work' ? 'hidden lg:flex' : 'flex',
                  )}
                >
                  <ChatView
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    isProcessing={isProcessing}
                    selectedModel={selectedModel}
                    onSelectModel={setSelectedModel}
                    onOpenTerminal={handleOpenTerminal}
                    onNavigateToWork={() => setMode('work')}
                    activeBranch={activeBranch}
                    activePath={activePath}
                    onBranchChange={handleBranchChange}
                    onPathChange={handlePathChange}
                  />
                </section>

                <section
                  aria-label="Work Mode Production Studio Pane"
                  className={cn(
                    'flex-1 flex-col h-full min-w-0 overflow-hidden bg-zinc-50/50 dark:bg-black transition-all',
                    mode === 'chat' ? 'hidden lg:flex' : 'flex',
                  )}
                >
                  <WorkModeView
                    subTab={workSubTab}
                    onSubTabChange={setWorkSubTab}
                    deck={deck}
                    onUpdateDeck={setDeck}
                    website={website}
                    onUpdateWebsite={setWebsite}
                    metrics={metrics}
                    brandKit={brandKit}
                    onUpdateBrandKit={setBrandKit}
                    collaborators={collaborators}
                    telemetryLogs={telemetryLogs}
                    onPresentDeck={() => setIsPresentationOpen(true)}
                    onOpenTerminal={handleOpenTerminal}
                    onDispatchAgentMessage={(msg) => handleSendMessage(msg, selectedModel)}
                  />
                </section>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden w-full h-full">
                {mode === 'chat' ? (
                  <ChatView
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    isProcessing={isProcessing}
                    selectedModel={selectedModel}
                    onSelectModel={setSelectedModel}
                    onOpenTerminal={handleOpenTerminal}
                    onNavigateToWork={() => setMode('work')}
                    activeBranch={activeBranch}
                    activePath={activePath}
                    onBranchChange={handleBranchChange}
                    onPathChange={handlePathChange}
                  />
                ) : (
                  <WorkModeView
                    subTab={workSubTab}
                    onSubTabChange={setWorkSubTab}
                    deck={deck}
                    onUpdateDeck={setDeck}
                    website={website}
                    onUpdateWebsite={setWebsite}
                    metrics={metrics}
                    brandKit={brandKit}
                    onUpdateBrandKit={setBrandKit}
                    collaborators={collaborators}
                    telemetryLogs={telemetryLogs}
                    onPresentDeck={() => setIsPresentationOpen(true)}
                    onOpenTerminal={handleOpenTerminal}
                    onDispatchAgentMessage={(msg) => handleSendMessage(msg, selectedModel)}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <TerminalDrawer
        isOpen={isTerminalOpen}
        onClose={() => setIsTerminalOpen(false)}
        onOpen={() => setIsTerminalOpen(true)}
        onRunTestAgain={handleRunTestAgain}
        activeBranch={activeBranch}
        activePath={activePath}
        customLogs={terminalLogs}
      />

      <PresentationModal
        isOpen={isPresentationOpen}
        onClose={() => setIsPresentationOpen(false)}
        deck={deck}
      />
    </div>
  );
}

export default function WorkModePage() {
  return (
    <WorkModeConfigProvider>
      <Sidebar.Provider defaultCollapsed={false}>
        <WorkModeInner />
      </Sidebar.Provider>
    </WorkModeConfigProvider>
  );
}
