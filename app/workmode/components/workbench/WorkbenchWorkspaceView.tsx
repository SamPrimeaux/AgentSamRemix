import React, { useState } from 'react';
import { 
  ChevronLeft, 
  Search, 
  SlidersHorizontal, 
  GitPullRequest, 
  GitBranch, 
  Clock, 
  Sparkles, 
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Folder
} from 'lucide-react';
import { WorkbenchWorkspace, WorkbenchPullRequest, ExecOsLocalLaneStatus } from '../../types';
import { cn } from '../../../lib/utils';
import { ExecutionLanePill } from './ExecutionLanePill';

interface WorkbenchWorkspaceViewProps {
  workspace: WorkbenchWorkspace;
  onBack: () => void;
  onSelectPr: (pr: WorkbenchPullRequest) => void;
  execOsStatus?: ExecOsLocalLaneStatus;
  onOpenExecOsSheet?: () => void;
  onOpenAgentComputer?: () => void;
}

export const WorkbenchWorkspaceView: React.FC<WorkbenchWorkspaceViewProps> = ({
  workspace,
  onBack,
  onSelectPr,
  execOsStatus,
  onOpenExecOsSheet,
  onOpenAgentComputer
}) => {
  const [filter, setFilter] = useState<'all' | 'in_review'>('all');

  const activePrs = workspace.pullRequests || [];

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* Top Floating Controls Bar */}
      <div className="w-full max-w-2xl mx-auto px-6 pt-6 pb-2 flex items-center justify-between shrink-0">
        {/* Oversized Circular Back Button */}
        <button
          onClick={onBack}
          aria-label="Back to Inbox"
          className="w-12 h-12 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center justify-center text-white/80 hover:text-white transition-all shadow-sm"
        >
          <ChevronLeft size={22} className="-translate-x-0.5" />
        </button>

        {/* Top-Right Circular Actions */}
        <div className="flex items-center gap-2">
          {onOpenAgentComputer && (
            <button
              onClick={onOpenAgentComputer}
              title="Launch Agent Computer (Browser + Terminal + Files + Artifacts)"
              className="px-3.5 py-2 rounded-full bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 flex items-center gap-1.5 text-xs font-semibold transition-all active:scale-95"
            >
              <Sparkles size={13} className="text-blue-400" />
              <span>Agent Computer</span>
            </button>
          )}

          {execOsStatus && onOpenExecOsSheet && (
            <ExecutionLanePill
              status={execOsStatus}
              onClick={onOpenExecOsSheet}
            />
          )}

          <button
            aria-label="Filter"
            className="w-12 h-12 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white transition-all shadow-sm"
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Main Content Area with Intentional Minimalist Negative Space */}
      <div className="w-full max-w-2xl mx-auto px-6 pt-6 pb-28 space-y-8 flex-1 flex flex-col justify-start">
        {/* Large, Calm Page Title */}
        <div className="space-y-1.5">
          <h1 className="text-3xl sm:text-4xl font-medium tracking-tight text-white">
            {workspace.name}
          </h1>
          <div className="flex items-center gap-2 text-xs text-white/40 font-mono">
            <span>{workspace.repoName}</span>
            <span>•</span>
            <span>Active {workspace.lastActive}</span>
          </div>
        </div>

        {/* Soft Status Grouping */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs font-medium text-white/70">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span>In Review {workspace.statusSummary.inReview}</span>
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.05] text-xs font-medium text-white/40">
            <span>No other changes</span>
          </div>
        </div>

        {/* Actionable Work Items List (Show what matters now) */}
        <div className="space-y-3 pt-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/35 px-1">
            Active Pull Requests & Reviews
          </div>

          {activePrs.length > 0 ? (
            <div className="space-y-3">
              {activePrs.map((pr) => (
                <div
                  key={pr.id}
                  onClick={() => onSelectPr(pr)}
                  className="p-5 sm:p-6 rounded-3xl bg-white/[0.04] hover:bg-white/[0.07] active:bg-white/[0.09] border border-white/[0.08] transition-all cursor-pointer group shadow-sm space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-purple-400 bg-purple-500/10 px-2.5 py-0.5 rounded-full">
                          PR #{pr.number}
                        </span>
                        <span className="text-xs font-mono text-white/40">
                          {pr.targetBranch} ← {pr.branch}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-medium text-white tracking-tight group-hover:text-white/95 transition-colors">
                        {pr.title}
                      </h3>
                    </div>

                    <div className="w-8 h-8 rounded-full bg-white/[0.06] group-hover:bg-white/[0.12] text-white/60 group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                      <ArrowRight size={16} />
                    </div>
                  </div>

                  <p className="text-xs text-white/60 font-normal leading-relaxed line-clamp-2">
                    {pr.summary}
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.05] text-[11px] text-white/40">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[9px]">
                        AS
                      </div>
                      <span>{pr.author}</span>
                    </div>

                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-emerald-400">+{pr.additions}</span>
                      <span className="text-rose-400">-{pr.deletions}</span>
                      <span>•</span>
                      <span>{pr.updatedAt}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/[0.05] text-center space-y-2">
              <CheckCircle2 size={24} className="text-white/20 mx-auto" />
              <div className="text-sm font-medium text-white/60">Workspace up to date</div>
              <p className="text-xs text-white/35 max-w-sm mx-auto">
                No open PRs or pending tasks in this repository. Use the composer below to plan new features.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
