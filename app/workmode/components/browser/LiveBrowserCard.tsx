import React, { useState } from 'react';
import { 
  Radio, 
  ExternalLink, 
  Maximize2, 
  Bot, 
  MousePointer, 
  Lock, 
  Globe, 
  Eye,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { LiveBrowserSession } from '../../types';
import { cn } from '../../../lib/utils';

interface LiveBrowserCardProps {
  session: LiveBrowserSession;
  onOpenLiveSheet: () => void;
  className?: string;
}

export const LiveBrowserCard: React.FC<LiveBrowserCardProps> = ({
  session,
  onOpenLiveSheet,
  className
}) => {
  const latestEvent = session.eventsTimeline[session.eventsTimeline.length - 1];

  return (
    <div className={cn("w-full my-2.5 select-text", className)}>
      <div 
        onClick={onOpenLiveSheet}
        role="button"
        tabIndex={0}
        aria-label="Open Live Browser View"
        className="w-full rounded-2xl bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden cursor-pointer group text-zinc-100"
      >
        {/* Card Header */}
        <div className="px-3.5 py-2.5 bg-zinc-900/90 dark:bg-zinc-800/90 border-b border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
            <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 truncate">
              <Lock size={11} className="text-emerald-400 shrink-0" />
              <span className="truncate">{session.targetUrl.replace(/^https?:\/\//, '')}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-zinc-400 group-hover:text-white transition-colors shrink-0">
            <span className="text-[11px] font-medium hidden sm:inline">Inspect live view</span>
            <ExternalLink size={13} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </div>
        </div>

        {/* Lightweight Live Thumbnail / Current-Page Preview */}
        <div className="p-4 bg-zinc-950 flex flex-col items-center justify-center relative min-h-[140px] sm:min-h-[160px] border-b border-zinc-800/80 group-hover:bg-zinc-900/40 transition-colors">
          {/* Mock Browser Wireframe */}
          <div className="w-full max-w-sm rounded-xl bg-zinc-900/90 border border-zinc-800 p-3 space-y-2 shadow-inner">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">1280x800 Chromium</span>
            </div>
            <div className="space-y-1.5">
              <div className="h-4 bg-zinc-800 rounded-md w-3/4 animate-pulse" />
              <div className="grid grid-cols-3 gap-1.5">
                <div className="h-8 bg-zinc-800/60 rounded-md" />
                <div className="h-8 bg-zinc-800/60 rounded-md" />
                <div className="h-8 bg-zinc-800/60 rounded-md" />
              </div>
            </div>
          </div>

          {/* Hover Overlay */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-2xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg">
              <Eye size={13} />
              <span>Tap to Open Live View</span>
            </div>
          </div>
        </div>

        {/* Card Footer: Navigation Timeline Status */}
        <div className="px-3.5 py-2 bg-zinc-900/60 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2 truncate">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping shrink-0" />
            <span className="truncate font-medium text-zinc-300">
              {latestEvent?.statusText || 'Agent is navigating in live browser...'}
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono shrink-0">
            Cloudflare Browser Run
          </span>
        </div>
      </div>
    </div>
  );
};
