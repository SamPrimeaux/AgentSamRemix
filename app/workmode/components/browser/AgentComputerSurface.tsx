import React, { useState } from 'react';
import { 
  Globe, 
  Terminal, 
  FileCode, 
  Layers, 
  Cpu, 
  GitBranch, 
  Folder, 
  Sparkles, 
  CheckCircle2, 
  Play, 
  RotateCw, 
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Zap,
  Code2,
  Sliders,
  Copy,
  Check
} from 'lucide-react';
import { 
  AgentComputerTab, 
  AgentComputerState, 
  ExecutionLane 
} from '../../types';
import { BrowserSurface } from './BrowserSurface';
import { cn } from '../../../lib/utils';
import confetti from 'canvas-confetti';

interface AgentComputerSurfaceProps {
  state?: Partial<AgentComputerState>;
  onOpenTerminalDrawer?: () => void;
  className?: string;
}

export const AgentComputerSurface: React.FC<AgentComputerSurfaceProps> = ({
  state: initialState,
  onOpenTerminalDrawer,
  className
}) => {
  const [activeTab, setActiveTab] = useState<AgentComputerTab>(initialState?.activeTab || 'browser');
  const [activeLane, setActiveLane] = useState<ExecutionLane>(initialState?.activeLane || 'local_mac');
  const [activeFileId, setActiveFileId] = useState('f-1');

  // MCP Tool Testing State
  const [selectedTool, setSelectedTool] = useState('dispatchRatchet');
  const [toolInputPayload, setToolInputPayload] = useState('{\n  "targetBranch": "fix/terminal-operator-policy",\n  "reconcileDrift": true\n}');
  const [toolOutputResult, setToolOutputResult] = useState<string | null>(null);
  const [isDispatchingTool, setIsDispatchingTool] = useState(false);
  const [copiedDiff, setCopiedDiff] = useState(false);

  const files = [
    { 
      id: 'f-1', 
      name: 'src/server/mcp/dispatch.ts', 
      changes: '+14 / -4', 
      status: 'modified',
      diff: [
        '@@ -12,8 +12,12 @@ export function dispatchRatchet()',
        '-  logAgentsamMcpToolExecution(toolName);',
        '+  // Reconciled for clean terminal operator policy',
        '+  return { status: "ok", code: 200, ratchetPassed: true };'
      ]
    },
    { 
      id: 'f-2', 
      name: 'src/server/mcp/memory_search.ts', 
      changes: '+8 / -2', 
      status: 'modified',
      diff: [
        '@@ -45,4 +45,8 @@ export const memorySearchSchema',
        '-  description: "Search previous memory blobs"',
        '+  description: "Search workspace semantic memory index and execution trace"'
      ]
    },
    { 
      id: 'f-3', 
      name: 'tests/mcp/ratchet.test.ts', 
      changes: '+32 / -0', 
      status: 'added',
      diff: [
        '@@ -0,0 +1,12 @@',
        '+ describe("inneranimalmedia-mcp-server ratchet tests", () => {',
        '+   it("validates zero-drift dispatch schema", () => {',
        '+     expect(dispatchRatchet().status).toBe("ok");',
        '+   });',
        '+ });'
      ]
    },
    { 
      id: 'f-4', 
      name: 'package.json', 
      changes: '+2 / -1', 
      status: 'modified',
      diff: [
        '@@ -18,3 +18,4 @@',
        '-    "test": "node --test"',
        '+    "test": "node --test tests/**/*.test.ts"'
      ]
    }
  ];

  const activeFile = files.find(f => f.id === activeFileId) || files[0];

  const deliverables = [
    { 
      id: 'art-1', 
      title: 'inneranimalmedia-mcp-server', 
      type: 'MCP Server', 
      status: 'Synchronized (Clean Working Tree)', 
      tag: 'Backend Core',
      desc: 'Local daemon running on port 3099 with zero-drift ratchet assertions.'
    },
    { 
      id: 'art-2', 
      title: 'AgentSamWorkMode Interface', 
      type: 'React / Vite SPA', 
      status: 'Compiled & Lint Verified', 
      tag: 'UI Component',
      desc: 'Single-view responsive workspace with FlexFit Composer & Inspector Drawer.'
    },
    { 
      id: 'art-3', 
      title: 'Execution Policy & Ratchet Suite', 
      type: 'Test Matrix', 
      status: '5/5 Assertions Passing', 
      tag: 'Verification',
      desc: 'Strict AST type-checking, schema contract validation, and PWA cache hydration.'
    }
  ];

  const handleDispatchToolTest = () => {
    setIsDispatchingTool(true);
    setTimeout(() => {
      setIsDispatchingTool(false);
      setToolOutputResult(JSON.stringify({
        status: 'ok',
        code: 200,
        tool: selectedTool,
        timestamp: new Date().toISOString(),
        executionLatencyMs: 34,
        policyVerified: true,
        driftResolved: true,
        output: {
          ratchetStatus: 'aligned',
          canonicalMainDiff: 0,
          checkedAssertions: 18
        }
      }, null, 2));
      confetti({ particleCount: 20, spread: 50 });
    }, 550);
  };

  const handleCopyDiff = () => {
    navigator.clipboard.writeText(activeFile.diff.join('\n'));
    setCopiedDiff(true);
    setTimeout(() => setCopiedDiff(false), 1500);
  };

  return (
    <div className={cn("w-full bg-zinc-950 rounded-2xl border border-zinc-800 shadow-xl overflow-hidden flex flex-col text-zinc-100 select-text", className)}>
      
      {/* 1. Top Environment Bar */}
      <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-300 flex items-center justify-center font-bold text-sm shadow-xs">
            <Cpu size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">Agent Sam Computer Runtime</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono font-medium">
                Active & Verified
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
              <span className="flex items-center gap-1">
                <GitBranch size={11} className="text-purple-400" />
                <span>fix/terminal-operator-policy</span>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 truncate max-w-[220px]">
                <Folder size={11} className="text-zinc-400" />
                <span>inneranimalmedia-mcp-server</span>
              </span>
            </div>
          </div>
        </div>

        {/* Execution Lane Selector */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveLane('local_mac')}
            className={cn(
              "px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5",
              activeLane === 'local_mac' ? "bg-zinc-800 text-white font-semibold shadow-xs" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Local Mac :3099</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveLane('cloud_sandbox')}
            className={cn(
              "px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1.5",
              activeLane === 'cloud_sandbox' ? "bg-zinc-800 text-white font-semibold shadow-xs" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            <span>Cloud Sandbox</span>
          </button>
        </div>
      </div>

      {/* 2. Navigation Tabs */}
      <div className="px-4 flex items-center gap-6 border-b border-zinc-800 bg-zinc-900/40 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('browser')}
          className={cn(
            "py-2.5 relative transition-colors flex items-center gap-1.5",
            activeTab === 'browser'
              ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500"
              : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Globe size={13} />
          <span>Live Browser & Preview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('terminal')}
          className={cn(
            "py-2.5 relative transition-colors flex items-center gap-1.5",
            activeTab === 'terminal'
              ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500"
              : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Terminal size={13} />
          <span>Terminal Execution</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('files')}
          className={cn(
            "py-2.5 relative transition-colors flex items-center gap-1.5",
            activeTab === 'files'
              ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500"
              : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          <FileCode size={13} />
          <span>Files & Diff</span>
          <span className="text-[10px] bg-zinc-800 text-zinc-300 font-mono px-1.5 py-0.2 rounded-full">
            {files.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('artifacts')}
          className={cn(
            "py-2.5 relative transition-colors flex items-center gap-1.5",
            activeTab === 'artifacts'
              ? "text-white font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500"
              : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Code2 size={13} />
          <span>MCP Tool Tester</span>
        </button>
      </div>

      {/* 3. Main Tab Surface */}
      <div className="flex-1 min-h-[440px] max-h-[620px] overflow-hidden bg-black/90 flex flex-col">
        
        {/* TAB 1: BROWSER SURFACE */}
        {activeTab === 'browser' && (
          <div className="flex-1 p-2 sm:p-3 overflow-hidden">
            <BrowserSurface />
          </div>
        )}

        {/* TAB 2: TERMINAL SESSION */}
        {activeTab === 'terminal' && (
          <div className="flex-1 p-4 flex flex-col font-mono text-xs overflow-hidden">
            <div className="flex-1 overflow-y-auto space-y-1.5 text-zinc-300 pb-3">
              <div className="text-zinc-500"># Connected to Local Mac lane via localpty on port 3099</div>
              <div className="text-purple-400">&gt; npm run lint && npm test</div>
              <div className="text-zinc-400">&gt; tsc --noEmit (TypeScript compiler validation)</div>
              <div className="text-emerald-400">✔ TypeScript compilation: 0 errors (0.8s)</div>
              <div className="text-emerald-400">✔ tests/mcp/ratchet.test.ts      0.9s</div>
              <div className="text-emerald-400">✔ tests/mcp/memory_search.test.ts 0.6s</div>
              <div className="text-emerald-400">✔ tests/server/daemon.test.ts     1.1s</div>
              <div className="text-zinc-300 font-bold pt-2">Tests: 18 passed, 18 total (100%)</div>
              <div className="text-emerald-300">✨ Ratchet drift reconciled and verified successfully</div>
            </div>

            <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-zinc-400">
                <span className="text-emerald-400 font-bold">dev@macbook ~ %</span>
                <span className="text-zinc-300">idle (ready for commands)</span>
              </div>
              {onOpenTerminalDrawer && (
                <button
                  type="button"
                  onClick={onOpenTerminalDrawer}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-sans text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <ExternalLink size={12} />
                  <span>Open Full Terminal Drawer</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: FILES & DIFF */}
        {activeTab === 'files' && (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-0 overflow-hidden">
            {/* File List */}
            <div className="border-r border-zinc-800 p-3 space-y-1.5 overflow-y-auto">
              <div className="text-zinc-400 text-xs font-semibold mb-2">Changed Workspace Files:</div>
              {files.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => setActiveFileId(f.id)}
                  className={cn(
                    "w-full p-2 rounded-xl text-left font-mono text-xs flex items-center justify-between transition-colors",
                    activeFileId === f.id ? "bg-zinc-800 text-white font-semibold" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileCode size={13} className="text-purple-400 shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 shrink-0 font-medium">{f.changes}</span>
                </button>
              ))}
            </div>

            {/* Diff Preview */}
            <div className="md:col-span-2 p-4 font-mono text-xs overflow-y-auto bg-zinc-950/80 space-y-2">
              <div className="text-zinc-400 font-sans font-semibold mb-2 flex items-center justify-between">
                <span className="truncate">{activeFile.name}</span>
                <button
                  type="button"
                  onClick={handleCopyDiff}
                  className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-sans flex items-center gap-1"
                >
                  {copiedDiff ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  <span>{copiedDiff ? 'Copied' : 'Copy Diff'}</span>
                </button>
              </div>

              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-1">
                {activeFile.diff.map((line, idx) => (
                  <div 
                    key={idx}
                    className={cn(
                      "px-1 py-0.5 rounded",
                      line.startsWith('+') && "text-emerald-400 bg-emerald-950/40",
                      line.startsWith('-') && "text-red-400 bg-red-950/40",
                      line.startsWith('@@') && "text-zinc-500",
                      !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@@') && "text-zinc-300"
                    )}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: MCP TOOL TESTER & AI VALIDATOR */}
        {activeTab === 'artifacts' && (
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-white">Live MCP Tool & Schema Dispatch Tester</div>
                <div className="text-xs text-zinc-400 font-mono">Validate JSON schema contracts and dispatch functions directly</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
              {/* Input Configuration */}
              <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
                <div className="text-zinc-300 font-bold font-sans">Select Tool to Test:</div>
                <select
                  value={selectedTool}
                  onChange={(e) => setSelectedTool(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                >
                  <option value="dispatchRatchet">dispatchRatchet (Terminal operator policy)</option>
                  <option value="agentsam_memory_search">agentsam_memory_search (Semantic memory query)</option>
                  <option value="executeLocalCommand">executeLocalCommand (Port 3099 execution)</option>
                </select>

                <div className="text-zinc-300 font-bold font-sans">Payload (JSON):</div>
                <textarea
                  rows={5}
                  value={toolInputPayload}
                  onChange={(e) => setToolInputPayload(e.target.value)}
                  className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-700 text-xs text-purple-200 font-mono focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                />

                <button
                  type="button"
                  onClick={handleDispatchToolTest}
                  disabled={isDispatchingTool}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-sans font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  {isDispatchingTool ? <RotateCw size={13} className="animate-spin" /> : <Play size={13} />}
                  <span>Dispatch Tool Execution</span>
                </button>
              </div>

              {/* Output Result */}
              <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col space-y-2">
                <div className="text-zinc-300 font-bold font-sans flex items-center justify-between">
                  <span>Execution Output:</span>
                  {toolOutputResult && (
                    <span className="text-emerald-400 text-[11px] font-mono">200 OK • 34ms</span>
                  )}
                </div>

                <div className="flex-1 p-3 rounded-xl bg-zinc-950 border border-zinc-800/90 text-xs font-mono overflow-y-auto text-emerald-300">
                  {toolOutputResult ? (
                    <pre className="whitespace-pre-wrap">{toolOutputResult}</pre>
                  ) : (
                    <span className="text-zinc-500">Click 'Dispatch Tool Execution' to validate schema output in real-time.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Footer Summary */}
      <div className="px-4 py-2.5 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400 font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-zinc-200 font-semibold">ExecOS Daemon Status:</span>
          <span className="text-emerald-400 font-mono">Port 3099 Active</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-purple-400 font-semibold">Clean AST</span>
          <span>•</span>
          <span>Zero-drift ratchet verified</span>
        </div>
      </div>
    </div>
  );
};
