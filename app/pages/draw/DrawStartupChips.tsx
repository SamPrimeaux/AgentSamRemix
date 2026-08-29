import React from 'react';
import { FolderOpen, Pencil, Sparkles } from 'lucide-react';
import { StartupChipRow } from '../../components/shell/chat-startup/StartupChipRow';

export type DrawStartupChipsProps = {
  className?: string;
  disabled?: boolean;
  onOpenCanvas: () => void;
  onBrowseLibraries: () => void;
  onNewSketch: () => void;
};

export function DrawStartupChips({
  className,
  disabled = false,
  onOpenCanvas,
  onBrowseLibraries,
  onNewSketch,
}: DrawStartupChipsProps) {
  return (
    <StartupChipRow
      className={className}
      ariaLabel="Draw quick actions"
      disabled={disabled}
      chips={[
        { id: 'canvas', label: 'Open Excalidraw', icon: Pencil, onClick: onOpenCanvas },
        { id: 'libraries', label: 'Browse libraries', icon: FolderOpen, onClick: onBrowseLibraries },
        { id: 'sketch', label: 'New diagram', icon: Sparkles, onClick: onNewSketch },
      ]}
    />
  );
}
