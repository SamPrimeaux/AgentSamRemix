import React, { useState } from 'react';
import { 
  X, 
  Database, 
  Zap, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Code, 
  Terminal, 
  Cpu, 
  Sparkles, 
  ShieldCheck,
  HardDrive,
  Layers,
  ArrowRight
} from 'lucide-react';
import { PwaCacheStatus } from '../../types';
import { cn } from '../../../lib/utils';
import confetti from 'canvas-confetti';

interface PwaCacheInspectorSheetProps {
  isOpen: boolean;
  onClose: () => void;
  cacheStatus: PwaCacheStatus;
  onUpdateCacheStatus: (status: PwaCacheStatus) => void;
}

export const PwaCacheInspectorSheet: React.FC<PwaCacheInspectorSheetProps> = ({
  isOpen,
  onClose,
  cacheStatus,
  onUpdateCacheStatus
}) => {
  const [isSimulatingLaunch, setIsSimulatingLaunch] = useState(false);
  const [launchLogs, setLaunchLogs] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleToggleStartupPurge = () => {
    onUpdateCacheStatus({
      ...cacheStatus,
      startupPurgeDisabled: !cacheStatus.startupPurgeDisabled,
      cacheEngine: !cacheStatus.startupPurgeDisabled 
        ? 'Workbox CacheFirst (Versioned)' 
        : 'Unconditional Purge (Legacy)'
    });
  };

  const handleToggleNonBlockingMount = () => {
    onUpdateCacheStatus({
      ...cacheStatus,
      nonBlockingMount: !cacheStatus.nonBlockingMount
    });
  };

  const handleWarmChunk = (chunk: 'monaco' | 'xterm' | 'three') => {
    if (chunk === 'monaco') {
      onUpdateCacheStatus({
        ...cacheStatus,
        lazyMonacoWarmed: true,
        cacheSizeKb: cacheStatus.cacheSizeKb + 1850
      });
      confetti({ particleCount: 20 });
    } else if (chunk === 'xterm') {
      onUpdateCacheStatus({
        ...cacheStatus,
        lazyXtermWarmed: true,
        cacheSizeKb: cacheStatus.cacheSizeKb + 340
      });
      confetti({ particleCount: 20 });
    } else if (chunk === 'three') {
      onUpdateCacheStatus({
        ...cacheStatus,
        lazyThreeWarmed: true,
        cacheSizeKb: cacheStatus.cacheSizeKb + 1200
      });
      confetti({ particleCount: 20 });
    }
  };

  const handleSimulateColdStart = () => {
    setIsSimulatingLaunch(true);
    setLaunchLogs(['[PWA Bootstrap] App container initialized...']);

    setTimeout(() => {
      setLaunchLogs((prev) => [
        ...prev,
        cacheStatus.startupPurgeDisabled
          ? '[OK] Cache Check: Preserved existing v2.4.1 device caches (Zero Purge).'
          : '[Warning] Purged all device caches on startup!'
      ]);
    }, 400);

    setTimeout(() => {
      setLaunchLogs((prev) => [
        ...prev,
        '[OK] Workbox Routing: Served index.html + dashboard.js (CacheFirst: 4ms).'
      ]);
    }, 800);

    setTimeout(() => {
      setLaunchLogs((prev) => [
        ...prev,
        cacheStatus.nonBlockingMount
          ? '[OK] Non-blocking React Mount: Rendered shell instantly. Background auth started.'
          : '[Pending] Blocking Bootstrap: Waiting for /api/dashboard/bootstrap network response...'
      ]);
      setIsSimulatingLaunch(false);
      confetti({ particleCount: 25 });
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex-1 w-full" onClick={onClose} />

      <div className="w-full max-w-3xl mx-auto h-[84vh] max-h-[820px] rounded-t-[36px] bg-[#0d0d10] border-t border-x border-white/10 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
        {/* Grabber handle */}
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
            <h3 className="text-sm font-semibold text-white tracking-tight">PWA Caching & SW Diagnostics</h3>
            <p className="text-[11px] text-white/40">Workbox CacheFirst • Zero Startup Purge • Lazy Intent</p>
          </div>

          <button
            onClick={handleSimulateColdStart}
            disabled={isSimulatingLaunch}
            className="px-3.5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
          >
            <RefreshCw size={13} className={cn(isSimulatingLaunch && "animate-spin")} />
            <span>Test Boot</span>
          </button>
        </div>

        {/* Sheet Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07] space-y-1">
              <div className="text-[11px] text-white/40 font-medium flex items-center justify-between">
                <span>SW Lifecycle</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="text-lg font-bold text-white tracking-tight">Active (v2.4.1)</div>
              <div className="text-[11px] text-emerald-400 font-mono">Decoupled from workspace</div>
            </div>

            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07] space-y-1">
              <div className="text-[11px] text-white/40 font-medium flex items-center justify-between">
                <span>Cache Strategy</span>
                <Zap size={13} className="text-blue-400" />
              </div>
              <div className="text-lg font-bold text-white tracking-tight">CacheFirst</div>
              <div className="text-[11px] text-white/50 font-mono">Workbox Versioned</div>
            </div>

            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07] space-y-1">
              <div className="text-[11px] text-white/40 font-medium flex items-center justify-between">
                <span>Device Footprint</span>
                <HardDrive size={13} className="text-purple-400" />
              </div>
              <div className="text-lg font-bold text-white tracking-tight">{cacheStatus.cacheSizeKb} KB</div>
              <div className="text-[11px] text-white/50 font-mono">Retained on launch</div>
            </div>
          </div>

          {/* Core P0 Architectural Overhaul Toggles */}
          <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
              P0 Architectural Policies
            </div>

            {/* Policy 1: Startup Purge Elimination */}
            <div className="flex items-center justify-between gap-4 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>Preserve Device Caches (No Unconditional Purge)</span>
                  {cacheStatus.startupPurgeDisabled && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">
                      P0 Fixed
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  Purges old version only when manifest cache_bust differs. Eliminates blank-screen downloads on repeat visits.
                </p>
              </div>
              <button
                onClick={handleToggleStartupPurge}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-semibold transition-all shrink-0",
                  cacheStatus.startupPurgeDisabled 
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" 
                    : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                )}
              >
                {cacheStatus.startupPurgeDisabled ? 'Retained' : 'Purging'}
              </button>
            </div>

            {/* Policy 2: Non-Blocking React Mount */}
            <div className="flex items-center justify-between gap-4 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05]">
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>Non-Blocking React Mount & Route Paint</span>
                  {cacheStatus.nonBlockingMount && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono">
                      Instant Paint
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  Cached app shell mounts React immediately; auth & data load in background via requestIdleCallback.
                </p>
              </div>
              <button
                onClick={handleToggleNonBlockingMount}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-semibold transition-all shrink-0",
                  cacheStatus.nonBlockingMount 
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" 
                    : "bg-white/[0.08] text-white/60"
                )}
              >
                {cacheStatus.nonBlockingMount ? 'Non-Blocking' : 'Blocking'}
              </button>
            </div>
          </div>

          {/* Intent-Driven Lazy Chunk Warming */}
          <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Intent-Driven Heavy Chunk Warming
              </div>
              <span className="text-[11px] text-white/40">Only warmed on user intent</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Monaco Code Editor */}
              <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Code size={14} className="text-blue-400" />
                    <span>Monaco Editor</span>
                  </div>
                  {cacheStatus.lazyMonacoWarmed ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <span className="text-[10px] text-white/40">Not Warmed</span>
                  )}
                </div>
                <p className="text-[11px] text-white/45">1.85 MB • Code inspection</p>
                <button
                  onClick={() => handleWarmChunk('monaco')}
                  disabled={cacheStatus.lazyMonacoWarmed}
                  className={cn(
                    "w-full py-1.5 rounded-xl text-[11px] font-semibold transition-all",
                    cacheStatus.lazyMonacoWarmed
                      ? "bg-white/[0.05] text-white/35 cursor-default"
                      : "bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30"
                  )}
                >
                  {cacheStatus.lazyMonacoWarmed ? 'Warmed in Cache' : 'Tap to Warm'}
                </button>
              </div>

              {/* XTerm Shell Terminal */}
              <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Terminal size={14} className="text-emerald-400" />
                    <span>XTerm Terminal</span>
                  </div>
                  {cacheStatus.lazyXtermWarmed ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <span className="text-[10px] text-white/40">Not Warmed</span>
                  )}
                </div>
                <p className="text-[11px] text-white/45">340 KB • Shell execution</p>
                <button
                  onClick={() => handleWarmChunk('xterm')}
                  disabled={cacheStatus.lazyXtermWarmed}
                  className={cn(
                    "w-full py-1.5 rounded-xl text-[11px] font-semibold transition-all",
                    cacheStatus.lazyXtermWarmed
                      ? "bg-white/[0.05] text-white/35 cursor-default"
                      : "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30"
                  )}
                >
                  {cacheStatus.lazyXtermWarmed ? 'Warmed in Cache' : 'Tap to Warm'}
                </button>
              </div>

              {/* Three.js 3D Engine */}
              <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Cpu size={14} className="text-purple-400" />
                    <span>Three.js Engine</span>
                  </div>
                  {cacheStatus.lazyThreeWarmed ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <span className="text-[10px] text-white/40">Not Warmed</span>
                  )}
                </div>
                <p className="text-[11px] text-white/45">1.20 MB • 3D Viewport</p>
                <button
                  onClick={() => handleWarmChunk('three')}
                  disabled={cacheStatus.lazyThreeWarmed}
                  className={cn(
                    "w-full py-1.5 rounded-xl text-[11px] font-semibold transition-all",
                    cacheStatus.lazyThreeWarmed
                      ? "bg-white/[0.05] text-white/35 cursor-default"
                      : "bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/30"
                  )}
                >
                  {cacheStatus.lazyThreeWarmed ? 'Warmed in Cache' : 'Tap to Warm'}
                </button>
              </div>
            </div>
          </div>

          {/* Test Launch Telemetry Logs */}
          {launchLogs.length > 0 && (
            <div className="p-4 rounded-2xl bg-[#08080a] border border-white/[0.08] space-y-1.5 font-mono text-xs">
              <div className="text-[11px] text-white/40 font-sans font-semibold pb-1 border-b border-white/[0.05]">
                Launch Simulation Telemetry
              </div>
              {launchLogs.map((log, i) => (
                <div key={i} className="text-white/80 leading-relaxed">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
