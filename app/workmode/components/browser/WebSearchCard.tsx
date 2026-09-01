import React, { useState } from 'react';
import { 
  Globe, 
  ChevronDown, 
  ChevronUp, 
  ExternalLink, 
  Search, 
  Zap, 
  Coins, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Info,
  Layers,
  Sparkles
} from 'lucide-react';
import { WebSearchEvent, WebSearchSource } from '../../types';
import { cn } from '../../../lib/utils';

interface WebSearchCardProps {
  event: WebSearchEvent;
  className?: string;
}

export const WebSearchCard: React.FC<WebSearchCardProps> = ({ event, className }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { inspectData } = event;

  return (
    <div className={cn("w-full my-2 select-text", className)}>
      {/* Compact "Searched the web" row */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className={cn(
          "w-full px-3.5 py-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group",
          isExpanded 
            ? "bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 shadow-sm" 
            : "bg-zinc-50/80 dark:bg-zinc-900/60 hover:bg-zinc-100/90 dark:hover:bg-zinc-800/80 border-zinc-200/80 dark:border-zinc-800"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Globe size={14} />
          </div>
          <div className="truncate">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                {event.title || 'Searched the web'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium">
                Info Retrieval
              </span>
            </div>
            <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400 truncate">
              {event.summaryLabel || `${inspectData.sourcesCount} sources · ${inspectData.provider} · ${inspectData.cachedResultsCount} cached result`}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200 transition-colors">
          <span className="text-[11px] font-medium hidden sm:inline">
            {isExpanded ? 'Hide inspection' : 'Inspect search'}
          </span>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded Inspection Drawer (No browser canvas opened) */}
      {isExpanded && (
        <div className="mt-2 rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 shadow-lg p-3.5 sm:p-4 space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header Metadata Pill Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/70 dark:border-zinc-800/80">
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider font-sans">Provider</div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">{inspectData.provider}</div>
            </div>

            <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/70 dark:border-zinc-800/80">
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider font-sans">Cache Status</div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1">
                {inspectData.cacheHit ? (
                  <span className="text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 size={11} /> Hit ({inspectData.latencyMs}ms)
                  </span>
                ) : (
                  <span className="text-amber-500 flex items-center gap-1">
                    <Zap size={11} /> Live ({inspectData.latencyMs}ms)
                  </span>
                )}
              </div>
            </div>

            <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/70 dark:border-zinc-800/80">
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider font-sans">Cost / Credits</div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1">
                <Coins size={11} className="text-amber-500" />
                <span>{inspectData.costCredits}</span>
              </div>
            </div>

            <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/70 dark:border-zinc-800/80">
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider font-sans">Sources Found</div>
              <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                {inspectData.sources.length} retrieved
              </div>
            </div>
          </div>

          {/* Queries Performed */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5 flex items-center gap-1.5">
              <Search size={12} />
              <span>Queries Performed</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {inspectData.queries.map((q, idx) => (
                <div 
                  key={idx}
                  className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 text-zinc-800 dark:text-zinc-200 text-xs font-mono flex items-center gap-1.5 border border-zinc-200/60 dark:border-zinc-700/60"
                >
                  <span className="text-blue-500 font-bold">"{q}"</span>
                </div>
              ))}
            </div>
          </div>

          {/* Fallback Reason (if any) */}
          {inspectData.fallbackReason && (
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/40 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <Info size={14} className="shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Fallback Notification: </span>
                {inspectData.fallbackReason}
              </div>
            </div>
          )}

          {/* Sources List */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5 flex items-center gap-1.5">
              <Layers size={12} />
              <span>Retrieved Sources & Citations</span>
            </div>
            <div className="space-y-2">
              {inspectData.sources.map((source, idx) => (
                <a
                  key={source.id || idx}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 border border-zinc-200/70 dark:border-zinc-800/80 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-500 transition-colors">
                        {source.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-zinc-400 shrink-0 font-mono">
                      <span>{source.domain}</span>
                      <ExternalLink size={11} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                    </div>
                  </div>
                  <p className="text-[11.5px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                    {source.snippet}
                  </p>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
