import React, { useState } from 'react';
import { 
  Folder, 
  ChevronRight, 
  Search, 
  Plus, 
  Sparkles, 
  GitPullRequest, 
  CheckCircle2, 
  Clock, 
  Layers, 
  SlidersHorizontal,
  HardDrive,
  Activity,
  User,
  ShieldCheck,
  Zap,
  Laptop,
  AlertTriangle,
  Key
} from 'lucide-react';
import { WorkbenchWorkspace, WorkbenchPullRequest, PwaCacheStatus, ExecOsLocalLaneStatus } from '../../types';
import { cn } from '../../../lib/utils';
import { ExecutionLanePill } from './ExecutionLanePill';

interface WorkbenchInboxViewProps {
  workspaces: WorkbenchWorkspace[];
  onSelectWorkspace: (workspace: WorkbenchWorkspace) => void;
  onOpenCacheInspector: () => void;
  cacheStatus: PwaCacheStatus;
  execOsStatus: ExecOsLocalLaneStatus;
  onOpenExecOsSheet: () => void;
}

export const WorkbenchInboxView: React.FC<WorkbenchInboxViewProps> = ({
  workspaces,
  onSelectWorkspace,
  onOpenCacheInspector,
  cacheStatus,
  execOsStatus,
  onOpenExecOsSheet
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Compute aggregate counts
  const totalWorking = workspaces.reduce((sum, w) => sum + w.statusSummary.working, 0);
  const totalInReview = workspaces.reduce((sum, w) => sum + w.statusSummary.inReview, 0);
  const totalNeedsAttention = workspaces.reduce((sum, w) => sum + w.statusSummary.needsAttention, 0);

  const filteredWorkspaces = workspaces.filter(
    (w) => w.name.toLowerCase().includes(searchQuery.toLowerCase()) || w.repoName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* Top Floating Controls Bar (No clunky rectangular toolbar chrome) */}
      <div className="w-full max-w-2xl mx-auto px-6 pt-6 pb-2 flex items-center justify-between shrink-0">
        {/* Top-Left: Oversized Circular Profile Target */}
        <button
          onClick={onOpenCacheInspector}
          aria-label="Profile & Cache Diagnostics"
          className="w-12 h-12 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center justify-center text-white font-medium text-sm transition-all shadow-sm"
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-xs">
            AS
          </div>
        </button>

        {/* Top-Right: Oversized Circular Actions + Execution Lane Pill */}
        <div className="flex items-center gap-2">
          {/* Execution Lane Pill (Local Mac / Port 3099 / PM2 Sanitizer) */}
          <ExecutionLanePill
            status={execOsStatus}
            onClick={onOpenExecOsSheet}
          />

          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            aria-label="Search workspaces"
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 border",
              isSearchOpen 
                ? "bg-white/15 text-white border-white/20" 
                : "bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white border-white/[0.08]"
            )}
          >
            <Search size={19} />
          </button>

          <button
            onClick={onOpenCacheInspector}
            aria-label="PWA Cache Engine"
            className="h-12 px-3.5 sm:px-4 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center gap-2 text-white/80 hover:text-white transition-all text-xs font-semibold"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="hidden sm:inline">PWA v2.4</span>
          </button>
        </div>
      </div>

      {/* Main Content Area with Generous Negative Space */}
      <div className="w-full max-w-2xl mx-auto px-6 pt-4 pb-28 space-y-6 flex-1">
        {/* Search Input Field (when toggled) */}
        {isSearchOpen && (
          <div className="animate-in fade-in slide-in-from-top-2 duration-200">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories, workspaces..."
              autoFocus
              className="w-full h-12 px-4 rounded-2xl bg-white/[0.05] border border-white/[0.1] text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-white/30"
            />
          </div>
        )}

        {/* Large, Calm Page Title */}
        <div className="space-y-1 pt-1">
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-white">
            Inbox
          </h1>
          <p className="text-sm text-white/40 font-normal">
            Autonomous developer workbench & workspace telemetry
          </p>
        </div>

        {/* Status Cards (Large, Sparse, Soft Semantic Color) */}
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3 pt-2">
          {/* Working 0 */}
          <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/[0.06] flex flex-col justify-between space-y-3">
            <div className="w-7 h-7 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Activity size={14} />
            </div>
            <div>
              <div className="text-lg sm:text-2xl font-medium tracking-tight text-white">
                {totalWorking}
              </div>
              <div className="text-xs text-white/40 font-normal truncate mt-0.5">
                Working
              </div>
            </div>
          </div>

          {/* In Review 1 */}
          <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/[0.06] flex flex-col justify-between space-y-3">
            <div className="w-7 h-7 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <GitPullRequest size={14} />
            </div>
            <div>
              <div className="text-lg sm:text-2xl font-medium tracking-tight text-white">
                {totalInReview}
              </div>
              <div className="text-xs text-purple-400 font-normal truncate mt-0.5">
                In Review
              </div>
            </div>
          </div>

          {/* Needs Attention 0 */}
          <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] border border-white/[0.06] flex flex-col justify-between space-y-3">
            <div className="w-7 h-7 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Clock size={14} />
            </div>
            <div>
              <div className="text-lg sm:text-2xl font-medium tracking-tight text-white">
                {totalNeedsAttention}
              </div>
              <div className="text-xs text-white/40 font-normal truncate mt-0.5">
                Attention
              </div>
            </div>
          </div>
        </div>

        {/* Workspaces & Repositories (iOS Files-style rows) */}
        <div className="pt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/35 px-1">
            Workspaces & Repositories
          </div>

          <div className="rounded-3xl bg-white/[0.03] border border-white/[0.07] overflow-hidden divide-y divide-white/[0.05]">
            {filteredWorkspaces.map((ws) => {
              const hasReview = ws.statusSummary.inReview > 0;
              return (
                <button
                  key={ws.id}
                  onClick={() => onSelectWorkspace(ws)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left group"
                >
                  <div className="flex items-center gap-3.5 min-w-0 pr-3">
                    {/* Folder Icon */}
                    <div className="w-10 h-10 rounded-2xl bg-white/[0.06] text-white/70 group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                      <Folder size={18} />
                    </div>

                    {/* Workspace Details */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm sm:text-base font-medium text-white tracking-tight truncate">
                          {ws.name}
                        </span>
                        {hasReview && (
                          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-white/40 font-normal truncate mt-0.5">
                        {ws.description}
                      </p>
                    </div>
                  </div>

                  {/* Trailing Count & Chevron */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    {ws.itemCount > 0 ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-white/[0.08] text-white/80 font-mono text-xs font-medium">
                        {ws.itemCount}
                      </span>
                    ) : (
                      <span className="text-xs text-white/25 font-normal">
                        No changes
                      </span>
                    )}
                    <ChevronRight size={16} className="text-white/30 group-hover:text-white/60 transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ExecOS Local Lane & Privilege Status Card */}
        <div 
          onClick={onOpenExecOsSheet}
          className="p-5 rounded-3xl bg-white/[0.03] hover:bg-white/[0.06] active:bg-white/[0.08] border border-white/[0.07] transition-all cursor-pointer group space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <Laptop size={17} />
              </div>
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>ExecOS Local Lane</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono text-[10px] font-bold">
                    Port {execOsStatus.daemonPort}
                  </span>
                </div>
                <div className="text-xs text-white/40 font-mono">
                  MacBook Pro • {execOsStatus.macUsername} • {execOsStatus.latencyMs}ms
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!execOsStatus.isEcosystemSanitized ? (
                <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  <span>Sanitize PM2</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5">
                  <ShieldCheck size={12} />
                  <span>Narrow & Boring</span>
                </span>
              )}
              <ChevronRight size={16} className="text-white/30 group-hover:text-white/60 transition-colors" />
            </div>
          </div>

          <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between text-xs text-white/50">
            <span className="truncate max-w-[280px]">
              {execOsStatus.isEcosystemSanitized 
                ? 'Ecosystem sanitized: 11 clean environment variables' 
                : '114 env vars inherited (Cursor IDE extension-host bleed detected)'}
            </span>
            <span className="text-emerald-400 font-mono shrink-0">Zero DO Hops</span>
          </div>
        </div>

        {/* Recent Agent Activity Stream */}
        <div className="pt-2 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/35 px-1">
            Recent Agent Executions
          </div>

          <div className="p-4 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white">
                  PWA SW Cache Invalidation Strategy verified
                </div>
                <div className="text-[11px] text-white/40 mt-0.5">
                  Applied Workbox CacheFirst rules to `/static/dashboard/app/*.js` • 12m ago
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 pt-2 border-t border-white/[0.04]">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Zap size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white">
                  Non-blocking dashboard bootstrap decoupled from React mount
                </div>
                <div className="text-[11px] text-white/40 mt-0.5">
                  App shell boots instantly; session verification moved to idle callback • 35m ago
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
