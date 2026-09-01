import React, { useState } from 'react';
import { 
  WorkbenchWorkspace, 
  WorkbenchPullRequest, 
  WorkbenchViewLevel,
  PwaCacheStatus,
  ExecOsLocalLaneStatus,
  ModelChoice
} from '../../types';
import { 
  INITIAL_WORKBENCH_WORKSPACES, 
  INITIAL_PWA_CACHE_STATUS,
  INITIAL_EXECOS_STATUS 
} from '../../data/mockWorkbench';
import { WorkbenchDiffSheet } from './WorkbenchDiffSheet';
import { PwaCacheInspectorSheet } from './PwaCacheInspectorSheet';
import { ExecOsLocalLaneSheet } from './ExecOsLocalLaneSheet';
import { FlexFitComposer } from './FlexFitComposer';
import { AgentComputerSurface } from '../browser/AgentComputerSurface';
import { 
  X, 
  Layers, 
  Cpu, 
  Globe, 
  Terminal, 
  Plus, 
  Share2, 
  PanelRight, 
  PanelLeft, 
  ChevronRight, 
  ChevronDown, 
  ThumbsUp, 
  ThumbsDown, 
  Copy, 
  RotateCcw, 
  Volume2, 
  MoreHorizontal, 
  FileCode, 
  ExternalLink, 
  Check, 
  CheckCircle2, 
  AlertCircle,
  Paperclip,
  Sparkles,
  Bot
} from 'lucide-react';
import { useSidebar } from '../navigation/Sidebar';
import { cn } from '../../../lib/utils';

interface WorkMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  executionTime?: string;
  statusLines?: string[];
  validationLines?: string[];
  conclusion?: string;
}

interface AgentSamWorkModeProps {
  onDispatchAgentMessage: (message: string) => void;
  onOpenTerminal?: () => void;
}

