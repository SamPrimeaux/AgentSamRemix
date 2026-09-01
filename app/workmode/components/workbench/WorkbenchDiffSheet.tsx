import React, { useState } from 'react';
import { 
  X, 
  Check, 
  Copy, 
  FileCode, 
  ArrowUpRight, 
  GitCommit, 
  Sparkles, 
  CheckCircle2, 
  ChevronRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { WorkbenchChangedFile, WorkbenchPullRequest } from '../../types';
import { cn } from '../../../lib/utils';
import confetti from 'canvas-confetti';

interface WorkbenchDiffSheetProps {
  isOpen: boolean;
  onClose: () => void;
  pr: WorkbenchPullRequest;
  onSquashAndMerge?: () => void;
}

export const WorkbenchDiffSheet: React.FC<WorkbenchDiffSheetProps> = ({
  isOpen,
  onClose,
  pr,
  onSquashAndMerge
}) => {
  const [selectedFileId, setSelectedFileId] = useState<string>(pr.files[0]?.id || 'file-1');
  const [isCopied, setIsCopied] = useState(false);
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified');

  if (!isOpen) return null;

  const currentFile = pr.files.find((f) => f.id === selectedFileId) || pr.files[0];

  const handleCopyPatch = () => {
    if (!currentFile) return;
    const patchText = currentFile.diffLines.map((l) => l.content).join('\n');
    navigator.clipboard.writeText(patchText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      {/* Dimmed backdrop dismiss area */}
      <div className="flex-1 w-full" onClick={onClose} />

      {/* Slide-Up Sheet Container */}
      <div 
        className="w-full max-w-4xl mx-auto h-[88vh] max-h-[920px] rounded-t-[36px] bg-[#0c0c0e] border-t border-x border-white/10 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
      >
        {/* Top Grabber Handle */}
        <div className="w-full pt-3 pb-1 flex justify-center cursor-pointer" onClick={onClose}>
          <div className="w-12 h-1.2 rounded-full bg-white/20 hover:bg-white/40 transition-colors" />
        </div>

        {/* Sheet Header Chrome with Oversized Circular Controls */}
        <div className="px-6 py-3 flex items-center justify-between border-b border-white/[0.07] shrink-0">
          {/* Close Circular Button */}
          <button
            onClick={onClose}
            aria-label="Close diff sheet"
            className="w-10 h-10 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/80 hover:text-white flex items-center justify-center transition-all active:scale-95"
          >
            <X size={18} />
          </button>

          {/* Centered Title & Metadata */}
          <div className="text-center">
            <h3 className="text-sm font-semibold text-white tracking-tight">Changes ({pr.files.length} files)</h3>
            <div className="flex items-center justify-center gap-2 text-[11px] text-white/40">
              <span className="font-mono">{pr.branch}</span>
              <span>•</span>
              <span className="text-emerald-400 font-mono">+{pr.additions}</span>
              <span className="text-rose-400 font-mono">-{pr.deletions}</span>
            </div>
          </div>

          {/* Secondary Action Pill */}
          <button
            onClick={handleCopyPatch}
            className="px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/90 text-xs font-medium flex items-center gap-1.5 transition-all"
          >
            {isCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{isCopied ? 'Copied' : 'Copy Diff'}</span>
          </button>
        </div>

        {/* File Tabs & Stats Bar */}
        <div className="px-6 py-2.5 bg-white/[0.02] border-b border-white/[0.05] flex items-center justify-between gap-3 overflow-x-auto shrink-0">
          {/* File selector pills */}
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            {pr.files.map((file) => (
              <button
                key={file.id}
                onClick={() => setSelectedFileId(file.id)}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-mono font-medium flex items-center gap-2 shrink-0 transition-all",
                  selectedFileId === file.id
                    ? "bg-white/15 text-white shadow-xs border border-white/20"
                    : "bg-white/[0.04] text-white/50 hover:text-white/80 hover:bg-white/[0.08]"
                )}
              >
                <FileCode size={13} className={selectedFileId === file.id ? "text-emerald-400" : "text-white/40"} />
                <span>{file.filename}</span>
                <span className="text-[10px] text-emerald-400/90">+{file.additions}</span>
                <span className="text-[10px] text-rose-400/90">-{file.deletions}</span>
              </button>
            ))}
          </div>

          {/* View mode toggle */}
          <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] text-[11px] font-medium shrink-0">
            <button
              onClick={() => setDiffMode('unified')}
              className={cn(
                "px-2.5 py-0.5 rounded-lg transition-colors",
                diffMode === 'unified' ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
              )}
            >
              Unified
            </button>
            <button
              onClick={() => setDiffMode('split')}
              className={cn(
                "px-2.5 py-0.5 rounded-lg transition-colors",
                diffMode === 'split' ? "bg-white/10 text-white" : "text-white/40 hover:text-white"
              )}
            >
              Side-by-Side
            </button>
          </div>
        </div>

        {/* Code Region: Dense, Monospace, Line-Numbered Syntax Diff */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-6 bg-[#08080a] font-mono text-xs leading-relaxed selection:bg-emerald-500/30">
          {currentFile ? (
            <div className="space-y-0.5">
              <div className="text-[11px] text-white/35 pb-2 border-b border-white/[0.06] mb-2 flex items-center justify-between">
                <span>{currentFile.path}</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-sans">
                  Workbox CacheFirst Verified
                </span>
              </div>

              {currentFile.diffLines.map((line, idx) => {
                const isAdd = line.type === 'add';
                const isDel = line.type === 'del';
                const isHeader = line.type === 'header';

                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-start rounded px-2 py-0.5 transition-colors font-mono",
                      isAdd && "bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500",
                      isDel && "bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 line-through opacity-80",
                      isHeader && "bg-blue-950/30 text-blue-300/80 my-1 py-1 font-semibold text-[11px]",
                      !isAdd && !isDel && !isHeader && "text-white/70 hover:bg-white/[0.02]"
                    )}
                  >
                    {/* Line numbers */}
                    <span className="w-8 shrink-0 text-[10px] text-white/20 select-none text-right pr-2">
                      {line.oldLine || ''}
                    </span>
                    <span className="w-8 shrink-0 text-[10px] text-white/20 select-none text-right pr-3">
                      {line.newLine || ''}
                    </span>

                    {/* Diff indicator (+/-/space) */}
                    <span className={cn(
                      "w-4 shrink-0 select-none font-bold",
                      isAdd && "text-emerald-400",
                      isDel && "text-rose-400",
                      isHeader && "text-blue-400"
                    )}>
                      {isAdd ? '+' : isDel ? '-' : isHeader ? '@@' : ' '}
                    </span>

                    {/* Code text */}
                    <span className="flex-1 whitespace-pre break-all">
                      {line.content.replace(/^[-+]\s?/, '')}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-white/40">
              No files in this patch.
            </div>
          )}
        </div>

        {/* Bottom Pinned Action Bar */}
        <div className="px-6 py-4 bg-[#0e0e11] border-t border-white/[0.07] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-white/50">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>Passed CI/CD sandbox assertions</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-xs font-semibold transition-all"
            >
              Dismiss
            </button>
            <button
              onClick={() => {
                if (onSquashAndMerge) {
                  onSquashAndMerge();
                  onClose();
                } else {
                  confetti({ particleCount: 40 });
                  onClose();
                }
              }}
              className="px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold shadow-lg flex items-center gap-1.5 transition-all"
            >
              <GitCommit size={14} />
              <span>Squash & Merge PR #1</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
