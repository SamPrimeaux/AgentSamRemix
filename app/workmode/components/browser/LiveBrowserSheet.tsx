import React, { useRef } from 'react';
import { 
  X, 
  ChevronLeft, 
  MoreHorizontal, 
  Radio, 
  ExternalLink, 
  ShieldCheck,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { LiveBrowserSession } from '../../types';
import { BrowserSurface } from './BrowserSurface';
import { cn } from '../../../lib/utils';

interface LiveBrowserSheetProps {
  isOpen: boolean;
  onClose: () => void;
  session?: LiveBrowserSession;
}

export const LiveBrowserSheet: React.FC<LiveBrowserSheetProps> = ({
  isOpen,
  onClose,
  session
}) => {
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);

  if (!isOpen) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchCurrentY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (touchStartY.current !== null && touchCurrentY.current !== null) {
      const deltaY = touchCurrentY.current - touchStartY.current;
      if (deltaY > 60) {
        onClose();
      }
    }
    touchStartY.current = null;
    touchCurrentY.current = null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Sheet Container */}
      <div className="relative w-full h-[92vh] sm:h-[88vh] sm:max-w-5xl bg-zinc-950 rounded-t-3xl sm:rounded-3xl border border-zinc-800 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300">
        {/* Mobile Drag Header */}
        <div 
          className="w-full sm:hidden pt-2.5 pb-1 flex justify-center cursor-grab"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-14 h-1.5 rounded-full bg-zinc-700" />
        </div>

        {/* Sheet Top Navigation Bar (Matching design: ‹ Chat  Live Browser  •••) */}
        <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-zinc-100">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs font-semibold text-zinc-300 hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <ChevronLeft size={16} />
            <span>Chat</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold text-sm text-zinc-100">Live Browser</span>
            <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400 font-mono hidden sm:inline">
              Cloudflare Run
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Canonical Browser Surface */}
        <div className="flex-1 p-2 sm:p-4 overflow-hidden bg-black/60">
          <BrowserSurface session={session} />
        </div>
      </div>
    </div>
  );
};
