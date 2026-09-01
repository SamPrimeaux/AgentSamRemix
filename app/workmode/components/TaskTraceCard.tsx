import React, { useState } from 'react';
import { 
  FileText, 
  Edit3, 
  Terminal as TerminalIcon, 
  CheckCircle2, 
  ChevronRight, 
  ExternalLink,
  Loader2,
  Clock,
  Sparkles,
  Layers
} from 'lucide-react';
import { TaskTrace } from '../types';
import { cn } from '../../lib/utils';

interface TaskTraceCardProps {
  trace: TaskTrace;
  onOpenTerminal: () => void;
  onViewWorkMode?: () => void;
}

export const TaskTraceCard: React.FC<TaskTraceCardProps> = ({
  trace,
  onOpenTerminal,
  onViewWorkMode
}) => {
  const [showOutputDetails, setShowOutputDetails] = useState(false);

  return (
    <div className="w-full my-2.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-xs overflow-hidden transition-all">
      {/* List of sub-steps */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
        {/* Step 1: Read Files */}
        <div className="px-4 py-3 flex items-center justify-between hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
              <FileText size={16} />
            </div>
            <div>
              <div className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
                Read {trace.filesReadCount || 6} files
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Completed
              </div>
            </div>
          </div>
          <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <CheckCircle2 size={16} className="fill-emerald-500 text-white dark:text-zinc-900" />
          </div>
        </div>

        {/* Step 2: Edited Files */}
        <div className="px-4 py-3 flex items-center justify-between hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
              <Edit3 size={16} />
            </div>
            <div>
              <div className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
                Edited {trace.filesEditedCount || 3} files
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Completed
              </div>
            </div>
          </div>
          <div className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <CheckCircle2 size={16} className="fill-emerald-500 text-white dark:text-zinc-900" />
          </div>
        </div>

        {/* Step 3: Run Command execution card */}
        <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/60">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-200 flex items-center justify-center font-mono font-bold text-xs">
                {`>_`}
              </div>
              <div>
                <div className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>Run Command</span>
                  {trace.status === 'running' && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-500 font-normal">
                      <Loader2 size={11} className="animate-spin" /> running...
                    </span>
                  )}
                </div>
                <div className="font-mono text-[12px] text-zinc-700 dark:text-zinc-300">
                  {trace.command?.cmd || 'npm test -- auth'}
                </div>
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                  {trace.command?.location || 'backend/agentsam • Local Mac'}
                </div>
              </div>
            </div>

            {/* Time badge */}
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700">
              <Clock size={11} />
              <span>{trace.command?.duration || '18s'}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
          </div>

          {/* Mini test output badge */}
          <div className="mt-3 p-3 rounded-xl bg-zinc-900 dark:bg-zinc-950 text-white font-mono text-[12px] shadow-inner">
            <div className="flex items-center justify-between text-emerald-400 font-semibold">
              <span>{trace.command?.passed !== undefined ? `${trace.command.passed} passed` : '18 passed'}</span>
              <span className="text-zinc-400 text-[11px]">0 failed</span>
            </div>
          </div>

          {/* Collapsible live stdout preview */}
          {showOutputDetails && trace.outputSnippet && (
            <div className="mt-2 p-3 rounded-xl bg-zinc-950 text-emerald-400 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto border border-zinc-800 leading-relaxed">
              {trace.outputSnippet}
            </div>
          )}
        </div>
      </div>

      {/* Footer Action Buttons */}
      <div className="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-800 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 text-[13px] font-medium">
        <button
          onClick={() => setShowOutputDetails(!showOutputDetails)}
          className="py-2.5 text-center text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 active:bg-zinc-200 dark:active:bg-zinc-700 transition-colors"
        >
          {showOutputDetails ? 'Hide output' : 'View output'}
        </button>
        <button
          onClick={onOpenTerminal}
          className="py-2.5 text-center text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 active:bg-zinc-200 dark:active:bg-zinc-700 transition-colors flex items-center justify-center gap-1.5"
        >
          <TerminalIcon size={14} />
          <span>Open terminal</span>
        </button>
      </div>
    </div>
  );
};
