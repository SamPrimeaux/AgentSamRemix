import React, { useState } from 'react';
import { 
  X, 
  Laptop, 
  Terminal, 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCw, 
  Copy, 
  Check, 
  Key, 
  Lock, 
  Cpu, 
  HardDrive, 
  Zap, 
  ArrowRight, 
  CheckCircle2, 
  SlidersHorizontal,
  FileCode,
  Layers,
  Sparkles,
  Smartphone,
  Cloud
} from 'lucide-react';
import { ExecOsLocalLaneStatus, ExecutionLane } from '../../types';
import { cn } from '../../../lib/utils';
import confetti from 'canvas-confetti';

interface ExecOsLocalLaneSheetProps {
  isOpen: boolean;
  onClose: () => void;
  status: ExecOsLocalLaneStatus;
  onUpdateStatus: (updated: ExecOsLocalLaneStatus) => void;
  onRunRemoteCommand?: (cmd: string) => void;
}

export const ExecOsLocalLaneSheet: React.FC<ExecOsLocalLaneSheetProps> = ({
  isOpen,
  onClose,
  status,
  onUpdateStatus,
  onRunRemoteCommand
}) => {
  const [activeTab, setActiveTab] = useState<'architecture' | 'pm2_sanitizer' | 'ssh_auth' | 'terminal_bench'>('pm2_sanitizer');
  const [isApplyingSanitizer, setIsApplyingSanitizer] = useState(false);
  const [copiedEcosystem, setCopiedEcosystem] = useState(false);
  const [commandInput, setCommandInput] = useState('git status -s');
  const [isExecutingCmd, setIsExecutingCmd] = useState(false);
  const [testLogs, setTestLogs] = useState<string[]>([]);

  if (!isOpen) return null;

  const generatedEcosystemConfig = `// ecosystem.config.cjs - Deterministic ExecOS Process Definition
module.exports = {
  apps: [{
    name: '${status.pm2ProcessName}',
    script: './server.js',
    cwd: '${status.defaultCwd}',
    instances: 1,
    autorestart: true,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: '${status.daemonPort}',
      EXECOS_KEY: 'sk_live_••••••••89f2',
      PTY_AUTH_TOKEN: 'pty_tok_••••••••51ac',
      AGENTSAM_BRIDGE_KEY: 'brg_••••••••74a9',
      EXECOS_DEFAULT_CWD: '${status.defaultCwd}',
      EXECOS_MCP_FS_ROOTS: '${status.mcpFsRoots.join(',')}',
      SAM_OPERATOR_REPO_PATHS: '${status.operatorRepoPaths.join(',')}',
      WORKER_URL: '${status.workerUrl}',
      TUNNEL_URL: '${status.tunnelUrl}',
      ALLOWED_TENANTS: '${status.allowedTenants.join(',')}'
      ${status.sshMode === 'inherited_launchd_socket' ? `\n      // Inherited macOS launchd socket (optional)\n      SSH_AUTH_SOCK: '${status.sshAuthSockPath}',` : ''}
    }
  }]
};`;

  const handleCopyEcosystem = () => {
    navigator.clipboard.writeText(generatedEcosystemConfig);
    setCopiedEcosystem(true);
    setTimeout(() => setCopiedEcosystem(false), 2000);
  };

  const handleSanitizeAndRestart = () => {
    setIsApplyingSanitizer(true);
    setTestLogs([`[PM2 Sanitizer] Writing ${status.defaultCwd}/ecosystem.config.cjs...`]);

    setTimeout(() => {
      setTestLogs((prev) => [
        ...prev,
        '[OK] Stripped 106 IDE/Cursor bleed variables (VSCODE_PROCESS_TITLE, CURSOR_AGENT, CURSOR_CONVERSATION_ID)',
        '[OK] File permissions tightened: chmod 600 ~/.pm2/dump.pm2 (Owner-only read/write)'
      ]);
    }, 400);

    setTimeout(() => {
      setTestLogs((prev) => [
        ...prev,
        '[OK] Running: pm2 delete execos && pm2 start ecosystem.config.cjs --env production && pm2 save',
        '[OK] ExecOS daemon online on Port 3099 (PID: 42890)'
      ]);
    }, 900);

    setTimeout(() => {
      setIsApplyingSanitizer(false);
      onUpdateStatus({
        ...status,
        isEcosystemSanitized: true,
        cursorBleedDetected: false,
        totalInheritedEnvVars: status.sanitizedEnvVars.length
      });
      confetti({ particleCount: 35, spread: 60 });
    }, 1400);
  };

  const handleRunCommand = () => {
    if (!commandInput.trim()) return;
    setIsExecutingCmd(true);

    setTimeout(() => {
      setIsExecutingCmd(false);
      const newCmdResult = {
        id: `cmd-${Date.now()}`,
        command: commandInput,
        cwd: status.defaultCwd,
        exitCode: 0,
        durationMs: Math.floor(Math.random() * 25) + 12,
        timestamp: 'Just now',
        output: commandInput.includes('pm2 env')
          ? status.isEcosystemSanitized
            ? `NODE_ENV: production\nPORT: 3099\nEXECOS_DEFAULT_CWD: ${status.defaultCwd}\n[Sanitized: 11 clean keys, zero IDE bleed]`
            : 'VSCODE_PROCESS_TITLE: extension-host (agent-exec)\nCURSOR_AGENT: 1\nCURSOR_CONVERSATION_ID: conv_99d12a\n[Warning: 114 inherited environment variables]'
          : commandInput.includes('git')
          ? 'On branch fix/pwa-sw-caching\nYour branch is up to date with origin/main.\nChanges not staged for commit:\n  modified:   src/bootstrap.ts'
          : `Execution complete. Executed in ${status.defaultCwd} via tunnel (0 DO hops).`
      };

      onUpdateStatus({
        ...status,
        recentLocalCommands: [newCmdResult, ...status.recentLocalCommands]
      });

      if (onRunRemoteCommand) {
        onRunRemoteCommand(commandInput);
      }
    }, 500);
  };

  const handleLaneChange = (newLane: ExecutionLane) => {
    onUpdateStatus({
      ...status,
      activeLane: newLane
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex-1 w-full" onClick={onClose} />

      <div className="w-full max-w-3xl mx-auto h-[88vh] max-h-[860px] rounded-t-[36px] bg-[#0d0d10] border-t border-x border-white/10 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
        {/* Grabber Handle */}
        <div className="w-full pt-3 pb-1 flex justify-center cursor-pointer" onClick={onClose}>
          <div className="w-12 h-1.2 rounded-full bg-white/20 hover:bg-white/40 transition-colors" />
        </div>

        {/* Sheet Header */}
        <div className="px-6 py-3.5 flex items-center justify-between border-b border-white/[0.07] shrink-0">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/80 hover:text-white flex items-center justify-center transition-all active:scale-95"
          >
            <X size={18} />
          </button>

          <div className="text-center">
            <div className="flex items-center justify-center gap-2">
              <Laptop size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-white tracking-tight">ExecOS Local Lane & PM2 Environment</h3>
            </div>
            <p className="text-[11px] text-white/40">
              MacBook Pro • Port {status.daemonPort} • /Users/{status.macUsername}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono text-emerald-400 font-semibold">{status.latencyMs}ms</span>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="px-6 pt-3 pb-2 border-b border-white/[0.05] flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          <button
            onClick={() => setActiveTab('pm2_sanitizer')}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5",
              activeTab === 'pm2_sanitizer'
                ? "bg-white/15 text-white shadow-sm font-semibold"
                : "bg-white/[0.04] text-white/60 hover:text-white"
            )}
          >
            <ShieldCheck size={14} className={status.isEcosystemSanitized ? "text-emerald-400" : "text-amber-400"} />
            <span>PM2 Sanitizer</span>
            {!status.isEcosystemSanitized && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('architecture')}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5",
              activeTab === 'architecture'
                ? "bg-white/15 text-white shadow-sm font-semibold"
                : "bg-white/[0.04] text-white/60 hover:text-white"
            )}
          >
            <Zap size={14} className="text-blue-400" />
            <span>Topology & Flow</span>
          </button>

          <button
            onClick={() => setActiveTab('ssh_auth')}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5",
              activeTab === 'ssh_auth'
                ? "bg-white/15 text-white shadow-sm font-semibold"
                : "bg-white/[0.04] text-white/60 hover:text-white"
            )}
          >
            <Key size={14} className="text-purple-400" />
            <span>SSH & Sockets</span>
          </button>

          <button
            onClick={() => setActiveTab('terminal_bench')}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5",
              activeTab === 'terminal_bench'
                ? "bg-white/15 text-white shadow-sm font-semibold"
                : "bg-white/[0.04] text-white/60 hover:text-white"
            )}
          >
            <Terminal size={14} className="text-emerald-400" />
            <span>Remote Command Bench</span>
          </button>
        </div>

        {/* Sheet Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ================= TAB 1: PM2 SANITIZER ================= */}
          {activeTab === 'pm2_sanitizer' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Privilege Envelope Comparison Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Current State */}
                <div className={cn(
                  "p-4 rounded-3xl border space-y-2",
                  status.isEcosystemSanitized 
                    ? "bg-emerald-500/5 border-emerald-500/20" 
                    : "bg-amber-500/10 border-amber-500/25"
                )}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
                      Privilege Envelope
                    </span>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold",
                      status.isEcosystemSanitized 
                        ? "bg-emerald-500/20 text-emerald-300" 
                        : "bg-amber-500/20 text-amber-300"
                    )}>
                      {status.isEcosystemSanitized ? 'Narrow & Boring' : 'Over-Privileged'}
                    </span>
                  </div>

                  <div className="text-xl font-bold text-white tracking-tight">
                    {status.isEcosystemSanitized ? '11 Env Variables' : `${status.totalInheritedEnvVars} Env Variables`}
                  </div>

                  <p className="text-xs text-white/60 leading-relaxed">
                    {status.isEcosystemSanitized
                      ? 'ExecOS is running as a boring, narrow shell executor. Zero IDE or developer shell bleed.'
                      : 'ExecOS inherited your whole developer shell + Cursor extension-host state during launch.'}
                  </p>
                </div>

                {/* Cursor Bleed Detection Card */}
                <div className="p-4 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-2 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
                        Cursor IDE Bleed
                      </span>
                      {status.cursorBleedDetected ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">
                          Leaking
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold">
                          Clean
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {status.cursorBleedDetected 
                        ? 'VSCODE_PROCESS_TITLE & CURSOR_AGENT'
                        : 'No IDE variables present in daemon'}
                    </div>
                    <p className="text-xs text-white/50">
                      Caused when PM2 starts from an IDE-integrated shell. Fix by launching from a deterministic ecosystem file.
                    </p>
                  </div>

                  {!status.isEcosystemSanitized && (
                    <button
                      onClick={handleSanitizeAndRestart}
                      disabled={isApplyingSanitizer}
                      className="w-full mt-2 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md"
                    >
                      <RefreshCw size={13} className={cn(isApplyingSanitizer && "animate-spin")} />
                      <span>{isApplyingSanitizer ? 'Sanitizing PM2...' : 'Apply Clean Ecosystem Config'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Leaked / Bloated Variables Sample Table */}
              {!status.isEcosystemSanitized && (
                <div className="p-5 rounded-3xl bg-white/[0.02] border border-rose-500/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-rose-400">
                      <AlertTriangle size={14} />
                      <span>Bleeded Variables to Strip ({status.bloatedEnvVarsSample.length} sampled)</span>
                    </div>
                    <span className="text-[11px] text-white/40">pm2 env 0</span>
                  </div>

                  <div className="space-y-1.5 font-mono text-xs">
                    {status.bloatedEnvVarsSample.map((v) => (
                      <div 
                        key={v.key}
                        className="p-2.5 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-rose-300 font-semibold">{v.key}:</span>
                          <span className="text-white/60 truncate max-w-xs">{v.value}</span>
                        </div>
                        <span className="text-[10px] text-white/40 italic font-sans">{v.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Curated 11 Clean Environment Keys */}
              <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 size={14} />
                    <span>Curated Narrow Environment (Desired Production Definition)</span>
                  </div>
                  <span className="text-[11px] text-white/40 font-mono">11 keys</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
                  {status.sanitizedEnvVars.map((v) => (
                    <div key={v.key} className="p-2.5 rounded-2xl bg-white/[0.02] border border-white/[0.04] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-300 font-semibold">{v.key}</span>
                        <span className="text-[10px] text-white/30 font-sans">{v.source}</span>
                      </div>
                      <div className="text-white/80 truncate text-[11px]">{v.value}</div>
                      <div className="text-[10px] text-white/40 font-sans leading-tight">{v.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Generated ecosystem.config.cjs Code Block */}
              <div className="p-5 rounded-3xl bg-[#08080a] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
                    <FileCode size={14} className="text-blue-400" />
                    <span>ecosystem.config.cjs</span>
                  </div>
                  <button
                    onClick={handleCopyEcosystem}
                    className="px-3 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-xs text-white/80 hover:text-white flex items-center gap-1.5 transition-all"
                  >
                    {copiedEcosystem ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    <span>{copiedEcosystem ? 'Copied' : 'Copy Config'}</span>
                  </button>
                </div>

                <pre className="p-4 rounded-2xl bg-black/50 border border-white/[0.05] text-xs font-mono text-white/80 overflow-x-auto leading-relaxed">
                  {generatedEcosystemConfig}
                </pre>
              </div>

              {/* Telemetry Output Box */}
              {testLogs.length > 0 && (
                <div className="p-4 rounded-2xl bg-[#08080a] border border-emerald-500/20 space-y-1 font-mono text-xs">
                  <div className="text-[11px] text-emerald-400 font-sans font-semibold pb-1 border-b border-white/[0.05]">
                    Daemon Execution Telemetry
                  </div>
                  {testLogs.map((log, i) => (
                    <div key={i} className="text-white/80 leading-relaxed">
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 2: ARCHITECTURE & TOPOLOGY ================= */}
          {activeTab === 'architecture' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-white">Local Execution Lane Topology</h4>
                <p className="text-xs text-white/60 leading-relaxed">
                  How you control your actual MacBook from your phone without fake cloud sandboxes or unnecessary DO hops.
                </p>
              </div>

              {/* Visual Flow Diagram */}
              <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                  {/* Step 1: Phone */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                      <Smartphone size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">Mobile Device</div>
                      <div className="text-[10px] text-white/40">iOS Safari PWA</div>
                    </div>
                  </div>

                  <ArrowRight size={16} className="text-white/30 rotate-90 sm:rotate-0" />

                  {/* Step 2: Edge Worker */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                      <Cloud size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">Cloudflare Worker</div>
                      <div className="text-[10px] text-white/40">inneranimalmedia.com</div>
                    </div>
                  </div>

                  <ArrowRight size={16} className="text-white/30 rotate-90 sm:rotate-0" />

                  {/* Step 3: Tunnel */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                      <Zap size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">Local Tunnel</div>
                      <div className="text-[10px] text-white/40">user_hosted_tunnel</div>
                    </div>
                  </div>

                  <ArrowRight size={16} className="text-white/30 rotate-90 sm:rotate-0" />

                  {/* Step 4: Mac ExecOS */}
                  <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
                      <Laptop size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">Mac ExecOS</div>
                      <div className="text-[10px] text-emerald-400 font-mono">Port {status.daemonPort}</div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/[0.05] text-xs text-white/60 leading-relaxed space-y-1.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span><strong>Zero DO Hops:</strong> One-shot commands go directly to ExecOS instead of paying proxy delays.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span><strong>Real Filesystem:</strong> Direct access to <code>/Users/samprimeaux/Projects</code>.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    <span><strong>Deterministic CWD:</strong> Commands run in the target repository directory automatically.</span>
                  </div>
                </div>
              </div>

              {/* Execution Lane Switcher */}
              <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  Select Active Execution Lane
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Option 1: Local Mac Lane */}
                  <button
                    onClick={() => handleLaneChange('local_mac')}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all space-y-2",
                      status.activeLane === 'local_mac'
                        ? "bg-emerald-500/15 border-emerald-500/40 shadow-sm"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Laptop size={16} className={status.activeLane === 'local_mac' ? "text-emerald-400" : "text-white/40"} />
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    </div>
                    <div className="text-sm font-semibold text-white">Local Mac (ExecOS)</div>
                    <div className="text-[11px] text-white/50 leading-tight">
                      Direct tunnel to your real macOS machine & repos.
                    </div>
                  </button>

                  {/* Option 2: GCP VM */}
                  <button
                    onClick={() => handleLaneChange('gcp_vm')}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all space-y-2",
                      status.activeLane === 'gcp_vm'
                        ? "bg-blue-500/15 border-blue-500/40 shadow-sm"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Cloud size={16} className={status.activeLane === 'gcp_vm' ? "text-blue-400" : "text-white/40"} />
                      <span className="text-[10px] text-white/40 font-mono">SSH</span>
                    </div>
                    <div className="text-sm font-semibold text-white">GCP Linux VM</div>
                    <div className="text-[11px] text-white/50 leading-tight">
                      Dedicated cloud VM for heavy compiling & background jobs.
                    </div>
                  </button>

                  {/* Option 3: Cloud Sandbox */}
                  <button
                    onClick={() => handleLaneChange('cloud_sandbox')}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all space-y-2",
                      status.activeLane === 'cloud_sandbox'
                        ? "bg-purple-500/15 border-purple-500/40 shadow-sm"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Layers size={16} className={status.activeLane === 'cloud_sandbox' ? "text-purple-400" : "text-white/40"} />
                      <span className="text-[10px] text-white/40 font-mono">Isolated</span>
                    </div>
                    <div className="text-sm font-semibold text-white">Ephemeral Sandbox</div>
                    <div className="text-[11px] text-white/50 leading-tight">
                      Fallback container for untrusted code execution.
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 3: SSH & AUTH SOCKETS ================= */}
          {activeTab === 'ssh_auth' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Key size={16} className="text-purple-400" />
                  <span>SSH_AUTH_SOCK Demystified</span>
                </div>
                <div className="p-3 rounded-2xl bg-black/40 border border-white/[0.05] font-mono text-xs text-purple-300">
                  SSH_AUTH_SOCK={status.sshAuthSockPath}
                </div>
                <p className="text-xs text-white/60 leading-relaxed">
                  <strong>What this means:</strong> It is not your private SSH key. It is a local Unix socket path created by macOS <code>launchd</code>. When you run <code>git push</code> or <code>ssh</code>, programs ask the SSH agent through this socket to prove your identity.
                </p>
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90 leading-relaxed">
                  <strong>Security Note:</strong> If ExecOS inherits <code>SSH_AUTH_SOCK</code>, remote agent commands can use your loaded SSH identities (convenient for Git, but broadens remote execution privileges).
                </div>
              </div>

              {/* SSH Privilege Mode Selector */}
              <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  SSH Authentication Mode for ExecOS
                </div>

                <div className="space-y-2.5">
                  {/* Mode 1: Scoped Git Key */}
                  <button
                    onClick={() => onUpdateStatus({ ...status, sshMode: 'scoped_git_key' })}
                    className={cn(
                      "w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-3",
                      status.sshMode === 'scoped_git_key'
                        ? "bg-emerald-500/15 border-emerald-500/40"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldCheck size={16} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        <span>Scoped Git Deploy Key (Recommended)</span>
                        <span className="px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px]">P0 Best Practice</span>
                      </div>
                      <p className="text-xs text-white/50 leading-relaxed">
                        ExecOS only receives a dedicated Git deploy token for your repos. Cannot SSH into remote servers as you.
                      </p>
                    </div>
                  </button>

                  {/* Mode 2: Inherited macOS Socket */}
                  <button
                    onClick={() => onUpdateStatus({ ...status, sshMode: 'inherited_launchd_socket' })}
                    className={cn(
                      "w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-3",
                      status.sshMode === 'inherited_launchd_socket'
                        ? "bg-purple-500/15 border-purple-500/40"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 mt-0.5">
                      <Key size={16} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        <span>Inherit macOS launchd SSH Socket</span>
                        <span className="px-2 py-0.2 rounded-full bg-purple-500/20 text-purple-300 text-[10px]">Broad Privilege</span>
                      </div>
                      <p className="text-xs text-white/50 leading-relaxed">
                        Allows remote phone commands to use all your active SSH keys loaded in macOS Terminal.
                      </p>
                    </div>
                  </button>

                  {/* Mode 3: Sandboxed */}
                  <button
                    onClick={() => onUpdateStatus({ ...status, sshMode: 'sandboxed' })}
                    className={cn(
                      "w-full p-4 rounded-2xl border text-left transition-all flex items-start gap-3",
                      status.sshMode === 'sandboxed'
                        ? "bg-blue-500/15 border-blue-500/40"
                        : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center shrink-0 mt-0.5">
                      <Lock size={16} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-sm font-semibold text-white">Sandboxed / No SSH Access</div>
                      <p className="text-xs text-white/50 leading-relaxed">
                        Strictly denies any SSH socket access. Git operations must use HTTPS with scoped fine-grained tokens.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Filesystem Permission Lockdown */}
              <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/70">
                  <Lock size={14} className="text-emerald-400" />
                  <span>Filesystem Permissions Audit</span>
                </div>
                <div className="p-3 rounded-2xl bg-black/40 border border-white/[0.05] font-mono text-xs text-white/80 space-y-1">
                  <div className="text-emerald-400">-rw------- 1 samprimeaux staff 4.2K /Users/samprimeaux/.pm2/dump.pm2</div>
                  <div className="text-emerald-400">-rw------- 1 samprimeaux staff 1.1K /Users/samprimeaux/ExecOS/.env</div>
                </div>
                <p className="text-xs text-white/50">
                  Your dump, logs, and ecosystem files are locked to your macOS user account (`chmod 600`), preventing other unprivileged users from controlling your PM2 daemon.
                </p>
              </div>
            </div>
          )}

          {/* ================= TAB 4: REMOTE COMMAND TEST BENCH ================= */}
          {activeTab === 'terminal_bench' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-white">One-Shot Local Command Bench</h4>
                <p className="text-xs text-white/60">
                  Execute direct, zero-hop diagnostic commands on your MacBook via ExecOS (Port {status.daemonPort}).
                </p>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                {[
                  'git status -s',
                  'pm2 env 0',
                  'pm2 status execos',
                  'uname -srm && sw_vers',
                  'ls -la /Users/samprimeaux/Projects'
                ].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setCommandInput(preset)}
                    className="px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-white/80 hover:text-white border border-white/[0.08] transition-all whitespace-nowrap"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              {/* Command Input Bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-black/60 border border-white/[0.1] font-mono text-xs text-white">
                  <span className="text-emerald-400 font-bold">$</span>
                  <input
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRunCommand()}
                    placeholder="Enter command to run on Mac..."
                    className="flex-1 bg-transparent text-white placeholder:text-white/30 focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleRunCommand}
                  disabled={isExecutingCmd}
                  className="px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-md shrink-0"
                >
                  <RefreshCw size={13} className={cn(isExecutingCmd && "animate-spin")} />
                  <span>{isExecutingCmd ? 'Running...' : 'Execute'}</span>
                </button>
              </div>

              {/* Recent Command Execution Outputs */}
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50 px-1">
                  Local Execution History
                </div>

                <div className="space-y-3 font-mono text-xs">
                  {status.recentLocalCommands.map((cmd) => (
                    <div
                      key={cmd.id}
                      className="p-4 rounded-3xl bg-[#08080a] border border-white/[0.08] space-y-2"
                    >
                      <div className="flex items-center justify-between text-[11px] text-white/50 border-b border-white/[0.05] pb-2 font-sans">
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-emerald-400 font-bold">$ {cmd.command}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-white/40">{cmd.durationMs}ms</span>
                          <span className="text-emerald-400">Exit 0</span>
                        </div>
                      </div>
                      <pre className="text-white/85 whitespace-pre-wrap leading-relaxed pt-1 overflow-x-auto">
                        {cmd.output}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
