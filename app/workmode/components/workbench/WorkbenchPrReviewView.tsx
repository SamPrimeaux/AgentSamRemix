import React, { useState } from 'react';
import { 
  ChevronLeft, 
  MoreHorizontal, 
  GitPullRequest, 
  GitCommit, 
  FileCode, 
  Check, 
  ArrowUpRight, 
  Sparkles, 
  CheckCircle2, 
  ShieldCheck,
  Zap,
  Clock,
  Layers,
  ChevronRight
} from 'lucide-react';
import { WorkbenchPullRequest, ExecOsLocalLaneStatus } from '../../types';
import { cn } from '../../../lib/utils';
import confetti from 'canvas-confetti';
import ReactMarkdown from 'react-markdown';
import { ExecutionLanePill } from './ExecutionLanePill';

interface WorkbenchPrReviewViewProps {
  pr: WorkbenchPullRequest;
  onBack: () => void;
  onOpenDiffSheet: () => void;
  onSquashAndMerge: () => void;
  execOsStatus?: ExecOsLocalLaneStatus;
  onOpenExecOsSheet?: () => void;
  onOpenAgentComputer?: () => void;
}

export const WorkbenchPrReviewView: React.FC<WorkbenchPrReviewViewProps> = ({
  pr,
  onBack,
  onOpenDiffSheet,
  onSquashAndMerge,
  execOsStatus,
  onOpenExecOsSheet,
  onOpenAgentComputer
}) => {
  const [isMerged, setIsMerged] = useState(pr.status === 'merged');
  const [isMerging, setIsMerging] = useState(false);

  const handleMerge = () => {
    setIsMerging(true);
    setTimeout(() => {
      setIsMerging(false);
      setIsMerged(true);
      onSquashAndMerge();
      confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    }, 900);
  };

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* Top Floating Controls Bar */}
      <div className="w-full max-w-2xl mx-auto px-6 pt-6 pb-2 flex items-center justify-between shrink-0">
        {/* Back Button */}
        <button
          onClick={onBack}
          aria-label="Back to Workspace"
          className="w-12 h-12 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center justify-center text-white/80 hover:text-white transition-all shadow-sm"
        >
          <ChevronLeft size={22} className="-translate-x-0.5" />
        </button>

        {/* Center / Right controls */}
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

          {/* Branch Info Pill */}
          <div className="hidden sm:flex px-3.5 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-xs font-mono text-white/60 items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>{pr.branch}</span>
          </div>

          {/* Overflow Menu */}
          <button
            aria-label="Options"
            className="w-12 h-12 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white transition-all shadow-sm"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      {/* Main Reading Surface Container */}
      <div className="w-full max-w-2xl mx-auto px-6 pt-6 pb-36 space-y-6 flex-1">
        {/* Large, Calm Title & Metadata */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className={cn(
              "px-2.5 py-0.5 rounded-full font-mono text-xs font-semibold",
              isMerged 
                ? "bg-purple-500/15 text-purple-300 border border-purple-500/30" 
                : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
            )}>
              {isMerged ? 'Merged' : 'In Review'}
            </span>
            <span className="text-white/40">PR #{pr.number}</span>
            <span className="text-white/20">•</span>
            <span className="text-white/40">Opened {pr.createdAt} by {pr.author}</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-white leading-tight">
            {pr.title}
          </h1>
        </div>

        {/* Compressed Diff Summary Card (Changes 2) */}
        <div 
          onClick={onOpenDiffSheet}
          className="p-4 sm:p-5 rounded-3xl bg-white/[0.04] hover:bg-white/[0.07] active:bg-white/[0.09] border border-white/[0.08] transition-all cursor-pointer group shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Changes</span>
              <span className="px-2 py-0.5 rounded-full bg-white/[0.08] text-white/80 font-mono text-xs font-medium">
                {pr.files.length}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-emerald-400">+{pr.additions}</span>
              <span className="text-rose-400">-{pr.deletions}</span>
              <ChevronRight size={15} className="text-white/40 group-hover:text-white transition-colors ml-1" />
            </div>
          </div>

          {/* File Rows */}
          <div className="space-y-1.5 pt-1">
            {pr.files.map((file) => (
              <div 
                key={file.id}
                className="flex items-center justify-between px-3 py-2 rounded-2xl bg-white/[0.02] group-hover:bg-white/[0.04] text-xs font-mono transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 text-white/80">
                  <FileCode size={13} className="text-white/40 shrink-0" />
                  <span className="truncate">{file.filename}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 pl-2">
                  <span className="text-emerald-400">+{file.additions}</span>
                  <span className="text-rose-400">-{file.deletions}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Markdown Spec / Document Reading Surface */}
        <div className="prose prose-invert max-w-none prose-p:text-white/70 prose-p:leading-relaxed prose-headings:text-white prose-headings:font-medium prose-code:text-emerald-300 prose-code:bg-white/[0.06] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-lg prose-code:before:content-none prose-code:after:content-none prose-li:text-white/70 prose-table:border-white/10 prose-th:text-white/60 prose-th:border-white/10 prose-td:text-white/80 prose-td:border-white/10 pt-2">
          <ReactMarkdown>
            {pr.specMarkdown}
          </ReactMarkdown>
        </div>

        {/* Object Actions Attached to the PR above Composer */}
        <div className="pt-6 border-t border-white/[0.07] flex items-center gap-3 flex-wrap">
          <button
            onClick={onOpenDiffSheet}
            className="flex-1 py-3 px-5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 border border-white/[0.08] transition-all"
          >
            <FileCode size={16} />
            <span>Inspect Changes ({pr.files.length})</span>
          </button>

          {!isMerged ? (
            <button
              onClick={handleMerge}
              disabled={isMerging}
              className="flex-1 py-3 px-5 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all"
            >
              <GitCommit size={16} className={cn(isMerging && "animate-spin")} />
              <span>{isMerging ? 'Merging AST...' : 'Squash & Merge'}</span>
            </button>
          ) : (
            <div className="flex-1 py-3 px-5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs sm:text-sm font-bold flex items-center justify-center gap-2">
              <CheckCircle2 size={16} />
              <span>Merged into {pr.targetBranch}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