export const AgentSamWorkMode: React.FC<AgentSamWorkModeProps> = ({
  onDispatchAgentMessage,
  onOpenTerminal
}) => {
  const { toggleSidebar, isCollapsed } = useSidebar();
  
  // Inspector Drawer State
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isTraceExpanded, setIsTraceExpanded] = useState(false);
  const [repoTitle, setRepoTitle] = useState('Create AgentSamWorkMode repo');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [dislikedMap, setDislikedMap] = useState<Record<string, boolean>>({});

  // Sheet Overlays State
  const [isDiffSheetOpen, setIsDiffSheetOpen] = useState(false);
  const [isCacheInspectorOpen, setIsCacheInspectorOpen] = useState(false);
  const [isExecOsSheetOpen, setIsExecOsSheetOpen] = useState(false);
  const [isAgentComputerOpen, setIsAgentComputerOpen] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<PwaCacheStatus>(INITIAL_PWA_CACHE_STATUS);
  const [execOsStatus, setExecOsStatus] = useState<ExecOsLocalLaneStatus>(INITIAL_EXECOS_STATUS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelChoice>('gemini-3.5-flash');

  // Work Mode Messages Thread (preloaded with sample conversation from reference screenshot)
  const [messages, setMessages] = useState<WorkMessage[]>([
    {
      id: 'msg-1',
      role: 'user',
      content: 'can you inspect our inneranimalmedia-mcp-server and see if its up to date/not drifting?',
      timestamp: 'Just now'
    },
    {
      id: 'msg-2',
      role: 'agent',
      content: 'The inneranimalmedia-mcp-server checkout is clean and synchronized with its remote feature branch, but it is not fully aligned with main.',
      timestamp: 'Just now',
      executionTime: 'Worked for 29s',
      statusLines: [
        'Branch: fix/terminal-operator-policy',
        'Working tree: clean',
        'Remote tracking: exact match, 0 ahead / 0 behind',
        'Compared with origin/main: 2 commits ahead',
        'Main currently points to e4233c5; this branch points to f04166f',
        'No untracked or uncommitted files'
      ],
      validationLines: [
        'Catalog smoke checks: passed',
        'Full test suite: failed in 2 tests:',
        '  • index.js dispatch ratchet',
        '  • agentsam_memory_search schema',
        'Failures indicate test/code drift:',
        '  • dispatch implementation still contains logAgentsamMcpToolExecution where the ratchet expects it removed',
        '  • memory-search description no longer matches the expected canonical wording'
      ],
      conclusion: 'The branch is internally clean and remote-synchronized, but has drifted from canonical main tests. Dispatch ratchets and memory-search schema require alignment.'
    }
  ]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleLike = (id: string) => {
    setLikedMap((prev) => ({ ...prev, [id]: !prev[id] }));
    if (dislikedMap[id]) {
      setDislikedMap((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleToggleDislike = (id: string) => {
    setDislikedMap((prev) => ({ ...prev, [id]: !prev[id] }));
    if (likedMap[id]) {
      setLikedMap((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleComposerSubmit = (text: string, model?: ModelChoice) => {
    const userMsg: WorkMessage = {
      id: 'msg-' + Date.now(),
      role: 'user',
      content: text,
      timestamp: 'Just now'
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);

    // Dispatch to parent agent engine
    onDispatchAgentMessage(text);

    // Simulate real-time agent output in work thread
    setTimeout(() => {
      const agentMsg: WorkMessage = {
        id: 'msg-' + (Date.now() + 1),
        role: 'agent',
        content: `Executed operation for "${text.slice(0, 48)}...". All local execution lanes and MCP tools inspected successfully.`,
        timestamp: 'Just now',
        executionTime: 'Worked for 14s',
        statusLines: [
          `Target: ${repoTitle}`,
          `Model: ${model || selectedModel}`,
          `Runtime: Port ${execOsStatus.daemonPort || 3099} (Local Lane Active)`,
          'State: Synchronized & Verified'
        ],
        conclusion: 'Ready for next instruction or deployment.'
      };
      setMessages((prev) => [...prev, agentMsg]);
      setIsProcessing(false);
    }, 1200);
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#121214] text-zinc-100 selection:bg-purple-500/30 overflow-hidden font-sans">
      
      {/* 1. Sleek Top Bar (Mac window dots, Repo Title, Share & Inspector Drawer Toggle) */}
      <header className="w-full px-3 sm:px-6 py-2.5 sm:py-3 border-b border-zinc-800/80 bg-[#18181b]/95 backdrop-blur-md flex items-center justify-between z-20 shrink-0 min-h-[52px]">
        {/* Left Side: Window dots + Sidebar Toggle + Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Sidebar Toggle Button */}
          <button
            onClick={toggleSidebar}
            title={isCollapsed ? "Expand Sidebar (⌘B)" : "Collapse Sidebar (⌘B)"}
            aria-label="Toggle App Sidebar"
            className={cn(
              "min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 touch-manipulation",
              isCollapsed 
                ? "text-purple-400 bg-purple-500/10 hover:bg-purple-500/20" 
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            )}
          >
            <PanelLeft size={18} />
          </button>

          {/* Repo / Task Title */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="text-xs sm:text-sm font-semibold text-zinc-200 truncate">
              {repoTitle}
            </span>
            <button 
              onClick={() => {
                const newTitle = prompt('Rename Work Mode Project:', repoTitle);
                if (newTitle) setRepoTitle(newTitle);
              }}
              title="Edit Title"
              aria-label="Rename Project"
              className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded-lg active:scale-95"
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
        </div>

        {/* Right Side: Share + Terminal + Inspector Drawer Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Share Button */}
          <button
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
                alert('Project share link copied to clipboard!');
              }
            }}
            className="flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-all active:scale-95 shadow-xs cursor-pointer touch-manipulation"
          >
            <Share2 size={14} className="text-zinc-400" />
            <span className="hidden sm:inline">Share</span>
          </button>

          {/* Agent Computer / Browser Trigger */}
          <button
            onClick={() => setIsAgentComputerOpen(true)}
            title="Open Agent Computer & Live Browser Runtime"
            aria-label="Open Agent Computer"
            className="flex items-center gap-1.5 min-h-[44px] px-3 sm:px-3.5 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-semibold transition-all active:scale-95 shadow-xs cursor-pointer touch-manipulation"
          >
            <Globe size={14} className="text-purple-400" />
            <span className="hidden sm:inline">Agent Computer</span>
          </button>

          {/* Terminal Trigger */}
          {onOpenTerminal && (
            <button
              onClick={onOpenTerminal}
              title="Open Terminal Drawer"
              aria-label="Open Terminal Drawer"
              className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-emerald-400 transition-all text-xs font-mono flex items-center justify-center active:scale-95 cursor-pointer touch-manipulation"
            >
              <Terminal size={16} />
            </button>
          )}

          {/* Inspector Toggle Button */}
          <button
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            title={isInspectorOpen ? "Hide Sources & Outputs Panel" : "Show Sources & Outputs Panel"}
            aria-label="Toggle Inspector Panel"
            className={cn(
              "min-w-[44px] min-h-[44px] w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-95 cursor-pointer touch-manipulation",
              isInspectorOpen 
                ? "bg-purple-600/20 text-purple-300 border border-purple-500/30" 
                : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
            )}
          >
            <PanelRight size={18} />
          </button>
        </div>
      </header>

      {/* 2. Main Work Mode Canvas Area */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        
        {/* Main Conversation & Execution Stream */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto relative no-scrollbar">
          <div className="w-full max-w-3xl sm:max-w-4xl mx-auto px-4 sm:px-8 pt-6 pb-36 space-y-6 flex-1 flex flex-col">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';

              if (isUser) {
                return (
                  <div key={msg.id} className="flex justify-end w-full animate-in fade-in slide-in-from-bottom-2 duration-150">
                    <div className="max-w-[85%] sm:max-w-[75%] bg-[#523d85]/90 text-white rounded-[24px] rounded-tr-md px-5 py-3.5 shadow-lg border border-purple-400/20 text-[14px] leading-relaxed font-sans">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="flex flex-col items-start w-full space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
                  {/* Elapsed Execution Badge Accordion */}
                  {msg.executionTime && (
                    <button
                      type="button"
                      onClick={() => setIsTraceExpanded(!isTraceExpanded)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 border border-zinc-700/60 text-xs font-mono transition-all"
                    >
                      <Sparkles size={12} className="text-purple-400" />
                      <span>{msg.executionTime}</span>
                      <ChevronRight 
                        size={12} 
                        className={cn("text-zinc-400 transition-transform duration-200", isTraceExpanded && "rotate-90")} 
                      />
                    </button>
                  )}

                  {/* Expandable Step Trace Logs if toggled */}
                  {isTraceExpanded && (
                    <div className="w-full p-3.5 rounded-2xl bg-black/60 border border-zinc-800 font-mono text-xs text-zinc-400 space-y-1 animate-in fade-in duration-150">
                      <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Execution Trace Steps</div>
                      <div className="text-emerald-400">[OK] git status --porcelain → Working tree clean</div>
                      <div className="text-emerald-400">[OK] git rev-parse --abbrev-ref HEAD → fix/terminal-operator-policy</div>
                      <div className="text-emerald-400">[OK] git fetch origin main --quiet → Synchronized</div>
                      <div className="text-amber-400">[Warning] npm test → 2 assertions failed in dispatch ratchet</div>
                    </div>
                  )}

                  {/* Main Structured Message Output */}
                  <div className="w-full space-y-4 text-[14px] leading-relaxed text-zinc-200">
                    <p className="text-zinc-200 leading-normal">
                      {msg.content}
                    </p>

                    {/* Status Section */}
                    {msg.statusLines && msg.statusLines.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="font-semibold text-zinc-100 text-sm">Status:</div>
                        <ul className="space-y-1 pl-1">
                          {msg.statusLines.map((line, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-zinc-300 text-xs sm:text-sm">
                              <span className="text-zinc-500 select-none">•</span>
                              <span className="font-mono bg-zinc-800/60 px-2 py-0.5 rounded-md border border-zinc-700/40 text-zinc-200">
                                {line}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Validation Section */}
                    {msg.validationLines && msg.validationLines.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="font-semibold text-zinc-100 text-sm">Validation:</div>
                        <div className="space-y-1 pl-1">
                          {msg.validationLines.map((line, idx) => (
                            <div key={idx} className="text-xs sm:text-sm font-mono text-zinc-300 flex items-start gap-2">
                              <span className="text-zinc-500 select-none">•</span>
                              <span>{line}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Conclusion Paragraph */}
                    {msg.conclusion && (
                      <div className="pt-2 text-zinc-300 text-xs sm:text-sm leading-relaxed border-t border-zinc-800/80">
                        <span className="font-semibold text-zinc-100">Conclusion: </span>
                        {msg.conclusion}
                      </div>
                    )}
                  </div>

                  {/* Message Action Footer Bar */}
                  <div className="flex items-center gap-1 pt-1 text-zinc-400">
                    <button
                      onClick={() => handleToggleLike(msg.id)}
                      title="Good response"
                      className={cn(
                        "p-1.5 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors",
                        likedMap[msg.id] && "text-emerald-400 bg-emerald-500/10"
                      )}
                    >
                      <ThumbsUp size={14} />
                    </button>
                    <button
                      onClick={() => handleToggleDislike(msg.id)}
                      title="Bad response"
                      className={cn(
                        "p-1.5 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors",
                        dislikedMap[msg.id] && "text-rose-400 bg-rose-500/10"
                      )}
                    >
                      <ThumbsDown size={14} />
                    </button>
                    <button
                      onClick={() => handleCopy(msg.id, msg.content + (msg.conclusion ? '\n\n' + msg.conclusion : ''))}
                      title="Copy message content"
                      className="p-1.5 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                      {copiedId === msg.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={() => handleComposerSubmit("Please re-run analysis and inspect drift again.")}
                      title="Retry / Regenerate"
                      className="p-1.5 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => {
                        const utterance = new SpeechSynthesisUtterance(msg.content);
                        window.speechSynthesis.speak(utterance);
                      }}
                      title="Read aloud"
                      className="p-1.5 rounded-lg hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                      <Volume2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Floating / Docked Inspector Card ("Outputs" & "Sources") */}
        {isInspectorOpen && (
          <>
            {/* Mobile Backdrop Overlay */}
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 xl:hidden animate-in fade-in duration-150"
              onClick={() => setIsInspectorOpen(false)}
              aria-hidden="true"
            />

            <aside 
              aria-label="Outputs and Sources Inspector"
              className="fixed inset-y-0 right-0 z-40 w-80 max-w-[85vw] xl:static xl:z-10 xl:w-80 shrink-0 h-full p-4 border-l border-zinc-800/80 bg-[#18181b] xl:bg-[#18181b]/95 backdrop-blur-xl flex flex-col gap-4 shadow-2xl xl:shadow-none animate-in slide-in-from-right-4 duration-200"
            >
              {/* Header with Mobile Close */}
              <div className="flex items-center justify-between pb-1 border-b border-zinc-800/60 xl:hidden">
                <span className="text-xs font-bold text-zinc-300">Inspector & Context</span>
                <button
                  type="button"
                  onClick={() => setIsInspectorOpen(false)}
                  aria-label="Close Inspector"
                  className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Outputs Card */}
              <div className="p-3.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-md space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Outputs</span>
                  <button 
                    onClick={() => setIsAgentComputerOpen(true)}
                    title="Create output"
                    aria-label="Create Output"
                    className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                <button
                  onClick={() => setIsAgentComputerOpen(true)}
                  className="w-full min-h-[44px] p-2.5 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 text-left flex items-center justify-between text-xs text-zinc-300 hover:text-white transition-all group cursor-pointer active:scale-95"
                >
                  <div className="flex items-center gap-2">
                    <FileCode size={16} className="text-purple-400" />
                    <span className="font-medium">Create a file or site</span>
                  </div>
                  <ChevronRight size={14} className="text-zinc-500 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>

              {/* Sources Card */}
              <div className="p-3.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-md space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Sources</span>
                  <button 
                    onClick={() => setIsExecOsSheetOpen(true)}
                    title="Add source"
                    aria-label="Add Source"
                    className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <button
                    onClick={() => setIsDiffSheetOpen(true)}
                    className="w-full min-h-[40px] p-2.5 rounded-xl bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-700/40 text-left flex items-center gap-2 text-xs font-mono text-zinc-300 hover:text-purple-300 transition-colors cursor-pointer active:scale-95"
                  >
                    <span className="text-zinc-500">//</span>
                    <span className="truncate">inneranimalmedia-mcp-server</span>
                  </button>

                  <button
                    onClick={() => setIsCacheInspectorOpen(true)}
                    className="w-full min-h-[36px] text-left px-2.5 py-1.5 text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                  >
                    <ExternalLink size={12} />
                    <span>View all</span>
                  </button>
                </div>
              </div>

              {/* Quick Status / Environment Indicator */}
              <div className="mt-auto p-3 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 text-xs space-y-2 text-zinc-400 font-mono">
                <div className="flex items-center justify-between">
                  <span>ExecOS Status:</span>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Port {execOsStatus.daemonPort || 3099}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>PWA Manifest:</span>
                  <span className="text-zinc-300">Warmed (v2.4)</span>
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* 4. Bottom Floating FlexFit Composer / Connector Drawer */}
      <div className="absolute bottom-4 left-0 right-0 z-30 pointer-events-auto">
        <FlexFitComposer
          onSendMessage={handleComposerSubmit}
          onOpenTerminal={onOpenTerminal}
          onOpenConnectorDrawer={() => setIsExecOsSheetOpen(true)}
          placeholder="Work with Agent Sam"
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          isProcessing={isProcessing}
        />
      </div>

      {/* 5. Modals & Native Bottom Sheets */}
      {/* Diff Inspector Sheet */}
      <WorkbenchDiffSheet
        isOpen={isDiffSheetOpen}
        onClose={() => setIsDiffSheetOpen(false)}
        pr={{
          id: 'pr-1',
          number: 402,
          title: 'Fix terminal operator policy & drift',
          branch: 'fix/terminal-operator-policy',
          targetBranch: 'main',
          author: 'Agent Sam',
          authorAvatar: 'AS',
          status: 'in_review',
          createdAt: '12m ago',
          updatedAt: 'Just now',
          summary: '+142 -38 lines (4 files)',
          specMarkdown: 'Fix terminal operator policy and reconcile drift in test ratchet.',
          additions: 142,
          deletions: 38,
          files: [
            {
              id: 'f-1',
              filename: 'dispatch.ts',
              path: 'src/server/mcp/dispatch.ts',
              status: 'modified',
              additions: 45,
              deletions: 12,
              diffLines: [
                { type: 'header', content: '@@ -12,8 +12,12 @@ export function dispatchRatchet()' },
                { type: 'del', oldLine: 14, content: '-  logAgentsamMcpToolExecution(toolName);' },
                { type: 'add', newLine: 14, content: '+  // Ratchet log removed for clean execution policy' }
              ]
            }
          ]
        }}
        onSquashAndMerge={() => {
          setIsDiffSheetOpen(false);
          handleComposerSubmit("Squashed and merged PR #402 into main.");
        }}
      />

      {/* PWA Cache Engine Diagnostics Sheet */}
      <PwaCacheInspectorSheet
        isOpen={isCacheInspectorOpen}
        onClose={() => setIsCacheInspectorOpen(false)}
        cacheStatus={cacheStatus}
        onUpdateCacheStatus={setCacheStatus}
      />

      {/* ExecOS Local Lane & PM2 Environment Sanitizer Sheet */}
      <ExecOsLocalLaneSheet
        isOpen={isExecOsSheetOpen}
        onClose={() => setIsExecOsSheetOpen(false)}
        status={execOsStatus}
        onUpdateStatus={setExecOsStatus}
        onRunRemoteCommand={(cmd) => {
          handleComposerSubmit(`[Local Lane ExecOS @ 3099] Executed: ${cmd}`);
        }}
      />

      {/* Agent Computer Unified Environment Modal (Browser + Terminal + Files + Artifacts) */}
      {isAgentComputerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-5xl h-[85vh] flex flex-col bg-zinc-950 rounded-3xl border border-zinc-800 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-purple-400" />
                <span className="font-bold text-sm text-white">Agent Computer</span>
                <span className="text-xs text-zinc-400 font-mono">Unified Runtime Layer</span>
              </div>
              <button
                onClick={() => setIsAgentComputerOpen(false)}
                className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-2">
              <AgentComputerSurface
                onOpenTerminalDrawer={onOpenTerminal}
                className="h-full border-none shadow-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
