import React from 'react';
import { Wifi, Battery } from 'lucide-react';

interface MobileStatusBarProps {
  darkMode?: boolean;
}

export const MobileStatusBar: React.FC<MobileStatusBarProps> = ({ darkMode = false }) => {
  return (
    <div className="w-full flex items-center justify-between px-7 pt-2.5 pb-1 text-xs font-semibold select-none z-30 transition-colors duration-200">
      {/* Clock */}
      <span className="font-bold tracking-tight text-[15px]">
        9:41
      </span>

      {/* Dynamic Island / Notch Pill */}
      <div className="hidden sm:flex items-center justify-center w-24 h-4 bg-black/90 dark:bg-zinc-800 rounded-full shadow-inner mx-auto opacity-70">
        <div className="w-2.5 h-2.5 rounded-full bg-zinc-950 dark:bg-zinc-900 mr-2 border border-white/10" />
        <div className="w-1.5 h-1.5 rounded-full bg-blue-900/60 dark:bg-blue-500/40" />
      </div>

      {/* Status Icons */}
      <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100">
        {/* Signal Bars */}
        <div className="flex items-end gap-[1.5px] h-3 mr-0.5">
          <span className="w-[3px] h-1.5 bg-current rounded-xs" />
          <span className="w-[3px] h-2 bg-current rounded-xs" />
          <span className="w-[3px] h-2.5 bg-current rounded-xs" />
          <span className="w-[3px] h-3 bg-current rounded-xs" />
        </div>

        {/* Wifi */}
        <Wifi size={14} className="stroke-[2.5]" />

        {/* Battery */}
        <div className="flex items-center gap-1">
          <div className="w-6 h-3 rounded-[4px] border border-current p-[1.5px] flex items-center">
            <div className="w-full h-full bg-current rounded-[2px]" />
          </div>
        </div>
      </div>
    </div>
  );
};
