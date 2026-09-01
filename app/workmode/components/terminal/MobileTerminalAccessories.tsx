import React from 'react';
import { 
  CornerDownLeft, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight, 
  Copy, 
  Clipboard, 
  Trash2, 
  XSquare, 
  RotateCcw 
} from 'lucide-react';
import { cn } from '../../../lib/utils';

interface MobileTerminalAccessoriesProps {
  onInsertKey: (key: string) => void;
  onInterrupt: () => void;
  onClear: () => void;
  onPaste: () => void;
  ctrlActive: boolean;
  onToggleCtrl: () => void;
  className?: string;
}

export const MobileTerminalAccessories: React.FC<MobileTerminalAccessoriesProps> = ({
  onInsertKey,
  onInterrupt,
  onClear,
  onPaste,
  ctrlActive,
  onToggleCtrl,
  className
}) => {
  return (
    <div className={cn(
      "w-full px-2 py-1.5 bg-zinc-900/95 border-t border-zinc-800/90 flex items-center gap-1.5 overflow-x-auto scrollbar-none select-none touch-manipulation z-10",
      className
    )}>
      {/* Esc */}
      <button
        type="button"
        onClick={() => onInsertKey('Escape')}
        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-[11px] font-mono font-medium text-zinc-300 transition-colors shrink-0 shadow-xs active:scale-95"
      >
        Esc
      </button>

      {/* Tab */}
      <button
        type="button"
        onClick={() => onInsertKey('Tab')}
        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-[11px] font-mono font-medium text-zinc-300 transition-colors shrink-0 shadow-xs active:scale-95"
      >
        Tab
      </button>

      {/* Ctrl toggle */}
      <button
        type="button"
        onClick={onToggleCtrl}
        className={cn(
          "px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold transition-all shrink-0 shadow-xs active:scale-95",
          ctrlActive
            ? "bg-blue-600 text-white shadow-blue-500/30" 
            : "bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300"
        )}
      >
        Ctrl
      </button>

      {/* Interrupt ^C */}
      <button
        type="button"
        onClick={onInterrupt}
        title="Send SIGINT (^C)"
        className="px-2.5 py-1 rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-800/60 active:bg-red-800 text-[11px] font-mono font-bold text-red-300 transition-colors shrink-0 shadow-xs active:scale-95"
      >
        ^C
      </button>

      {/* Arrow Up */}
      <button
        type="button"
        onClick={() => onInsertKey('ArrowUp')}
        className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shrink-0 shadow-xs active:scale-95"
      >
        <ArrowUp size={13} />
      </button>

      {/* Arrow Down */}
      <button
        type="button"
        onClick={() => onInsertKey('ArrowDown')}
        className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shrink-0 shadow-xs active:scale-95"
      >
        <ArrowDown size={13} />
      </button>

      {/* Arrow Left */}
      <button
        type="button"
        onClick={() => onInsertKey('ArrowLeft')}
        className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shrink-0 shadow-xs active:scale-95"
      >
        <ArrowLeft size={13} />
      </button>

      {/* Arrow Right */}
      <button
        type="button"
        onClick={() => onInsertKey('ArrowRight')}
        className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shrink-0 shadow-xs active:scale-95"
      >
        <ArrowRight size={13} />
      </button>

      {/* Paste */}
      <button
        type="button"
        onClick={onPaste}
        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-[11px] font-sans font-medium text-zinc-300 flex items-center gap-1 transition-colors shrink-0 shadow-xs active:scale-95"
      >
        <Clipboard size={11} />
        <span>Paste</span>
      </button>

      {/* Clear */}
      <button
        type="button"
        onClick={onClear}
        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-[11px] font-sans font-medium text-zinc-300 flex items-center gap-1 transition-colors shrink-0 shadow-xs active:scale-95"
      >
        <Trash2 size={11} />
        <span>Clear</span>
      </button>
    </div>
  );
};
