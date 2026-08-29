import React from 'react';
import { Building2, FolderOpen, LayoutGrid, Upload } from 'lucide-react';
import { StartupChipRow } from '../../shell/chat-startup/StartupChipRow';

export type StudioStartupChipsProps = {
  className?: string;
  disabled?: boolean;
  onOpenStudio: () => void;
  onImportGlb: () => void;
  onBrowseLibrary: () => void;
  onLoadBimExample?: () => void;
};

export function StudioStartupChips({
  className,
  disabled = false,
  onOpenStudio,
  onImportGlb,
  onBrowseLibrary,
  onLoadBimExample,
}: StudioStartupChipsProps) {
  return (
    <StartupChipRow
      className={className}
      ariaLabel="Design Studio quick actions"
      disabled={disabled}
      chips={[
        { id: 'studio', label: 'Open studio', icon: LayoutGrid, onClick: onOpenStudio },
        ...(onLoadBimExample
          ? [{ id: 'bim', label: 'BIM example', icon: Building2, onClick: onLoadBimExample }]
          : []),
        { id: 'import', label: 'Import GLB', icon: Upload, onClick: onImportGlb },
        { id: 'library', label: 'Browse library', icon: FolderOpen, onClick: onBrowseLibrary },
      ]}
    />
  );
}
