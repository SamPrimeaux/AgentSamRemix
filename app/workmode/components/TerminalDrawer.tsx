import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Terminal as TerminalIcon, 
  RotateCcw, 
  Square, 
  Trash2, 
  Maximize2, 
  Minimize2, 
  X, 
  FileCode, 
  GitBranch, 
  Server, 
  Check, 
  Copy, 
  ChevronUp, 
  ChevronDown, 
  Activity, 
  Cpu, 
  Sparkles, 
  ShieldCheck,
  Zap,
  GripHorizontal,
  Layers,
  StopCircle,
  Clock,
  Send,
  Plus,
  Radio,
  CornerDownLeft,
  Bot,
  UserCheck
} from 'lucide-react';
import { 
  ExecutionLane, 
  TerminalSnapPosition, 
  TerminalOwnershipState 
} from '../types';
import { cn } from '../../lib/utils';
import { MobileTerminalAccessories } from './terminal/MobileTerminalAccessories';
import { TerminalLaneSelector } from './terminal/TerminalLaneSelector';

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  onRunTestAgain: () => void;
  activeBranch?: string;
  activePath?: string;
  customLogs?: string[];
  initialSnapPosition?: TerminalSnapPosition;
}

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({
  isOpen,
  onClose,
  onOpen,
  onRunTestAgain,
  activeBranch = 'main',
  activePath = 'backend/agentsam',
  customLogs,
  initialSnapPosition = 'split',
}) => {
  const [activeTab, setActiveTab] = useState<'output' | 'files' | 'environment' | 'traces'>('output');
  const [snapPosition, setSnapPosition] = useState<TerminalSnapPosition>(initialSnapPosition);
  const [activeLane, setActiveLane] = useState<ExecutionLane>('local_mac');
  const [ownershipState, setOwnershipState] = useState<TerminalOwnershipState>('idle');
  const [commandInput, setCommandInput] = useState('');
  const [ctrlActive, setCtrlActive] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Swipe & Drag Gesture Tracking
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);

  const defaultLogs = [
    `# Connected to Local Mac lane via localpty on port 3099 (Clean PM2 sandbox)`,
    `> npm test -- auth`,
    `> node --test test/auth`,
    ``,
    `[OK] auth/session.test.ts          2.1s`,
    `[OK] auth/oauth.test.ts            1.3s`,
    `[OK] auth/guards.test.ts           1.0s`,
    `[OK] auth/workspace-access.test.ts 1.6s`,
    `[OK] auth/middleware.test.ts       0.8s`,
    ``,
    `Test Files   5 passed (5)`,
    `Tests        18 passed (18)`,
    `Start        9:40:12 AM`,
    `Duration     4.32s`,
    ``,
    `[Done] Done in 4.32s.`,
    `dev@macbook ${activePath} % `
  ];

  const [logs, setLogs] = useState<string[]>(customLogs && customLogs.length > 0 ? customLogs : defaultLogs);

  useEffect(() => {
    if (customLogs && customLogs.length > 0) {
      setLogs(customLogs);
    }
  }, [customLogs]);

  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isRunning, isOpen, activeTab, snapPosition]);

  // Touch Swipe handlers for Bottom Pull Strip
  const handleBottomTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleBottomTouchMove = (e: React.TouchEvent) => {
    touchCurrentY.current = e.touches[0].clientY;
  };

  const handleBottomTouchEnd = () => {
    if (touchStartY.current !== null && touchCurrentY.current !== null) {
      const deltaY = touchCurrentY.current - touchStartY.current;
      if (deltaY < -25) {
        onOpen();
        setSnapPosition('split');
      }
    }
    touchStartY.current = null;
    touchCurrentY.current = null;
  };

  // Touch & Drag handlers for Top Drawer Pill
  const handleTopDragTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTopDragTouchMove = (e: React.TouchEvent) => {
    touchCurrentY.current = e.touches[0].clientY;
  };

  const handleTopDragTouchEnd = () => {
    if (touchStartY.current !== null && touchCurrentY.current !== null) {
      const deltaY = touchCurrentY.current - touchStartY.current;
      // Swiped downwards by > 45px
      if (deltaY > 45) {
        if (snapPosition === 'full') {
          setSnapPosition('split');
        } else if (snapPosition === 'split') {
          setSnapPosition('peek');
        } else {
          onClose();
        }
      } 
      // Swiped upwards by > 45px
      else if (deltaY < -45) {
        if (snapPosition === 'peek') {
          setSnapPosition('split');
        } else {
          setSnapPosition('full');
        }
      }
    }
    touchStartY.current = null;
    touchCurrentY.current = null;
  };

  const handleCycleSnap = () => {
    if (snapPosition === 'peek') setSnapPosition('split');
    else if (snapPosition === 'split') setSnapPosition('full');
    else setSnapPosition('split');
  };

  const handleRunCommand = (e?: React.FormEvent, customCmd?: string) => {
    if (e) e.preventDefault();
    const cmd = (customCmd || commandInput).trim();
    if (!cmd) return;

    setCommandInput('');
    setIsRunning(true);
    setOwnershipState('agent_controlling');

    setLogs(prev => [
      ...prev,
      `dev@macbook ${activePath} % ${cmd}`,
      `[Agent Sam executing: ${cmd} on ${activeLane}...]`
    ]);

    setTimeout(() => {
      setIsRunning(false);
      setOwnershipState('idle');
      const lower = cmd.toLowerCase();
      if (lower.includes('test') || lower.includes('auth')) {
        setLogs(prev => [
          ...prev,
          `[OK] 5 test suites passed (18 tests total, 0 regressions)`,
          `[Done] Done in 2.14s.`,
          `dev@macbook ${activePath} % `
        ]);
      } else if (lower.includes('build') || lower.includes('deck') || lower.includes('presentation')) {
        setLogs(prev => [
          ...prev,
          `[OK] Synthesizing pitch deck with Gemini 3.5 Flash...`,
          `[OK] 4 responsive slide canvases compiled to Work Mode.`,
          `[Done] Build complete in 1.48s.`,
          `dev@macbook ${activePath} % `
        ]);
      } else if (lower.includes('git') || lower.includes('push') || lower.includes('status')) {
        setLogs(prev => [
          ...prev,
          `On branch ${activeBranch}`,
          `Your branch is up to date with 'origin/${activeBranch}'.`,
          `nothing to commit, working tree clean`,
          `dev@macbook ${activePath} % `
        ]);
      } else if (lower === 'clear') {
        setLogs([`dev@macbook ${activePath} % `]);
      } else if (lower.includes('deploy')) {
        setLogs(prev => [
          ...prev,
          `[OK] Bundling client assets & server runtime...`,
          `[OK] Deploying to Cloud Run ingress (Port 3000)...`,
          `[Done] Live preview synchronized at https://preview.apexdynamics.ai`,
          `dev@macbook ${activePath} % `
        ]);
      } else {
        setLogs(prev => [
          ...prev,
          `Agent Sam executed: ${cmd}`,
          `Process exited with code 0.`,
          `dev@macbook ${activePath} % `
        ]);
      }
    }, 850);
  };

  const handleClear = () => {
    setLogs([`dev@macbook ${activePath} % `]);
  };

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInterrupt = () => {
    setIsRunning(false);
    setOwnershipState('idle');
    setLogs(prev => [
      ...prev,
      `^C`,
      `[Interrupted by user SIGINT]`,
      `dev@macbook ${activePath} % `
    ]);
  };

  const handleInsertKey = (key: string) => {
    if (key === 'Escape') {
      setCommandInput('');
    } else if (key === 'Tab') {
      if (commandInput.startsWith('npm')) setCommandInput('npm test -- auth');
      else if (commandInput.startsWith('git')) setCommandInput('git status');
      else setCommandInput(prev => prev + '  ');
    } else if (key === 'ArrowUp') {
      setCommandInput('npm test -- auth');
    } else if (key === 'ArrowDown') {
      setCommandInput('');
    } else if (key === 'ArrowLeft') {
      if (inputRef.current) {
        inputRef.current.selectionStart = Math.max(0, (inputRef.current.selectionStart || 0) - 1);
        inputRef.current.selectionEnd = inputRef.current.selectionStart;
      }
    } else if (key === 'ArrowRight') {
      if (inputRef.current) {
        inputRef.current.selectionStart = Math.min(commandInput.length, (inputRef.current.selectionStart || 0) + 1);
        inputRef.current.selectionEnd = inputRef.current.selectionStart;
      }
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setCommandInput(prev => prev + text);
    } catch {
      setCommandInput(prev => prev + 'git status');
    }
  };

  return (
    <>
      {/* 1. Bottom Grabber (Active when closed) */}
      {!isOpen && (
        <div
          id="terminal-bottom-grabber"
          role="button"
          tabIndex={0}
          aria-label="Swipe up or click to open Terminal Drawer"
          onClick={() => {
            onOpen();
            setSnapPosition('split');
          }}
          onTouchStart={handleBottomTouchStart}
          onTouchMove={handleBottomTouchMove}
          onTouchEnd={handleBottomTouchEnd}
          className="fixed bottom-0 left-0 right-0 z-30 h-4 hover:h-6 transition-all duration-200 cursor-pointer flex flex-col items-center justify-end pb-1 bg-gradient-to-t from-black/60 to-transparent group select-none"
        >
          <div className="w-20 sm:w-28 h-1 group-hover:h-1.5 rounded-full bg-zinc-400/60 dark:bg-zinc-600/80 group-hover:bg-blue-500 transition-all shadow-md flex items-center justify-center">
            <span className="sr-only">Swipe up for Terminal</span>
          </div>
        </div>
      )}

      {/* 2. Slide-up Terminal Drawer Sheet */}
      <section
        id="terminal-slide-drawer"
        aria-label="Interactive Terminal Drawer"
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 flex flex-col justify-end transition-all duration-300 ease-out pointer-events-none",
          isOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
        )}
      >
        {/* Backdrop for mobile/focused viewing */}
        {isOpen && snapPosition !== 'peek' && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-xs pointer-events-auto transition-opacity"
            onClick={onClose}
          />
        )}

        {/* Drawer Window Shell with 3 Snap Positions (Peek / Split / Full) */}
        <div className={cn(
          "w-full sm:w-[calc(100%-2rem)] md:w-[calc(100%-4rem)] max-w-6xl 2xl:max-w-7xl mx-auto bg-zinc-950/98 text-zinc-100 rounded-t-3xl border-t border-x border-zinc-800/90 shadow-2xl flex flex-col pointer-events-auto relative select-text transition-all duration-300 overflow-hidden backdrop-blur-xl",
          snapPosition === 'peek' && "h-[54px]",
          snapPosition === 'split' && "h-[390px] lg:h-[430px]",
          snapPosition === 'full' && "h-[88vh]"
        )}>
          {/* Top Drag Pill Handle */}
          <div 
            className="w-full flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing group hover:bg-zinc-900/60 transition-colors select-none"
            onClick={handleCycleSnap}
            onTouchStart={handleTopDragTouchStart}
            onTouchMove={handleTopDragTouchMove}
            onTouchEnd={handleTopDragTouchEnd}
            title={`Snap position: ${snapPosition}. Click or drag to cycle.`}
          >
            <div className="w-16 h-1.5 bg-zinc-700/80 group-hover:bg-zinc-400 rounded-full transition-colors" />
          </div>

          {/* Header Bar */}
          <div className="px-3 sm:px-6 py-2 flex items-center justify-between border-b border-zinc-800/90 bg-zinc-950/90 gap-2">
            {/* Title, Host, & Explicit Lane info */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-emerald-400 font-mono text-xs font-bold shrink-0 shadow-xs">
                {`>_`}
              </div>
              <div className="truncate">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-zinc-100 truncate">Terminal</span>
                  {/* Ownership state badge */}
                  {ownershipState === 'agent_controlling' ? (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-800/50 font-medium shrink-0 animate-pulse">
                      <Bot size={11} />
                      Agent executing
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/40 font-mono shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Ready
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-zinc-400 font-mono flex items-center gap-1.5 truncate">
                  <span>dev@macbook</span>
                  <span className="text-zinc-600">:</span>
                  <span className="text-blue-400 font-semibold truncate">{activePath}</span>
                </div>
              </div>
            </div>

            {/* Execution Lane Switcher */}
            <div className="hidden lg:block">
              <TerminalLaneSelector currentLane={activeLane} onChangeLane={setActiveLane} isCompact />
            </div>

            {/* Quick Action Chips & Window controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Agent Interrupt button when busy */}
              {isRunning && (
                <button
                  onClick={handleInterrupt}
                  className="px-2 py-1 rounded-lg bg-red-950 text-red-300 border border-red-800 text-[11px] font-mono font-bold hover:bg-red-900 transition-colors flex items-center gap-1"
                >
                  <Square size={10} className="fill-red-400" />
                  <span>Interrupt</span>
                </button>
              )}

              {/* Quick command buttons */}
              <div className="hidden md:flex items-center gap-1.5 mr-1">
                <button
                  onClick={() => handleRunCommand(undefined, 'npm test -- auth')}
                  className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-zinc-800 transition-colors"
                >
                  npm test
                </button>
                <button
                  onClick={() => handleRunCommand(undefined, 'npm run build')}
                  className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-zinc-800 transition-colors"
                >
                  npm run build
                </button>
                <button
                  onClick={() => handleRunCommand(undefined, 'git status')}
                  className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-zinc-800 transition-colors"
                >
                  git status
                </button>
              </div>

              {/* Copy logs */}
              <button
                onClick={handleCopyLogs}
                title="Copy terminal output"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </button>

              {/* Snap toggles: Peek / Split / Full */}
              <button
                onClick={() => setSnapPosition(snapPosition === 'full' ? 'split' : 'full')}
                title={snapPosition === 'full' ? "Split height" : "Full height"}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                {snapPosition === 'full' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>

              {/* Close Drawer */}
              <button
                onClick={onClose}
                title="Close drawer"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <ChevronDown size={17} />
              </button>
            </div>
          </div>

          {/* Sub-Tabs: Output | Files | Environment | Agent Trace (Hidden in Peek mode) */}
          {snapPosition !== 'peek' && (
            <div className="px-4 sm:px-6 flex items-center gap-6 border-b border-zinc-800/80 bg-zinc-950/60 text-xs font-medium shrink-0">
              <button
                onClick={() => setActiveTab('output')}
                className={cn(
                  "py-2 relative transition-colors flex items-center gap-1.5",
                  activeTab === 'output'
                    ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-500"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <TerminalIcon size={13} />
                <span>Shell Output</span>
              </button>
              <button
                onClick={() => setActiveTab('files')}
                className={cn(
                  "py-2 relative transition-colors flex items-center gap-1.5",
                  activeTab === 'files'
                    ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-500"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <FileCode size={13} />
                <span>Files</span>
                <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.2 rounded-full">3</span>
              </button>
              <button
                onClick={() => setActiveTab('environment')}
                className={cn(
                  "py-2 relative transition-colors flex items-center gap-1.5",
                  activeTab === 'environment'
                    ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-500"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Server size={13} />
                <span>Sanitized Env</span>
              </button>
              <button
                onClick={() => setActiveTab('traces')}
                className={cn(
                  "py-2 relative transition-colors flex items-center gap-1.5",
                  activeTab === 'traces'
                    ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-500"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Activity size={13} />
                <span>Execution Trace</span>
              </button>
            </div>
          )}

          {/* Body Content (Rendered when not in Peek mode) */}
          {snapPosition !== 'peek' && (
            <div className="flex-1 min-h-0 bg-black/90 p-3 sm:p-4 font-mono text-xs overflow-hidden flex flex-col">
              {activeTab === 'output' && (
                <>
                  <div 
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto space-y-1 select-text scrollbar-thin scrollbar-thumb-zinc-800"
                  >
                    {logs.map((log, idx) => (
                      <div 
                        key={idx} 
                        className={cn(
                          "leading-relaxed whitespace-pre-wrap font-mono",
                          log.startsWith('✔') && "text-emerald-400",
                          log.startsWith('✨') && "text-emerald-300 font-bold",
                          log.startsWith('>') && "text-blue-400 font-semibold",
                          log.includes('%') && "text-zinc-300 font-semibold",
                          log.startsWith('#') && "text-zinc-500 italic",
                          log.startsWith('[') && "text-purple-400 italic"
                        )}
                      >
                        {log}
                      </div>
                    ))}
                    {isRunning && (
                      <div className="flex items-center gap-2 text-blue-400 pt-1">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                        <span>Executing process on {activeLane}...</span>
                      </div>
                    )}
                  </div>

                  {/* Command prompt input */}
                  <form onSubmit={handleRunCommand} className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-2 shrink-0">
                    <span className="text-emerald-400 font-bold shrink-0">{`dev@macbook $`}</span>
                    <input
                      ref={inputRef}
                      type="text"
                      value={commandInput}
                      onChange={(e) => setCommandInput(e.target.value)}
                      placeholder="Enter shell command (e.g. npm test, git status)..."
                      className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 focus:outline-hidden font-mono text-xs"
                    />
                    <button
                      type="submit"
                      disabled={!commandInput.trim()}
                      className="p-1 rounded-md text-zinc-400 hover:text-white disabled:opacity-30"
                    >
                      <CornerDownLeft size={14} />
                    </button>
                  </form>
                </>
              )}

              {activeTab === 'files' && (
                <div className="flex-1 overflow-y-auto space-y-2 text-xs font-mono">
                  <div className="text-zinc-400 mb-2">Modified Workspace Files:</div>
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCode size={14} className="text-blue-400" />
                      <span>src/components/browser/BrowserSurface.tsx</span>
                    </div>
                    <span className="text-emerald-400 text-[11px]">+64 / -0</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCode size={14} className="text-blue-400" />
                      <span>src/components/TerminalDrawer.tsx</span>
                    </div>
                    <span className="text-emerald-400 text-[11px]">+48 / -19</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCode size={14} className="text-amber-400" />
                      <span>ecosystem.config.cjs</span>
                    </div>
                    <span className="text-amber-400 text-[11px]">Clean PM2</span>
                  </div>
                </div>
              )}

              {activeTab === 'environment' && (
                <div className="flex-1 overflow-y-auto space-y-3 text-xs font-mono">
                  <div className="text-zinc-400">Sanitized Environment Definition (PM2 ExecOS):</div>
                  <div className="p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-1.5 text-zinc-300">
                    <div><span className="text-purple-400">NODE_ENV</span>=production</div>
                    <div><span className="text-purple-400">PORT</span>=3099</div>
                    <div><span className="text-purple-400">EXECOS_KEY</span>=execos_live_••••••••</div>
                    <div><span className="text-purple-400">PTY_AUTH_TOKEN</span>=pty_sec_••••••••</div>
                    <div><span className="text-purple-400">EXECOS_DEFAULT_CWD</span>=/Users/developer/Projects/agentsam</div>
                    <div><span className="text-purple-400">ALLOWED_TENANTS</span>=authenticated_user_only</div>
                  </div>
                </div>
              )}

              {activeTab === 'traces' && (
                <div className="flex-1 overflow-y-auto space-y-2.5 text-xs font-sans">
                  <div className="text-zinc-400 mb-1">Agent Sam Autonomous Task Breakdown:</div>
                  <div className="space-y-2">
                    <div className="p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-emerald-950 text-emerald-400 flex items-center justify-center font-bold text-xs border border-emerald-800/60">
                          1
                        </div>
                        <div>
                          <div className="font-semibold text-zinc-100">Context Extraction & AST Parsing</div>
                          <div className="text-[11px] text-zinc-400 font-mono">Read 6 workspace files in 0.8s</div>
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs font-semibold">100% OK</span>
                    </div>

                    <div className="p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-emerald-950 text-emerald-400 flex items-center justify-center font-bold text-xs border border-emerald-800/60">
                          2
                        </div>
                        <div>
                          <div className="font-semibold text-zinc-100">Autonomous Test Suite Execution</div>
                          <div className="text-[11px] text-zinc-400 font-mono">18/18 test assertions verified</div>
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs font-semibold">100% OK</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* iOS Mobile Hardware Accessory Row */}
          {snapPosition !== 'peek' && (
            <MobileTerminalAccessories
              onInsertKey={handleInsertKey}
              onInterrupt={handleInterrupt}
              onClear={handleClear}
              onPaste={handlePaste}
              ctrlActive={ctrlActive}
              onToggleCtrl={() => setCtrlActive(!ctrlActive)}
            />
          )}

          {/* Footer Controls */}
          {snapPosition !== 'peek' && (
            <div className="px-4 sm:px-6 py-2 bg-zinc-900/95 border-t border-zinc-800 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={onRunTestAgain}
                  className="px-3 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition-colors font-semibold shadow-xs"
                >
                  <RotateCcw size={12} />
                  <span>Run test suite</span>
                </button>
                <button
                  onClick={() => setIsRunning(false)}
                  className="px-3 py-1 rounded-xl bg-zinc-800/60 hover:bg-zinc-700 text-red-400 flex items-center gap-1.5 transition-colors font-medium"
                >
                  <Square size={10} className="fill-red-400" />
                  <span>Stop</span>
                </button>
                <button
                  onClick={handleClear}
                  className="px-3 py-1 rounded-xl bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors font-medium"
                >
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-zinc-400 font-mono text-[11px]">
                <span className="hidden sm:inline">Port 3099</span>
                <span className="text-zinc-600 hidden sm:inline">•</span>
                <span className="text-emerald-400 font-bold">Connected</span>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
};
